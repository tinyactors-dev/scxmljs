// node head/inspect.mjs [--tag before|after] [--mod ./out/before/head.js] [--only system[:chart],...] [--all]
// Contact sheets of heads as the WORLD shows them (head/inspect.html): for each chart, one full frame from the
// entry camera (1440 x 900) and a sheet of 3 details x 7 visitor angles; plus measurements: plate overlaps and
// the smallest focal text at detail 1, and stillness (update with time paused moves nothing).
// Writes head/out/inspect/<tag>/<system>--<chart>-{entry,sheet}.png and report.json.
import { createRequire } from "node:module"; import http from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"; import path from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const root = path.resolve(here, "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TAG = arg("--tag", "after"), MOD = arg("--mod", ""), ONLY = arg("--only", "");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f) || !f.startsWith(root)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const outDir = path.join(here, "out", "inspect", TAG); mkdirSync(outDir, { recursive: true });
// which charts: the three reference heads, or every chart of every system (--all)
const index = JSON.parse(readFileSync(path.join(root, "data/index.json"), "utf8"));
let jobs = [];
if (process.argv.includes("--all")) {
  for (const s of index.systems) {
    const tr = JSON.parse(readFileSync(path.join(root, "data", s.id, "trace.json"), "utf8"));
    const count = new Map(); for (const e of tr.events) if (e.type === "transition") count.set(e.actor, (count.get(e.actor) || 0) + 1);
    const best = new Map(); for (const a of tr.actors) if (a.chart && tr.charts[a.chart]) { const b = best.get(a.chart); if (!b || (count.get(a.id) || 0) > (count.get(b.id) || 0)) best.set(a.chart, a); }
    for (const [chart, a] of best) jobs.push({ system: s.id, chart, actorId: a.id });
  }
} else jobs = [{ system: "single-microwave", chart: "microwave", actorId: "microwave", t: 2050 }, { system: "llm-chat", chart: "host", actorId: "host" }, { system: "support-desk", chart: "support-desk", actorId: null }];
if (ONLY) { const want = ONLY.split(","); jobs = jobs.filter((j) => want.some((w) => w === j.system || w === `${j.system}:${j.chart}`)); }
const ENTRY = Math.atan2(0.3, 1);
const COLS = [
  { name: "entry", az: 0, el: ENTRY }, { name: "left", az: -0.7, el: 0.28 }, { name: "right", az: 0.75, el: 0.22 }, { name: "above", az: 0.15, el: 0.85 },
  { name: "low side", az: 1.35, el: 0.08 }, { name: "high left", az: -1.25, el: 0.5 }, { name: "behind", az: Math.PI, el: 0.32 },
];
const ROWS = [{ detail: 0.1 }, { detail: 0.571 }, { detail: 1 }];
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("ERR", e.message)); page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console", m.text()); });
await page.goto(`http://localhost:${srv.address().port}/head/inspect.html${MOD ? "?mod=" + encodeURIComponent(MOD) : ""}`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 90000 });
const report = [];
for (const j of jobs) {
  const name = `${j.system}--${j.chart}`;
  try {
    const info = await page.evaluate((j) => window.load(j), { system: j.system, actorId: j.actorId, interactive: !!process.env.INTERACTIVE });
    const t = j.t ?? info.busy;
    const r = { name, actor: info.actor, t, levels: info.levels };
    await page.evaluate((a) => window.frame(a), { t, view: { detail: 0.571, az: 0, el: ENTRY }, title: `${name} · ${info.actor} · entry` });
    await page.screenshot({ path: path.join(outDir, `${name}-entry.png`) });
    const s = await page.evaluate((a) => window.sheet(a), { t, rows: ROWS, cols: COLS, title: `${TAG} · ${name} · ${info.actor} · t=${Math.round(t)}` });
    await page.setViewportSize({ width: s.W, height: s.H });
    await page.screenshot({ path: path.join(outDir, `${name}-sheet.png`), clip: { x: 0, y: 0, width: s.W, height: s.H } });
    await page.setViewportSize({ width: 1440, height: 900 });
    // measurements at 1440 x 900: entry, and detail 1 from the entry direction
    r.entry = await page.evaluate((a) => window.measure(a), { t, view: { detail: 0.571, az: 0, el: ENTRY } });
    r.d1 = await page.evaluate((a) => window.measure(a), { t, view: { detail: 1, az: 0, el: ENTRY } });
    r.d1left = await page.evaluate((a) => window.measure(a), { t, view: { detail: 1, az: -0.7, el: 0.28 } });
    // stillness: with t fixed, 60 updates of dt 1/60 change no matrix and no visibility
    r.still = await page.evaluate((t) => { const h = window.headApi(); const sig = () => { let s = 0, i = 0; h.group.updateMatrixWorld(true); h.group.traverse((o) => { i++; if (!o.visible) return; const e = o.matrixWorld.elements; s += (e[12] * 1.3 + e[13] * 1.7 + e[14] * 2.1 + e[0]) * ((i % 97) + 1); }); return s; }; h.update(t, 1 / 60); const a = sig(); for (let k = 0; k < 60; k++) h.update(t, 1 / 60); return Math.abs(sig() - a) < 1e-6; }, t);
    r.stats = await page.evaluate(() => window.headApi().stats());
    console.log(name, JSON.stringify({ entry: { n: r.entry.n, ov: r.entry.overlaps.length, min: +r.entry.minFocal.toFixed(1) }, d1: { n: r.d1.n, ov: r.d1.overlaps.length, small: r.d1.small.length, min: +r.d1.minFocal.toFixed(1) }, still: r.still, meshes: r.stats.meshes }));
    report.push(r);
  } catch (e) { console.log("FAIL", name, e.message); report.push({ name, error: e.message }); }
}
writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
await browser.close(); srv.close();
