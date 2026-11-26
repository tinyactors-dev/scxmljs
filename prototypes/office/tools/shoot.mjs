// node tools/shoot.mjs <system> <outdir> '<json [{name, s, js, tick, pause}]>'  (or @file.json)
// Stills of the LIVE page (not film mode), for before/after comparisons. `js` runs in the page with
// `api` in scope after the playhead is set; `tick` steps the world that many seconds (30 fps) so
// camera flights and pose blends settle. Prints console errors and failed requests.
import { createRequire } from "node:module"; import http from "node:http"; import { readFileSync, existsSync, mkdirSync } from "node:fs"; import path from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node-tools/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const root = path.resolve(here, "../.."); // prototypes/
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f) || !f.startsWith(root)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const [SYS, OUT, spec] = process.argv.slice(2); mkdirSync(OUT, { recursive: true });
const shots = JSON.parse(spec.startsWith("@") ? readFileSync(spec.slice(1), "utf8") : spec);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) } });
let errors = 0;
page.on("console", (m) => { const t = m.text(); if (/GL Driver|GPU stall|Automatic fallback/.test(t)) return; if (m.type() === "error" || m.type() === "warning") { errors++; console.log("page:", m.type(), t); } });
page.on("pageerror", (e) => { errors++; console.log("ERR", e.message); });
page.on("response", (r) => { if (r.status() >= 400) { errors++; console.log("HTTP", r.status(), r.url()); } });
page.on("requestfailed", (r) => { errors++; console.log("FAILED", r.url()); });
await page.goto(`http://localhost:${srv.address().port}/office/index.html?system=${SYS}&noloop`); await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
await page.evaluate(() => { const a = window.api; if (!window.state().paused) a.togglePause(); });
for (const s of shots) {
  const info = await page.evaluate(async (s) => { const api = window.api; if (s.s !== undefined) api.setPlay(s.s); if (s.pause === false && window.state().paused) api.togglePause(); if (s.js) await eval(`(async () => { ${s.js} })()`); api.tick(s.tick ?? 0.1); api.render(); if (s.js2) await eval(`(async () => { ${s.js2} })()`); if (s.tick2) { api.tick(s.tick2); api.render(); } return window.__shotInfo || null; }, s);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${s.name}.png`) });
  console.log("shot", s.name, info ? JSON.stringify(info) : "", JSON.stringify(await page.evaluate(() => { const st = window.state(); return { playS: +st.playS.toFixed(2), sel: st.sel }; })));
}
console.log("errors", errors);
await browser.close(); srv.close();
