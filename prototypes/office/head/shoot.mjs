// node head/shoot.mjs <out.png> <page?query> [setView JSON] : one still of a head page (gallery or test bench)
import { createRequire } from "node:module"; import http from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs"; import path from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const root = path.resolve(here, ".."); // prototypes/office
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f) || !f.startsWith(root)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const jobs = []; const a = process.argv.slice(2);
for (let i = 0; i < a.length; ) { const out = a[i++], page = a[i++]; let views = null; if (a[i] && a[i].startsWith("{")) views = JSON.parse(a[i++]); jobs.push({ out, page, views }); }
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("ERR", j.page, e.message)); page.on("console", (m) => { if (m.type() === "error") console.log("console", m.text()); });
  await page.goto(`http://localhost:${srv.address().port}/head/${j.page}${j.page.includes("?") ? "&" : "?"}rec=1`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 90000 });
  if (j.views) console.log(JSON.stringify(await page.evaluate((v) => window.setView(v), j.views)));
  mkdirSync(path.dirname(path.resolve(j.out)), { recursive: true });
  await page.screenshot({ path: j.out }); console.log("shot", j.out); await page.close();
}
await browser.close(); srv.close();
