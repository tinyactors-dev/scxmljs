/**
 * Checks what `npm pack` would ship for @tinyactors/scxmljs: every file must
 * match an allowed pattern, and the entry points each export names must be
 * present. Builds first (the package's prepack script).
 *
 *   bun scripts/check-pack.ts
 */
import { $ } from "bun";

const pkgDir = new URL("../packages/scxmljs/", import.meta.url).pathname;
const pkg = await Bun.file(`${pkgDir}package.json`).json();

const ALLOWED = [
  /^package\.json$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^THIRD_PARTY_NOTICES$/,
  /^dist\/[\w/-]+\.(js|js\.map|d\.ts)$/,
  /^dist\/themes\/[\w-]+\.css$/,
];

const out = await $`npm pack --dry-run --json`.cwd(pkgDir).quiet().text();
const [report] = JSON.parse(out.slice(out.indexOf("["))) as {
  files: { path: string; size: number }[];
  size: number;
  unpackedSize: number;
}[];
const files = report!.files.map((f) => f.path).sort();

const unexpected = files.filter((f) => !ALLOWED.some((re) => re.test(f)));

// every file named in "exports" (and "types") must ship
const required = new Set<string>(["package.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES"]);
const collect = (v: unknown) => {
  if (typeof v === "string") required.add(v.replace(/^\.\//, ""));
  else if (v && typeof v === "object") for (const x of Object.values(v)) collect(x);
};
collect(pkg.exports);
collect(pkg.types);
const missing = [...required].filter((f) => !files.includes(f));

console.log(
  `${files.length} files, ${(report!.size / 1024).toFixed(1)} kB packed, ${(report!.unpackedSize / 1024).toFixed(1)} kB unpacked`,
);
for (const f of unexpected) console.error(`✗ unexpected file in the package: ${f}`);
for (const f of missing) console.error(`✗ missing from the package: ${f}`);
if (unexpected.length || missing.length) process.exit(1);
console.log("✓ package contents ok");
