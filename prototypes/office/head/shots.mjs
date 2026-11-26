// node head/shots.mjs [name...] : stills of the head test bench into head/out/<name>.png
import { createRequire } from "node:module"; import http from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs"; import path from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const root = path.resolve(here, "../.."); // viz3d
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const SHOTS = JSON.parse(readFileSync(path.join(here, "shots.json"), "utf8"));
const want = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => console.log("page:", m.text())); page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`http://localhost:${srv.address().port}/office/head/test.html?rec=1`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
mkdirSync(path.join(here, "out"), { recursive: true });
for (const [name, v] of Object.entries(SHOTS)) {
  if (want.length && !want.includes(name)) continue;
  const r = await page.evaluate((v) => window.setView(v), v);
  await page.screenshot({ path: path.join(here, "out", `${name}.png`) });
  console.log("shot", name, JSON.stringify(r));
}
await browser.close(); srv.close();
