// node board/capture.mjs <tag> [target...]   targets: live:microwave live:checkout system:fulfillment ...
// Stills for judging the board as a stranger: the start view, a close-up of the board, and the board's canvas
// itself, at rest and after a few events. Writes out/board/<tag>/<target>-<n>-<what>.png. Prints page errors.
import { createRequire } from "node:module"; import http from "node:http"; import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"; import path from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node-tools/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const root = path.resolve(here, "../.."); // prototypes/
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".scxml": "application/xml" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f) || !f.startsWith(root)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const [TAG, ...targets] = process.argv.slice(2);
const OUT = path.join(here, "..", "out", "board", TAG); mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
// what to press in each live system (labels), and the seconds of a recorded run to look at
const PRESSES = { microwave: [/^TURN ON$/, "advance", /^OPEN DOOR$/], checkout: [/ADD NOTEBOOK/, /^CHECKOUT$/, /^SHIP/] };
const SECONDS = [0.3, 0.55, 0.9]; // fractions of a recorded run
let errors = 0;
for (const target of targets.length ? targets : ["live:microwave", "live:checkout", "system:fulfillment"]) {
  const [kind, id] = target.split(":"); const name = target.replace(":", "-");
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("console", (m) => { const t = m.text(); if (/GL Driver|GPU stall|Automatic fallback/.test(t)) return; if (m.type() === "error") { errors++; console.log(name, "page error:", t); } });
  page.on("pageerror", (e) => { errors++; console.log(name, "ERR", e.message); });
  const q = kind === "live" ? `live=${id}` : `system=${id}`;
  await page.goto(`http://localhost:${srv.address().port}/office/index.html?${q}&noloop`); await page.waitForFunction(() => window.ready === true, null, { timeout: 180000 });
  const shoot = async (n, what) => {
    // the start view, the board close up (from the room, 2/3 of the way across), and the board's canvas
    await page.evaluate(() => { const a = window.api; const v = window.live ? a.startView() : a.homeView(); a.camera.position.copy(v.pos); a.controls.target.copy(v.tgt); a.controls.update(); a.tick(0.1); a.render(); });
    await page.screenshot({ path: path.join(OUT, `${name}-${n}-${what}-start.png`) });
    await page.evaluate(() => { const a = window.api, b = a.plan.board; const d = Math.max(3, b.w * 0.95); a.camera.position.set(b.x + d, 2.2, b.z); a.controls.target.set(b.x, 2.45, b.z); a.controls.update(); a.tick(0.1); a.render(); });
    await page.screenshot({ path: path.join(OUT, `${name}-${n}-${what}-board.png`) });
    const url = await page.evaluate(() => { const b = window.api.board(); return b ? b.canvas.toDataURL("image/png") : null; });
    if (url) writeFileSync(path.join(OUT, `${name}-${n}-${what}-canvas.png`), Buffer.from(url.split(",")[1], "base64"));
    console.log("shot", name, n, what);
  };
  if (kind === "live") {
    await page.evaluate(() => window.api.tick(0.5));
    await shoot(0, "rest");
    let n = 1;
    for (const p of PRESSES[id] || []) {
      await page.evaluate(async (src) => {
        const l = window.live; if (src === "advance") { const c = l.screen().find((x) => x.id === "time:advance"); l.pressControl(c.id); }
        else { const re = new RegExp(src); const c = l.screen().find((x) => re.test(x.label) && x.enabled) || l.screen().find((x) => re.test(x.label)); if (c) l.pressControl(c.id); }
      }, p === "advance" ? "advance" : p.source);
      await page.waitForFunction(() => !window.live.busy, null, { timeout: 60000 });
      for (let i = 0; i < 12; i++) { const rest = await page.evaluate(() => { window.api.tick(0.5); return window.live.atRest(); }); if (rest) break; }
      await shoot(n++, String(p === "advance" ? "advance" : p.source).replace(/[^a-z]+/gi, "").toLowerCase());
    }
    // the moment the mail flies: a press, then only a little time
    const p0 = (PRESSES[id] || [])[0];
    if (id === "microwave") { await page.evaluate(() => { const l = window.live; const c = l.screen().find((x) => /^CLOSE DOOR$/.test(x.label)); if (c) l.pressControl(c.id); }); await page.waitForFunction(() => !window.live.busy, null, { timeout: 60000 }); await page.evaluate(() => { const a = window.api, sim = a.sim; const ms = sim.messagesBetween(-Infinity, Infinity); const m = ms[ms.length - 1]; const [s0, s1] = sim.flight(m); a.setPlay(s0 + (s1 - s0) * 0.45); a.tick(0.02); window.__f = [s0, s1, a.getPlay()]; }); console.log("flight", await page.evaluate(() => window.__f)); await shoot(n++, "inflight"); }
  } else {
    await page.evaluate(() => { const a = window.api; if (!window.state().paused) a.togglePause(); });
    let n = 0;
    for (const f of SECONDS) { await page.evaluate((f) => { const a = window.api; a.setPlay(window.state().loop * f); a.tick(0.1); }, f); await shoot(n++, `at${Math.round(f * 100)}`); }
    // a capsule in the middle of its flight: the board's arrow should be growing, the room's capsule in the tube
    await page.evaluate(() => { const a = window.api, sim = a.sim; const ms = sim.messagesBetween(-Infinity, Infinity); const m = ms[Math.floor(ms.length * 0.4)]; const [s0, s1] = sim.flight(m); a.setPlay(s0 + (s1 - s0) * 0.45 - 0.2); a.tick(0.2); });
    await shoot(n++, "inflight");
  }
  await page.close();
}
console.log("errors", errors);
await browser.close(); srv.close();
