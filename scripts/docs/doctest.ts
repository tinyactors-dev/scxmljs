/**
 * Tests every code sample in the user-facing docs (config.ts: SAMPLE_GLOBS).
 *
 * Each TypeScript/JavaScript, HTML and SCXML block needs a directive on the
 * line before its fence (an HTML comment, so it's invisible on GitHub/npm):
 *
 *   <!-- doctest: run -->              type-check, then execute with Bun (exit code 0)
 *   <!-- doctest: run files=a.scxml --> …with these files from docs/examples/ next to it
 *   <!-- doctest: test files=a.scxml --> type-check, then run with `bun test` (every test must pass)
 *   <!-- doctest: check -->            type-check only (browser code, fragments)
 *   <!-- doctest: check prelude=session --> …with scripts/docs/preludes/session.ts prepended
 *   <!-- doctest: output -->           (on a text block after a `run` block) its expected stdout
 *   <!-- doctest: html files=a.scxml --> render in happy-dom with both elements registered; every
 *                                      <scxml-view> must load without error; inline module
 *                                      scripts must parse, and what they import must exist
 *   <!-- doctest: scxml -->            compile: valid and without warnings (warnings=allow to permit)
 *   <!-- doctest: scxml file=a.scxml --> …and identical to docs/examples/a.scxml (so copies can't drift;
 *                                      works with run/test/check too, ignoring leading // comments)
 *   <!-- doctest: app file=examples/…/x.tsx --> identical to that file of a real app, which CI builds
 *                                      with the framework's own toolchain and loads in a browser
 *                                      (tests/browser/specs/frameworks.pw.ts); for framework syntax
 *   <!-- doctest: skip reason="…" -->  not tested (the reason is required and printed)
 *
 * An untagged sample is an error, so nothing slips through untested.
 *
 *   bun scripts/docs/doctest.ts [--verbose]      (mise run docs:test)
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { Window } from "happy-dom";
import { compile, parseSCXML } from "../../packages/scxmljs/src/trusted.ts";
import { SAMPLE_GLOBS } from "./config.ts";
import { type CodeBlock, codeBlocks, markdownFiles, ROOT } from "./markdown.ts";

const OUT = join(ROOT, ".doctest");
const EXAMPLES = join(ROOT, "docs/examples");
const PRELUDES = join(ROOT, "scripts/docs/preludes");
const verbose = process.argv.includes("--verbose");

const CODE = new Set(["ts", "typescript", "js", "javascript", "mjs", "tsx", "jsx", "vue", "svelte"]);
const TYPED = new Set(["ts", "typescript", "js", "javascript", "mjs"]);

interface Directive {
  mode: string;
  opts: Record<string, string>;
}

function parseDirective(d: string): Directive {
  const [mode = "", ...rest] = d.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const opts: Record<string, string> = {};
  for (const r of rest) {
    const [k, ...v] = r.split("=");
    opts[k!] = v.join("=").replace(/^"|"$/g, "");
  }
  return { mode, opts };
}

const problems: string[] = [];

/** `file=x`: the block must be a copy of docs/examples/x (comment lines at the top of the file excepted), so they can't drift. */
async function sameAsExample(b: CodeBlock, file: string) {
  const path = join(EXAMPLES, file);
  if (!existsSync(path)) return void problems.push(`${where(b)}: file=${file} not found in docs/examples/`);
  const text = (await Bun.file(path).text()).replace(/^(\/\/.*\n)+/, "");
  if (text.trim() !== b.code.trim()) problems.push(`${where(b)}: differs from docs/examples/${file} (keep the copy in sync)`);
}
const skipped: string[] = [];
const appFiles: string[] = [];
const where = (b: CodeBlock) => `${b.file}:${b.line}`;
const idOf = (b: CodeBlock) => `${b.file.replace(/[/.]/g, "_")}_L${b.line}`;

// ── collect ──────────────────────────────────────────────────────────────
type Job =
  | { kind: "ts"; block: CodeBlock; run: boolean; test?: boolean; dir: string; files: string[]; expect?: string; timeout: number }
  | { kind: "html"; block: CodeBlock; files: string[] }
  | { kind: "scxml"; block: CodeBlock; allowWarnings: boolean; file?: string };
