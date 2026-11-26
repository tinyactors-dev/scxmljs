// node head/film.mjs [--stills f1,f2,...] : head/out/head.mp4, the host's head across one turn with a zoom-in.
// Deterministic: each frame is setView(film time) -> screenshot -> ffmpeg.
import { createRequire } from "node:module"; import http from "node:http"; import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs"; import path from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const root = path.resolve(here, "../..");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const FPS = 30, LEN = 26, SEC0 = 8;
const key = (ks, f) => { if (f <= ks[0][0]) return ks[0][1]; for (let i = 1; i < ks.length; i++) if (f <= ks[i][0]) { const [f0, v0] = ks[i - 1], [f1, v1] = ks[i]; const u = (f - f0) / (f1 - f0); const e = u * u * (3 - 2 * u); return v0 + (v1 - v0) * e; } return ks[ks.length - 1][1]; };
const DETAIL = [[0, 0.04], [2, 0.04], [4.5, 0.5], [7, 1], [9, 1], [10.5, 0.74], [13, 0.74], [14.5, 1], [19, 1], [22, 0.34], [26, 0.3]];
const view = (f) => { const d = key(DETAIL, f); return { actor: "host", sec: SEC0 + f, detail: d, focus: "requesting", az: 0.38 - 0.55 * (f / LEN), el: 0.52 + 0.42 * d }; };
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`http://localhost:${srv.address().port}/office/head/test.html?rec=1`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
mkdirSync(path.join(here, "out"), { recursive: true });
const si = process.argv.indexOf("--stills");
if (si > 0) {
  for (const f of process.argv[si + 1].split(",").map(Number)) { await page.evaluate((v) => window.setView(v), view(f)); await page.screenshot({ path: path.join(here, "out", `film-${f}.png`) }); console.log("still", f); }
} else {
  const out = path.join(here, "out", "head.mp4");
  const ff = spawn("/usr/bin/ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-preset", "veryfast", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const N = LEN * FPS, t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await page.evaluate((v) => window.setView(v), view(i / FPS));
    const buf = await page.screenshot({ type: "jpeg", quality: 90 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 60 === 0) console.log(`frame ${i}/${N} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise((r) => ff.on("close", r)); console.log("wrote", out);
}
await browser.close(); srv.close();
