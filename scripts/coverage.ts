/**
 * Coverage gate for the library. Runs the whole test suite with coverage
 * (lcov), then checks the totals for packages/scxmljs/src against the
 * thresholds below and prints a per-file table.
 *
 * Why not bunfig's coverageThreshold: Bun applies it per file and to every
 * file (including examples), which would force meaningless thresholds.
 * The run includes conformance/conformance.test.ts, i.e. the whole W3C suite
 * in both data models, so the number reflects everything that tests the
 * library. Measured in phase 5: 97.5% lines / 93.1% functions.
 *
 *   bun scripts/coverage.ts
 */
import { $ } from "bun";

const THRESHOLDS = { lines: 0.97, functions: 0.92 };
const SCOPE = "packages/scxmljs/src/";

const root = new URL("..", import.meta.url).pathname;
await $`bun test --coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage`.cwd(root).quiet();
const lcov = await Bun.file(`${root}coverage/lcov.info`).text();

interface FileCov {
  file: string;
  lf: number;
  lh: number;
  fnf: number;
  fnh: number;
}
const files: FileCov[] = [];
let cur: FileCov | undefined;
for (const line of lcov.split("\n")) {
  const [key, value = ""] = line.split(":", 2);
  if (key === "SF") cur = { file: value, lf: 0, lh: 0, fnf: 0, fnh: 0 };
  else if (cur && key === "LF") cur.lf = Number(value);
  else if (cur && key === "LH") cur.lh = Number(value);
  else if (cur && key === "FNF") cur.fnf = Number(value);
  else if (cur && key === "FNH") cur.fnh = Number(value);
  else if (cur && line === "end_of_record") {
    if (cur.file.includes(SCOPE)) files.push(cur);
    cur = undefined;
  }
}
if (!files.length) throw new Error(`no coverage records for ${SCOPE}`);

const pct = (hit: number, found: number) => (found ? hit / found : 1);
const fmt = (x: number) => `${(x * 100).toFixed(1).padStart(5)}%`;
console.log(`${"file".padEnd(34)} ${"lines".padStart(7)} ${"funcs".padStart(7)}`);
for (const f of files.sort((a, b) => a.file.localeCompare(b.file)))
  console.log(`${f.file.slice(f.file.indexOf(SCOPE) + SCOPE.length).padEnd(34)} ${fmt(pct(f.lh, f.lf))} ${fmt(pct(f.fnh, f.fnf))}`);

const sum = (k: keyof Omit<FileCov, "file">) => files.reduce((n, f) => n + f[k], 0);
const lines = pct(sum("lh"), sum("lf"));
const functions = pct(sum("fnh"), sum("fnf"));
console.log(`${"TOTAL (library)".padEnd(34)} ${fmt(lines)} ${fmt(functions)}`);
console.log(`thresholds: lines ${fmt(THRESHOLDS.lines)}, functions ${fmt(THRESHOLDS.functions)}`);

const failures = [
  lines < THRESHOLDS.lines && `line coverage ${fmt(lines)} is below ${fmt(THRESHOLDS.lines)}`,
  functions < THRESHOLDS.functions && `function coverage ${fmt(functions)} is below ${fmt(THRESHOLDS.functions)}`,
].filter(Boolean);
if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  process.exit(1);
}
console.log("✓ coverage ok");