const jobs: Job[] = [];

for (const file of await markdownFiles(SAMPLE_GLOBS)) {
  const blocks = codeBlocks(file, await Bun.file(join(ROOT, file)).text());
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const sample = CODE.has(b.lang) || b.lang === "html" || (b.lang === "xml" && b.code.includes("<scxml"));
    if (!b.directive) {
      if (sample) problems.push(`${where(b)}: untagged ${b.lang} sample (add <!-- doctest: run|check|html|scxml|skip reason="…" -->)`);
      continue;
    }
    const { mode, opts } = parseDirective(b.directive);
    const files = opts.files ? opts.files.split(",") : [];
    for (const f of files) if (!existsSync(join(EXAMPLES, f))) problems.push(`${where(b)}: files=${f} not found in docs/examples/`);
    if (mode === "app") {
      const path = join(ROOT, opts.file ?? "");
      if (!opts.file || !existsSync(path)) problems.push(`${where(b)}: app file=${opts.file ?? ""} not found`);
      else if ((await Bun.file(path).text()).trim() !== b.code.trim())
        problems.push(`${where(b)}: differs from ${opts.file} (the example app must use the documented snippet verbatim)`);
      else appFiles.push(opts.file);
      continue;
    }
    if (mode === "skip") {
      if (!opts.reason) problems.push(`${where(b)}: skip needs reason="…"`);
      skipped.push(`${where(b)} (${b.lang}): ${opts.reason}`);
    } else if (mode === "output") {
      // consumed by the preceding run block
    } else if ((mode === "run" || mode === "test" || mode === "check") && TYPED.has(b.lang)) {
      if (opts.file) await sameAsExample(b, opts.file);
      let code = b.code;
      if (opts.prelude)
        for (const p of opts.prelude.split(",")) {
          const pf = join(PRELUDES, `${p}.ts`);
          if (!existsSync(pf)) problems.push(`${where(b)}: prelude ${p} not found`);
          else code = `${await Bun.file(pf).text()}\n${code}`;
        }
      const next = blocks[i + 1];
      const expect = mode === "run" && next?.directive?.trim() === "output" ? next.code : undefined;
      const dir = join(OUT, idOf(b));
      mkdirSync(dir, { recursive: true });
      await Bun.write(join(dir, "main.ts"), `${code}\nexport {};\n`);
      jobs.push({
        kind: "ts",
        block: b,
        run: mode !== "check",
        test: mode === "test",
        dir,
        files,
        expect,
        timeout: Number(opts.timeout ?? 30000),
      });
    } else if (mode === "html" && b.lang === "html") {
      // inline module scripts are plain JavaScript: check that what they import exists
      const scripts = [...b.code.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
      const specifiers = scripts.flatMap((js) => [...js.matchAll(/\bimport\s*(?:[\w{}\s,*]+from\s*)?["']([^"']+)["']/g)].map((m) => m[1]!));
      if (specifiers.length) {
        const dir = join(OUT, `${idOf(b)}_scripts`);
        mkdirSync(dir, { recursive: true });
        await Bun.write(join(dir, "main.ts"), `${specifiers.map((x) => `import "${x}";`).join("\n")}\nexport {};\n`);
        jobs.push({ kind: "ts", block: b, run: false, dir, files: [], timeout: 0 });
      }
      for (const js of scripts) {
        try {
          new Bun.Transpiler({ loader: "js" }).scan(js);
        } catch (e) {
          problems.push(`${where(b)}: inline script doesn't parse: ${(e as Error).message}`);
        }
      }
      jobs.push({ kind: "html", block: b, files });
    } else if (mode === "scxml" && b.lang === "xml") {
      jobs.push({ kind: "scxml", block: b, allowWarnings: opts.warnings === "allow", file: opts.file });
    } else problems.push(`${where(b)}: directive "${b.directive}" doesn't apply to a ${b.lang} block`);
  }
}

