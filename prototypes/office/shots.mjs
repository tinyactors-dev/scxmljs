// node shots.mjs '<json array of {name, s, pos, tgt, js}>' : development screenshots of the live page -> out/shot-<name>.png
import { createRequire } from "node:module"; import http from "node:http"; import { readFileSync, existsSync } from "node:fs"; import path from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node-tools/node_modules/playwright");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."); // viz3d/
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f) || !f.startsWith(root)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) } });
page.on("console", (m) => console.log("page:", m.text())); page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`http://localhost:${srv.address().port}/office/index.html`); await page.waitForFunction(() => window.ready === true, null, { timeout: 90000 });
const shots = JSON.parse(process.argv[2]);
for (const s of shots) {
  await page.evaluate((s) => { const a = window.api; if (!window.state().paused) a.togglePause(); a.setPlay(s.s); if (s.pos) { a.camera.position.set(...s.pos); a.controls.target.set(...s.tgt); a.controls.update(); } if (s.js) eval(s.js); a.tick(s.tick ?? 0.1); }, s);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(root, `office/out/shot-${s.name}.png`) });
  console.log("shot", s.name, JSON.stringify(await page.evaluate(() => window.state())));
}
await browser.close(); srv.close();
