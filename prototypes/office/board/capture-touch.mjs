// node board/capture-touch.mjs: the board's links to the room, in order-api: a person selected in the room lights
// their column; a row touched lights its people in the room and goes to its moment. Writes out/board/after/touch-*.png.
import { createRequire } from "node:module"; import http from "node:http"; import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"; import path from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node-tools/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const root = path.resolve(here, "../..");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f) || !f.startsWith(root)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const OUT = path.join(here, "..", "out", "board", "after"); mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
let errors = 0; page.on("pageerror", (e) => { errors++; console.log("ERR", e.message); }); page.on("console", (m) => { if (m.type() === "error" && !/GL Driver|GPU stall/.test(m.text())) { errors++; console.log("console", m.text()); } });
await page.goto(`http://localhost:${srv.address().port}/office/index.html?system=order-api&noloop`); await page.waitForFunction(() => window.ready === true, null, { timeout: 180000 });
const canvas = async (name) => { const url = await page.evaluate(() => window.api.board().canvas.toDataURL("image/png")); writeFileSync(path.join(OUT, name), Buffer.from(url.split(",")[1], "base64")); };
// 1. the room selects order-4: its column lights up
await page.evaluate(() => { const a = window.api; if (!window.state().paused) a.togglePause(); a.setPlay(9.6); a.tick(0.1); a.select("order-4"); a.tick(1.6); a.render(); });
await canvas("touch-1-room-selects-order4-canvas.png"); await page.screenshot({ path: path.join(OUT, "touch-1-room-selects-order4.png") });
// 2. back home; a row touched on the board (through perform, as a visitor's tap): the people and the mail light up
const info = await page.evaluate(() => { const a = window.api; a.back && a.back(); a.reset(); const h = a.homeView(); a.camera.position.copy(h.pos); a.controls.target.copy(h.tgt); a.controls.update(); a.setPlay(10.2); a.tick(0.1);
  const b = a.board(); const r = b.rows.find((x) => x.kind === "mail"); const fc = b.columns.find((c) => c.ids.includes(r.from)), tc = b.columns.find((c) => c.ids.includes(r.to[0]));
  a.perform({ do: "board", type: "tap", u: (fc.u + tc.u) / 2, v: r.v }); a.tick(0.45); a.render(); return { row: r, playS: window.state().playS }; });
console.log("tapped", JSON.stringify(info));
await canvas("touch-2-row-tapped-canvas.png"); await page.screenshot({ path: path.join(OUT, "touch-2-row-tapped.png") });
console.log("errors", errors); await browser.close(); srv.close();