// ── type-check every ts/js sample at once ─────────────────────────────────
const tsJobs = jobs.filter((j) => j.kind === "ts");
if (tsJobs.length) {
  // what a bundler's client types declare, so `import "….css"` type-checks
  await Bun.write(join(OUT, "bundler.d.ts"), 'declare module "*.css";\n');
  await Bun.write(
    join(OUT, "tsconfig.json"),
    JSON.stringify(
      { extends: "../tsconfig.json", include: ["./**/main.ts", "./bundler.d.ts"], compilerOptions: { noEmit: true } },
      null,
      2,
    ),
  );
  const tsc = Bun.spawnSync(["bun", "x", "tsc", "-p", join(OUT, "tsconfig.json")], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (tsc.exitCode !== 0) {
    const out = `${tsc.stdout}${tsc.stderr}`.trim();
    // map .doctest/<id>/main.ts back to the Markdown file
    const byId = new Map(tsJobs.map((j) => [basename(j.dir), where(j.block)]));
    problems.push(`type errors in samples:\n${out.replace(/\.doctest\/([^/]+)\/main\.ts/g, (_, id) => `[${byId.get(id) ?? id}] sample`)}`);
  }
}

// ── run ────────────────────────────────────────────────────────────────────
for (const j of tsJobs) {
  if (!j.run) continue;
  for (const f of j.files) await Bun.write(join(j.dir, basename(f)), Bun.file(join(EXAMPLES, f)));
  const cmd = j.test ? ["bun", "test", "./main.ts"] : ["bun", "main.ts"];
  const p = Bun.spawnSync(cmd, { cwd: j.dir, stdout: "pipe", stderr: "pipe", timeout: j.timeout });
  const stdout = p.stdout.toString();
  if (p.exitCode !== 0) problems.push(`${where(j.block)}: sample exited with ${p.exitCode ?? "a timeout"}\n${stdout}${p.stderr}`.trim());
  else if (j.expect !== undefined && stdout.trim() !== j.expect.trim())
    problems.push(`${where(j.block)}: output differs\n--- expected\n${j.expect.trim()}\n--- actual\n${stdout.trim()}`);
  if (verbose) console.log(`ran ${where(j.block)}`);
}

// ── html: render in happy-dom (in a separate process: custom elements register once per DOM) ──
const htmlJobs = jobs.filter((j) => j.kind === "html");
if (htmlJobs.length) {
  const spec = join(OUT, "html-jobs.json");
  await Bun.write(
    spec,
    JSON.stringify(
      await Promise.all(
        htmlJobs.map(async (j) => ({
          where: where(j.block),
          html: j.block.code,
          files: Object.fromEntries(await Promise.all(j.files.map(async (f) => [basename(f), await Bun.file(join(EXAMPLES, f)).text()]))),
        })),
      ),
    ),
  );
  const p = Bun.spawnSync(["bun", join(ROOT, "scripts/docs/html-runner.ts"), spec], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120000,
  });
  if (p.exitCode !== 0) problems.push(`html samples:\n${p.stdout}${p.stderr}`.trim());
  else if (verbose) process.stdout.write(p.stdout.toString());
}

// ── scxml: compile, no errors, no warnings ────────────────────────────────
const domParser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };
for (const j of jobs) {
  if (j.kind !== "scxml") continue;
  if (j.file) await sameAsExample(j.block, j.file);
  try {
    const model = await compile(parseSCXML(j.block.code, domParser));
    if (model.warnings.length && !j.allowWarnings)
      problems.push(`${where(j.block)}: chart has warnings: ${model.warnings.map((w) => `${w.code}: ${w.message}`).join("; ")}`);
  } catch (e) {
    problems.push(`${where(j.block)}: chart doesn't compile: ${(e as Error).message}`);
  }
}

const count = (k: Job["kind"], run?: boolean) =>
  jobs.filter((j) => j.kind === k && (run === undefined || ("run" in j && j.run === run))).length;
const tests = tsJobs.filter((j) => j.test).length;
console.log(
  `samples: ${count("ts", true) - tests} run, ${tests} bun test, ${count("ts", false)} type-checked, ${count("html")} html, ${count("scxml")} scxml, ${appFiles.length} in example apps, ${skipped.length} skipped`,
);
for (const s of skipped) console.log(`  skipped ${s}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n\n${problems.join("\n\n")}`);
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
console.log("✓ every sample passes");
