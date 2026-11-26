// node record.mjs [--test s1,s2,...] -> out/office.mp4 + out/office-small.mp4 (or out/test-<s>.png)
import { createRequire } from "node:module"; import { spawn } from "node:child_process"; import http from "node:http";
import { readFileSync, existsSync, mkdirSync, renameSync } from "node:fs"; import path from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node-tools/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const root = path.resolve(here, ".."); // viz3d/
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f) || !f.startsWith(root)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r)); const port = srv.address().port;
const args = process.argv.slice(2); const ti = args.indexOf("--test"); const fps = 30; const pfx = args.includes("--prefix") ? args[args.indexOf("--prefix") + 1] : "test";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => { const t = m.text(); if (!/GL Driver|GPU stall/.test(t)) console.log("page:", t); }); page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`http://localhost:${port}/office/index.html?rec=1`); await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
const D = await page.evaluate(() => window.DURATION); mkdirSync(path.join(here, "out"), { recursive: true });
if (ti >= 0) { for (const s of args[ti + 1].split(",").map(Number)) { await page.evaluate((t) => window.setTime(t), s * 1000); await page.screenshot({ path: path.join(here, `out/${pfx}-${s}.png`) }); console.log("shot", s, JSON.stringify(await page.evaluate(() => window.state()))); } }
else {
  const final = path.join(here, "out/office.mp4"); const out = path.join(here, `out/office.${process.pid}.tmp.mp4`);
  const ff = spawn("/usr/bin/ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "veryfast", "-r", String(fps), "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const N = Math.floor((D / 1000) * fps); const t0 = Date.now();
  for (let i = 0; i < N; i++) { await page.evaluate((t) => window.setTime(t), (i * 1000) / fps); const buf = await page.screenshot({ type: "jpeg", quality: 92 }); if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r)); if (i % 150 === 0) console.log(`frame ${i}/${N} ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
  ff.stdin.end(); await new Promise((r) => ff.on("close", r));
  const small = path.join(here, `out/office-small.${process.pid}.tmp.mp4`);
  await new Promise((r) => spawn("/usr/bin/ffmpeg", ["-y", "-loglevel", "error", "-i", out, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "27", "-preset", "slow", "-movflags", "+faststart", small], { stdio: "inherit" }).on("close", r));
  renameSync(out, final); renameSync(small, path.join(here, "out/office-small.mp4"));
  console.log("done", ((Date.now() - t0) / 1000).toFixed(0), "s");
}
await browser.close(); srv.close();
