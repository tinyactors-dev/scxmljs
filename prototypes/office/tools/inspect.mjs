// node tools/inspect.mjs [--cases a,b] [--no-sheets] [--out dir]
// The close-up regression test for the people (QUALITY.md P1-P5): renders tools/inspect.html (one
// person at a desk) in every pose, reaction and transition, and
//   1. runs the intersection check at several animation phases: limb boxes against the head, neck,
//      torso, the other arm, the legs, and the desk, monitor, keyboard, phone, basket, partitions and
//      chair (oriented-box overlap), arm length (never stretched), head roll and pitch; fails (exit 1)
//      on any penetration beyond the allowed contact;
//   2. writes a contact sheet per case: 8 angles at 1 m (top row) and at 3 m (bottom row), and one
//      sheet of every case at 4 phases from the front, to out/inspect/.
import { createRequire } from "node:module"; import http from "node:http"; import { readFileSync, existsSync, mkdirSync } from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node-tools/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const root = path.resolve(here, "../.."); // prototypes/
const args = process.argv.slice(2); const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = path.resolve(opt("--out", path.join(here, "../out/inspect"))); mkdirSync(OUT, { recursive: true });
const sheets = !args.includes("--no-sheets");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f) || !f.startsWith(root)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
let errors = 0; page.on("pageerror", (e) => { errors++; console.log("ERR", e.message); }); page.on("console", (m) => { if (m.type() === "error") { errors++; console.log("page:", m.text()); } });
await page.goto(`http://localhost:${srv.address().port}/office/tools/inspect.html`); await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
const all = await page.evaluate(() => window.inspect.cases);
const cases = opt("--cases", null)?.split(",") || all;
const PHASES = [0, 0.37, 0.81, 1.23, 2.9, 4.4];
let fails = 0; const report = [];
for (const c of cases) {
  const res = [];
  for (const ph of PHASES) { const r = await page.evaluate(([c, ph]) => { window.inspect.setPose(c, ph); return window.inspect.check(); }, [c, ph]); if (r.violations.length) res.push({ phase: ph, ...r }); else if (r.short.length) res.push({ phase: ph, violations: [], short: r.short }); }
  const bad = res.filter((r) => r.violations.length);
  if (bad.length) { fails++; console.log(`FAIL ${c}:`, bad.map((r) => `@${r.phase} ` + r.violations.map((v) => `${v.a}x${v.b} ${v.pen}m`).join(", ")).join(" | ")); }
  else console.log(`ok   ${c}${res.length ? "  (short of target: " + res.map((r) => `@${r.phase} ` + r.short.map((s) => s.arm + " " + s.by).join(",")).join(" ") + ")" : ""}`);
  report.push({ case: c, results: res });
  if (sheets) {
    const files = [];
    for (const dist of [1, 3]) for (let a = 0; a < 8; a++) { await page.evaluate(([c, a, dist]) => { window.inspect.setPose(c, 0.6); window.inspect.setView(a, dist); window.inspect.render(); }, [c, a, dist]); const f = path.join(OUT, `_${c}-${dist}-${a}.png`); await page.screenshot({ path: f }); files.push(f); }
    execFileSync("montage", [...files, "-tile", "8x2", "-geometry", "240x180+1+1", "-title", `${c}${bad.length ? "  (INTERSECTS)" : ""}`, path.join(OUT, `pose-${c}.png`)]);
    execFileSync("rm", files);
  }
}
if (sheets) {
  const files = [];
  for (const c of cases) for (const ph of [0, 0.37, 0.81, 2.9]) { await page.evaluate(([c, ph]) => { window.inspect.setPose(c, ph); window.inspect.setView(0.6, 2.4); window.inspect.render(); }, [c, ph]); const f = path.join(OUT, `_ph-${c}-${ph}.png`); await page.screenshot({ path: f }); files.push(f); }
  execFileSync("montage", [...files, "-tile", "8x", "-geometry", "240x180+1+1", path.join(OUT, "phases.png")]); execFileSync("rm", files);
}
console.log(`${cases.length - fails}/${cases.length} cases pass the intersection check; page errors ${errors}`);
await browser.close(); srv.close();
process.exit(fails || errors ? 1 : 0);
