/**
 * Size budgets: bundles every public entry point of @tinyactors/scxmljs for
 * the browser (minified, code-split, from the built dist/), gzips it, and
 * compares the result with size-budgets.json. Every export must have a
 * budget, so adding an entry point means adding a line there.
 *
 * `minKB` / `gzipKB` budget what a page downloads up front: the entry and the
 * chunks it imports statically. What only `import()` reaches (the QuickJS
 * build, the data model engines `<scxml-view>` loads on demand) is listed per
 * import() target; `lazyGzipKB` budgets all of it together.
 *
 *   bun scripts/size.ts            # check
 *   bun scripts/size.ts --update   # print suggested budgets (+10% headroom), don't fail
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { $ } from "bun";

const root = new URL("..", import.meta.url).pathname;
const pkgDir = `${root}packages/scxmljs/`;
const pkg = await Bun.file(`${pkgDir}package.json`).json();
type Budget = { minKB: number; gzipKB: number; lazyGzipKB?: number };
const budgets: Record<string, Budget> = await Bun.file(`${root}size-budgets.json`).json();
const update = process.argv.includes("--update");

await $`bun run build`.cwd(pkgDir).quiet();

const entries = Object.entries(pkg.exports as Record<string, string | { import?: string }>)
  .filter(([sub]) => sub !== "./package.json")
  .map(([sub, target]) => ({
    name: sub === "." ? pkg.name : `${pkg.name}/${sub.slice(2)}`,
    file: `${pkgDir}${(typeof target === "string" ? target : target.import!).replace(/^\.\//, "")}`,
  }));

let failed = false;
const rows: string[][] = [];
const suggestions: Record<string, Budget> = {};
const gz = (b: Uint8Array<ArrayBuffer>) => Bun.gzipSync(b, { level: 9 }).length / 1024;
const concat = (parts: Uint8Array<ArrayBuffer>[]) => new TextEncoder().encode(parts.map((p) => new TextDecoder().decode(p)).join("\n"));
const kb = (n: number) => `${n.toFixed(1)} KB`;
for (const { name, file } of entries) {
  const bytes = await bundle(name, file);
  const minKB = bytes.initial.length / 1024;
  const gzipKB = gz(bytes.initial);
  const lazy = bytes.lazy.map((b) => ({ minKB: b.length / 1024, gzipKB: gz(b) })).sort((a, b) => b.gzipKB - a.gzipKB);
  const lazyTotal = lazy.length ? gz(concat(bytes.lazy)) : undefined;
  suggestions[name] = { minKB: Math.ceil(minKB * 1.1), gzipKB: Math.ceil(gzipKB * 1.1) };
  if (lazyTotal !== undefined) suggestions[name]!.lazyGzipKB = Math.ceil(lazyTotal * 1.1);
  const budget = budgets[name];
  let status = "ok";
  if (!budget) status = "NO BUDGET";
  else if (minKB > budget.minKB || gzipKB > budget.gzipKB) status = "OVER";
  else if (lazyTotal !== undefined && lazyTotal > (budget.lazyGzipKB ?? 0)) status = "LAZY OVER";
  if (status !== "ok") failed = true;
  rows.push([name, kb(minKB), budget ? `${budget.minKB} KB` : "—", kb(gzipKB), budget ? `${budget.gzipKB} KB` : "—", status]);
  for (const l of lazy) rows.push(["  + import()", kb(l.minKB), "", kb(l.gzipKB), "", ""]);
  if (lazyTotal !== undefined)
    rows.push(["  = all import()s", "", "", kb(lazyTotal), budget?.lazyGzipKB ? `${budget.lazyGzipKB} KB` : "—", ""]);
}

/** Bundle one entry with code splitting; split the output into what loads up front and what each `import()` loads. */
async function bundle(name: string, file: string): Promise<{ initial: Uint8Array<ArrayBuffer>; lazy: Uint8Array<ArrayBuffer>[] }> {
  const js = file.endsWith(".js");
  const outdir = await mkdtemp(`${tmpdir()}/scxmljs-size-`);
  const out = await Bun.build({ entrypoints: [file], target: "browser", minify: true, splitting: js, outdir });
  if (!out.success) throw new Error(`could not bundle ${name}: ${out.logs.join("\n")}`);
  const enc = new TextEncoder();
  if (!js) return { initial: new Uint8Array(await out.outputs[0]!.arrayBuffer()), lazy: [] };
  const files = new Map<string, string>();
  for (const o of out.outputs) files.set(o.path.replace(/^.*\//, ""), await o.text());
  const entry = out.outputs.find((o) => o.kind === "entry-point")!.path.replace(/^.*\//, "");
  const staticImports = (code: string) => [...code.matchAll(/(?:from|import)\s*["']\.\/([\w.-]+\.js)["']/g)].map((m) => m[1]!);
  const dynamicImports = (code: string) => [...code.matchAll(/import\(\s*["']\.\/([\w.-]+\.js)["']\s*\)/g)].map((m) => m[1]!);
  const closure = (root: string, seen = new Set<string>()) => {
    const visit = (f: string) => {
      if (seen.has(f) || !files.has(f)) return;
      seen.add(f);
      for (const d of staticImports(files.get(f)!)) visit(d);
    };
    visit(root);
    return seen;
  };
  const initial = closure(entry);
  const join = (set: Iterable<string>) => enc.encode([...set].map((f) => files.get(f)!).join("\n"));
  // one row per import() target: the chunk and what it pulls in that isn't loaded already
  const targets = new Set([...files.values()].flatMap(dynamicImports));
  const lazy = [...targets].filter((t) => !initial.has(t)).map((t) => join([...closure(t)].filter((f) => !initial.has(f))));
  return { initial: join(initial), lazy };
}

const header = ["entry", "minified", "budget", "gzip", "budget", ""];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
for (const r of [header, ...rows]) console.log(r.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  "));

if (update) {
  console.log(`\nsuggested size-budgets.json (+10% headroom):\n${JSON.stringify(suggestions, null, 2)}`);
} else if (failed) {
  console.error("✗ size budget exceeded or missing (see size-budgets.json; `bun scripts/size.ts --update` suggests values)");
  process.exit(1);
} else console.log("✓ all entry points within budget");
