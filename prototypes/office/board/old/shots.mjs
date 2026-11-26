// node board/shots.mjs          stills into board/out/*.png
// node board/shots.mjs --film   board/out/board.mp4 (deterministic frame stepping piped to ffmpeg)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node-tools/node_modules/playwright")); }
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "../..");
const out = path.join(here, "out"); fs.mkdirSync(out, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const film = process.argv.includes("--film");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: film ? { width: 1920, height: 800 } : { width: 2240, height: 980 } });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error("page:", m.text()); });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto(`http://127.0.0.1:${port}/office/board/test.html?film=1`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 60000 });

if (!film) {
  // node board/shots.mjs [system...]  (default: every ../data/<system> and fixtures/<name>, plus llm-chat without stories)
  const sysArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const list = sysArgs.length ? sysArgs : [
    ...fs.readdirSync(path.join(here, "../data")).filter((d) => fs.existsSync(path.join(here, "../data", d, "trace.json"))),
    ...fs.readdirSync(path.join(here, "fixtures")).filter((d) => fs.existsSync(path.join(here, "fixtures", d, "trace.json"))),
    "llm-chat?stories=0",
  ];
  for (const sys of list) {
    const [name, q] = sys.split("?"); const tag = q ? `${name}-nostories` : name;
    const dir = path.join(out, tag); fs.mkdirSync(dir, { recursive: true });
    await page.goto(`http://127.0.0.1:${port}/office/board/test.html?film=1&system=${name}${q ? "&" + q : ""}`);
    await page.waitForFunction(() => window.READY === true, null, { timeout: 60000 });
    const flat = page.locator("#flat");
    const shot = async (file) => { await page.evaluate(() => new Promise((r) => setTimeout(r, 30))); await page.evaluate(() => window.blit()); await flat.screenshot({ path: path.join(dir, `${file}.png`) }); };
    const info = await page.evaluate(() => ({ lanes: window.board.lanes, beh: window.board.behaviours, mass: window.board.massEvents, d: window.board.duration }));
    console.log(tag, "lanes:", info.lanes.map((l) => `${l.type}:${l.label}${l.swarm ? "(swarm " + l.actors.length + ")" : ""}`).join(", "), "| behaviours:", info.beh.length, "| deaths:", info.mass.deaths.length, "births:", info.mass.births.length);
    await page.evaluate((d) => window.setT(d * 0.55), info.d); await shot("1-overview");
    if (info.beh.length) {
      const i = info.beh.reduce((bi, b, j, arr) => (b.a1 - b.a0 > arr[bi].a1 - arr[bi].a0 ? j : bi), 0);
      await page.evaluate((i) => { window.board.selectEpisode(i); }, i);
      await page.evaluate((b) => window.setT(b.a0 + (b.a1 - b.a0) * 0.6), info.beh[i]); await shot("2-behaviour");
      await page.evaluate(() => window.board.selectEpisode(null));
    }
    const sw = info.lanes.find((l) => l.swarm);
    if (sw) { await page.evaluate((k) => window.board.expand(k, true), sw.key); await page.evaluate((d) => window.setT(d * 0.45), info.d); await shot("3-swarm-expanded"); await page.evaluate((k) => window.board.expand(k, false), sw.key); }
    if (info.mass.deaths.length) {
      const dth = info.mass.deaths[0];
      await page.evaluate((a) => { const b = window.board; b.resetView(); const s = b.warp(a); const u = 0.15 + 0.85 * 0; b.zoom(1, 0.5); }, dth.at);
      await page.evaluate((a) => { const b = window.board; const p = b.locate({ t: a }); b.zoom(3, p.u); }, dth.at);
      await page.evaluate((a) => window.setT(a + 1), dth.at); await shot("4-mass-death");
      await page.evaluate(() => window.board.resetView());
    }
    await page.evaluate((d) => { window.board.resetView(); window.setT(d * 0.6); }, info.d);
    await page.locator("#wall").screenshot({ path: path.join(dir, "9-third-size-skewed.png") });
  }
} else {
  const total = await page.evaluate(() => window.FILM_FRAMES);
  const ff = spawn("/usr/bin/ffmpeg", ["-y", "-f", "image2pipe", "-framerate", "30", "-c:v", "mjpeg", "-i", "-", "-vf", "scale=1280:-2:flags=lanczos", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "medium", "-movflags", "+faststart", path.join(out, "board.mp4")], { stdio: ["pipe", "ignore", "inherit"] });
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    await page.evaluate((i) => window.frame(i), i);
    const buf = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 90 === 0) console.log(`frame ${i}/${total} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise((r) => ff.on("close", r));
}
await browser.close(); server.close();
