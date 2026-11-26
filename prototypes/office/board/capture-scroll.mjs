// node board/capture-scroll.mjs [target...]   targets: system:fulfillment system:order-api live:microwave live:checkout
// The board as a scrollable window: start view; the board's empty part touched (the camera stands in front of it);
// scrolled sideways and up into history (through perform, as the visitor's wheel); Escape back.
// Writes out/board/scroll/<target>-<n>-<what>.png (screen) and -canvas.png (the board itself). Prints page errors.
import { createRequire } from "node:module"; import http from "node:http"; import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"; import path from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node-tools/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const root = path.resolve(here, "../..");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".scxml": "application/xml" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f) || !f.startsWith(root)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const OUT = path.join(here, "..", "out", "board", "scroll"); mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const targets = process.argv.slice(2); let errors = 0;
for (const target of targets.length ? targets : ["system:fulfillment", "system:order-api", "live:microwave", "live:checkout"]) {
  const [kind, id] = target.split(":"); const name = `${kind}-${id}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("console", (m) => { const t = m.text(); if (/GL Driver|GPU stall|Automatic fallback/.test(t)) return; if (m.type() === "error") { errors++; console.log(name, "console", t); } });
  page.on("pageerror", (e) => { errors++; console.log(name, "ERR", e.message); });
  await page.goto(`http://localhost:${srv.address().port}/office/index.html?${kind === "live" ? "live" : "system"}=${id}&noloop`); await page.waitForFunction(() => window.ready === true, null, { timeout: 180000 });
  let n = 0;
  const shot = async (what) => {
    await page.evaluate(() => { window.api.tick(0.05); window.api.render(); });
    await page.screenshot({ path: path.join(OUT, `${name}-${n}-${what}.png`) });
    const url = await page.evaluate(() => window.api.board().canvas.toDataURL("image/png")); writeFileSync(path.join(OUT, `${name}-${n}-${what}-canvas.png`), Buffer.from(url.split(",")[1], "base64"));
    console.log(name, n, what, JSON.stringify(await page.evaluate(() => { const s = window.api.board().state; return { pinned: s.pinned, scrollX: Math.round(s.scrollX), viewTop: Math.round(s.viewTop), contentH: Math.round(s.contentH), contentW: Math.round(s.contentW), cam: window.api.camera.position.toArray().map((x) => +x.toFixed(2)) }; })));
    n++;
  };
  // the run under way: a recorded one at 55 %, a live one after a few presses
  if (kind === "live") {
    const presses = id === "microwave" ? ["^TURN ON$", "advance", "^OPEN DOOR$", "^CLOSE DOOR$", "advance"] : ["ADD NOTEBOOK", "ADD MUG", "^CHECKOUT$", "^SHIP"];
    for (const p of presses) {
      await page.evaluate((src) => { const l = window.live; const c = src === "advance" ? l.screen().find((x) => x.id === "time:advance") : l.screen().find((x) => new RegExp(src).test(x.label) && x.enabled) || l.screen().find((x) => new RegExp(src).test(x.label)); if (c) l.pressControl(c.id); }, p);
      await page.waitForFunction(() => !window.live.busy, null, { timeout: 60000 });
      for (let i = 0; i < 12; i++) { const rest = await page.evaluate(() => { window.api.tick(0.5); return window.live.atRest(); }); if (rest) break; }
    }
    await page.evaluate(() => { const a = window.api, v = a.startView(); a.camera.position.copy(v.pos); a.controls.target.copy(v.tgt); a.controls.update(); a.tick(0.3); });
  } else {
    await page.evaluate(() => { const a = window.api; if (!window.state().paused) a.togglePause(); a.setPlay(window.state().loop * 0.55); const h = a.homeView(); a.camera.position.copy(h.pos); a.controls.target.copy(h.tgt); a.controls.update(); a.tick(0.3); });
  }
  await shot("start");
  if (kind === "system") { // a row hovered (as the pointer over the board does): its receiver's hover ring in the room
    console.log(name, "hover", await page.evaluate(() => { const a = window.api, b = a.board(); const r = b.rows.filter((x) => x.kind === "mail").pop(); if (!r) return null; const c = b.columns.find((k) => k.ids.includes(r.to[0])); b.pointer("move", Math.min(0.95, Math.max(0.05, c.u)), r.v); a.tick(0.1); return r; }));
    await shot("hover");
    await page.evaluate(() => { window.api.board().pointer("leave", 0, 0); });
  }
  // the board's empty margin touched, as a tap would: the camera stands squarely in front of it
  await page.evaluate(() => { const a = window.api; a.perform({ do: "board", type: "tap", u: 0.004, v: 0.5 }); a.tick(1.8); });
  await shot("front");
  // the wheel sideways (across the columns), then up (back through history)
  await page.evaluate(() => { const a = window.api; a.perform({ do: "board", type: "wheel", u: 0.5, v: 0.5, extra: { dx: 700, dy: 0 } }); a.tick(0.2); });
  await shot("sideways");
  await page.evaluate(() => { const a = window.api; for (let i = 0; i < 4; i++) a.perform({ do: "board", type: "wheel", u: 0.5, v: 0.4, extra: { dx: 0, dy: -180 } }); a.tick(0.2); });
  await shot("history");
  if (kind === "system") { // time goes on while scrolled up: the view stays; then "jump to now"
    await page.evaluate(() => { const a = window.api; a.setPlay(window.state().playS + 2.5); a.tick(0.3); });
    await shot("scrolled-while-time-runs");
    await page.evaluate(() => { const a = window.api, b = a.board(); a.perform({ do: "board", type: "tap", u: (1600 - 16 - 34 - 210 + 98) / 1600, v: (b.state.viewH + 88 + 10 - 70 + 26) / 900 }); a.tick(0.3); });
    await shot("jumped-to-now");
    // the scrubber's knob dragged: time moves
    await page.evaluate(() => { const a = window.api; a.perform({ do: "board", type: "down", u: 0.5, v: 0.05 }); a.perform({ do: "board", type: "move", u: 0.3, v: 0.05 }); a.perform({ do: "board", type: "up", u: 0.3, v: 0.05 }); a.tick(0.3); window.__p = window.state().playS; });
    console.log(name, "after scrub playS", await page.evaluate(() => window.__p));
    await shot("scrubbed");
  }
  // Escape: back where we were
  await page.evaluate(() => { const a = window.api; a.perform({ do: "back" }); a.tick(1.6); });
  await shot("escape");
  await page.close();
}
console.log("errors", errors); await browser.close(); srv.close();
