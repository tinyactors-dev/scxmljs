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
  const flat = page.locator("#flat");
  const shot = async (name, fn, arg) => {
    if (fn) await page.evaluate(fn, arg);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    await page.evaluate(() => window.blit());
    await flat.screenshot({ path: path.join(out, `${name}.png`) });
    console.log("shot", name);
  };
  const tapAt = async (q) => page.evaluate((q) => { const p = window.board.locate(q); window.board.pointer("down", p.u, p.v); window.board.pointer("up", p.u, p.v); }, q);
  await shot("1-overview", () => window.setT(7400));
  await tapAt({ storyId: "send-message" }); await shot("2-behaviour-send", () => window.setT(7400));
  await tapAt({ storyId: "send-message" });
  await tapAt({ storyId: "stop" }); await shot("2b-behaviour-stop", () => window.setT(2960.5));
  await tapAt({ storyId: "stop" });
  await page.evaluate(() => window.board.selectMessage("e630")); await shot("3-message-chain", () => window.setT(7000));
  await page.evaluate(() => { window.board.highlight({}); window.board.resetView(); });
  await page.evaluate(() => window.board.selectWorld("model-fails")); await shot("4-whatif-model-fails", () => window.setT(15000));
  await page.evaluate(() => window.board.selectWorld("stop-mid-answer")); await shot("5-whatif-stop-mid-answer", () => window.setT(7600));
  await page.evaluate(() => window.board.selectWorld("client-offline-during-tool")); await shot("5b-whatif-python-drops", () => window.setT(30000));
  await page.evaluate(() => window.board.selectWorld(null)); await page.evaluate(() => window.setT(6900));
  await page.evaluate(() => window.board.zoom(4, 0.45)); await shot("6-zoomed");
  await page.evaluate(() => { window.board.resetView(); window.board.selectStory("tools"); window.setT(7200); });
  await page.evaluate(() => window.blit());
  await page.locator("#wall").screenshot({ path: path.join(out, "7-third-size-skewed.png") });
  await page.screenshot({ path: path.join(out, "8-test-page.png") });
  console.log("shot 7, 8");
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
