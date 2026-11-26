// node tools/explore.mjs [--system <name> | --live <name>] [--persona clicker|orbiter|impatient|phone|lost]
//                        [--seconds N (app seconds)] [--seed n] [--out dir] [--replay-fps 2] [--no-replay] [--no-analyse] [--arm]
// A first-time visitor, simulated: drives the real page (its animation loop running, as a visitor
// sees it) with real pointer, wheel, key and touch events through Playwright, choosing what to touch
// from what is on screen (the recorder's own view sample: window.officeLog.lastView, the same
// rectangles a visitor sees). Then it saves the session's flight-recorder log, runs
// tools/analyse.mjs on it and tools/replay.mjs for contact sheets.
//
// Personas:
//   clicker    taps what looks interesting: big things in view, weighted by size; enters heads, taps machines, backs out
//   orbiter    drags and zooms a lot, then taps something
//   impatient  taps fast, double-taps, presses Escape
//   phone      touch at 390 x 800: taps, one-finger drags, pinches
//   lost       taps empty floor and walls, drags a little, presses keys at random
//   script     --script <file.json>: a list of steps done in order with real input (a visit to reproduce, e.g. the
//              owner's own from a log): {do: "key", key, ms} holds a key for ms of app time; {do: "tap", control: id}
//              | {actor: id} | {headEvent: event} | {headState: id}; {do: "wait", ms}; {do: "esc"}; {do: "export"}
// Software rendering makes frame rates meaningless here; the log says it ran on SwiftShader and the
// analyser excludes feel findings and scales app-paced thresholds by the measured slowdown.
import { createRequire } from "node:module"; import http from "node:http"; import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"; import path from "node:path"; import { gzipSync } from "node:zlib"; import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node-tools/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const root = path.resolve(here, "../.."); // prototypes/

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SYS = opt("--system", null), LIVE = opt("--live", null), PERSONA = opt("--persona", "clicker"), SECONDS = Number(opt("--seconds", 60)), SEED = Number(opt("--seed", 1));
const SCRIPT = opt("--script", null) ? JSON.parse(readFileSync(opt("--script"), "utf8")) : null;
const name = `${LIVE ? "live-" + LIVE : SYS || "llm-chat"}--${SCRIPT ? "script" : PERSONA}`;
const OUT = opt("--out", path.join(here, "../out/explore", name)); mkdirSync(OUT, { recursive: true });
const query = (LIVE ? `live=${LIVE}` : `system=${SYS || "llm-chat"}`) + (args.includes("--arm") ? "&log=1" : "");

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".scxml": "application/xml" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f) || !f.startsWith(root)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const phone = PERSONA === "phone";
const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("console", (m) => { const t = m.text(); if (/GL Driver|GPU stall|Automatic fallback/.test(t)) return; if (m.type() === "error" || m.type() === "warning") pageErrors.push(t); });
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("response", (r) => { if (r.status() >= 400) pageErrors.push(`HTTP ${r.status()} ${r.url()}`); });
await page.goto(`http://localhost:${srv.address().port}/office/index.html?${query}`); await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
await page.evaluate(([p, s]) => { window.officeLog.session.synthetic = { persona: p, seed: s, tool: "explore.mjs" }; }, [PERSONA, SEED]);
const cdp = phone ? await ctx.newCDPSession(page) : null;

// ---- a seeded generator
let rs = SEED * 2654435761 >>> 0; const rnd = () => { rs = (rs + 0x6d2b79f5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pickW = (xs, w) => { const tot = xs.reduce((a, x) => a + w(x), 0); let r = rnd() * tot; for (const x of xs) { r -= w(x); if (r <= 0) return x; } return xs[xs.length - 1]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vw = phone ? 390 : 1280, vh = phone ? 800 : 720;
const view = () => page.evaluate(() => ({ v: window.officeLog.lastView, mode: window.state().sel, live: !!window.live }));
const NEVER = new Set(["directory", "recorder"]); // navigating away or downloading ends the visit early
const things = (v, kinds) => (v?.in || []).filter((x) => !NEVER.has(x[0]) && (!kinds || kinds.includes(x[0]))).map(([kind, id, x0, y0, x1, y1, pct]) => ({ kind, id, x0, y0, x1, y1, pct, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }));
const jit = (r) => (rnd() - 0.5) * 2 * r;

async function tap(x, y) {
  x = Math.max(2, Math.min(vw - 2, Math.round(x))); y = Math.max(2, Math.min(vh - 2, Math.round(y)));
  if (phone) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
}
async function hover(x, y) { if (!phone) await page.mouse.move(Math.round(x), Math.round(y), { steps: 3 }); }
async function drag(x0, y0, dx, dy, steps = 8, button = "left") {
  if (phone) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id: 1 }] });
    for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (dx * i) / steps, y: y0 + (dy * i) / steps, id: 1 }] }); await sleep(40); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.move(x0, y0); await page.mouse.down({ button });
    for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps); await sleep(40); }
    await page.mouse.up({ button });
  }
}
async function pinch(cx, cy, from, to, steps = 8) {
  const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(from) });
  for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(from + ((to - from) * i) / steps) }); await sleep(40); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const wheel = async (x, y, dy) => { await page.mouse.move(x, y); await page.mouse.wheel(0, dy); };
const key = (k) => page.keyboard.press(k);
const inHead = (m) => m && /entering|inside/.test(m.stage);

// ---- the personas: each step does one thing and says how long to think afterwards (wall ms)
const personas = {
  async clicker() {
    const { v, mode } = await view();
    if (inHead(mode)) { // inside a head: tap the middle of what is there, now and then go back out
      if (rnd() < 0.3) { await key("Escape"); return 1800; }
      await tap(vw / 2 + jit(vw * 0.25), vh / 2 + jit(vh * 0.2)); return 1800;
    }
    if (mode && mode.stage === "approach" && rnd() < 0.6) { const me = things(v, ["actor"]).find((t) => t.id === mode.id); if (me) { await hover(me.cx, me.cy); await tap(me.cx + jit(4), me.cy - (me.y1 - me.y0) * 0.25); return 3500; } }
    const xs = things(v); if (!xs.length) { await key("Escape"); return 2000; }
    const t = pickW(xs, (x) => Math.sqrt(x.pct + 0.05) * (x.kind === "control" ? 2.5 : x.kind === "actor" ? 2 : 1));
    await hover(t.cx, t.cy); await sleep(150); await tap(t.cx + jit((t.x1 - t.x0) * 0.15), t.cy + jit((t.y1 - t.y0) * 0.15)); return 1500 + rnd() * 1000;
  },
  async orbiter() {
    const r = rnd();
    if (r < 0.45) { await drag(vw / 2 + jit(200), vh / 2 + jit(120), jit(320), jit(140), 10); return 900; }
    if (r < 0.75) { const dy = (rnd() < 0.5 ? -1 : 1) * (100 + rnd() * 300); for (let i = 0; i < 3; i++) await wheel(vw / 2 + jit(150), vh / 2 + jit(100), dy); return 900; }
    if (r < 0.82) { await drag(vw / 2, vh / 2, jit(200), jit(100), 8, "right"); return 900; }
    return personas.clicker();
  },
  async impatient() {
    const { v, mode } = await view();
    if (rnd() < 0.25) { await key("Escape"); return 400; }
    const xs = things(v); const t = xs.length ? xs[Math.floor(rnd() * xs.length)] : { cx: rnd() * vw, cy: rnd() * vh, x0: 0, x1: 0, y0: 0, y1: 0 };
    await tap(t.cx + jit(6), t.cy + jit(6)); if (rnd() < 0.3) { await sleep(120); await tap(t.cx + jit(6), t.cy + jit(6)); }
    void mode; return 400 + rnd() * 500;
  },
  async phone() {
    const r = rnd();
    if (r < 0.2) { await drag(vw / 2 + jit(80), vh / 2 + jit(150), jit(180), jit(120), 8); return 1000; }
    if (r < 0.32) { const zin = rnd() < 0.5; await pinch(vw / 2, vh / 2, zin ? 80 : 240, zin ? 240 : 80); return 1000; }
    return personas.clicker();
  },
  async lost() {
    const { v } = await view(); const xs = things(v).concat((v?.in || []).filter((x) => NEVER.has(x[0])).map(([kind, id, x0, y0, x1, y1]) => ({ x0, y0, x1, y1 })));
    const r = rnd();
    if (r < 0.15) { await drag(vw / 2, vh / 2, jit(150), jit(60), 6); return 1200; }
    if (r < 0.25) { await key(["Escape", "h", "ArrowUp", " ", "w"][Math.floor(rnd() * 5)]); return 1500; }
    for (let k = 0; k < 30; k++) { const x = 20 + rnd() * (vw - 40), y = 20 + rnd() * (vh - 40); if (!xs.some((t) => x > t.x0 - 10 && x < t.x1 + 10 && y > t.y0 - 10 && y < t.y1 + 10)) { await hover(x, y); await tap(x, y); return 2000 + rnd() * 1500; } }
    await tap(rnd() * vw, rnd() * vh); return 2000;
  },
};
// ---- a scripted visit: real keys and taps at the screen points the page reports for what each step names
let si = 0;
async function where(step) {
  return page.evaluate((st) => {
    const api = window.api, cam = api.camera, W = innerWidth, H = innerHeight; const V = (p) => { const q = p.clone().project(cam); return q.z > 1 || Math.abs(q.x) > 1 || Math.abs(q.y) > 1 ? null : { x: (q.x + 1) / 2 * W, y: (1 - q.y) / 2 * H }; };
    cam.updateMatrixWorld();
    if (st.control) { const c = window.live.screen().find((x) => x.id === st.control); return c && c.x != null ? { x: c.x, y: c.y } : null; }
    if (st.actor) { const c = api.people.headCenter(st.actor, api.getPlay()); return c ? V(c.clone().add({ x: 0, y: -0.05, z: 0 })) : null; }
    const h = window.state().sel && api.heads.get(window.state().sel.id); if (!h) return null;
    if (st.headEvent) { const a = h.affordances().find((x) => x.event === st.headEvent && x.object); if (!a) return null; const p = a.object.getWorldPosition(cam.position.clone()); return V(p); }
    if (st.headState) { const b = h.boundsOf(st.headState); return V(b.center); }
    return null;
  }, step);
}
async function scripted() {
  if (si >= SCRIPT.length) return -1;
  const st = SCRIPT[si++]; const label = JSON.stringify(st);
  if (st.do === "wait") return st.ms;
  if (st.do === "esc") { await key("Escape"); return st.after ?? 1500; }
  if (st.do === "export") { await page.evaluate(() => window.api.perform({ do: "export" })).catch(() => {}); return 300; }
  if (st.do === "key") { const k = st.key.length === 1 ? st.key.toLowerCase() : st.key; await page.keyboard.down(k); await think(st.ms); await page.keyboard.up(k); return st.after ?? 400; }
  if (st.do === "tap") { let p = await where(st);
    // a person walked out of view: the visitor looks for them the way a visitor can, with H (back to the start view)
    if (!p && st.actor) { await key("h"); await think(1800); p = await where(st); }
    if (!p) { pageErrors.push("script: nothing on screen for " + label); return 500; } await hover(p.x, p.y); await sleep(80); await tap(p.x, p.y); return st.after ?? 1500; }
  pageErrors.push("script: unknown step " + label); return 100;
}
if (SCRIPT) personas.script = scripted;
const act = personas[SCRIPT ? "script" : PERSONA]; if (!act) { console.error("unknown persona", PERSONA); process.exit(2); }
// think time is APP time (the app's own clock, which a software renderer slows down: a visitor reacts
// to what they see move), and every persona but the impatient one waits for a camera flight to end
const appNow = () => page.evaluate(() => window.officeLog.appNow());
async function think(ms) {
  const a0 = await appNow(), w0 = Date.now();
  while (Date.now() - w0 < 30000) { const busy = PERSONA !== "impatient" && (await page.evaluate(() => !!window.api.rig.flight)); if ((await appNow()) - a0 >= ms && !busy) return; await sleep(100); }
}
// --seconds is APP seconds: the visit lasts as long for the app whatever the renderer's speed
let steps = 0; const appStart = await appNow();
await think(1500); // a first look
while (SCRIPT || (await appNow()) - appStart < SECONDS * 1000) { const wait = await act().catch((e) => { pageErrors.push("explore: " + e.message); return 1000; }); if (wait < 0) break; steps++; await think(wait); }
await think(2500); // let the last action finish
const json = await page.evaluate(() => JSON.stringify(window.officeLog.toJSON()));
const file = path.join(OUT, "log.json.gz"); writeFileSync(file, gzipSync(json));
writeFileSync(path.join(OUT, "explore.json"), JSON.stringify({ query, persona: PERSONA, seed: SEED, seconds: SECONDS, steps, pageErrors }, null, 1));
console.log(`${name}: ${steps} steps, ${(json.length / 1024).toFixed(0)} KB log (${(gzipSync(json).length / 1024).toFixed(0)} KB gz) -> ${file}`); if (pageErrors.length) console.log("page errors:", pageErrors.slice(0, 6));
await browser.close(); srv.close();
if (!args.includes("--no-analyse")) spawnSync("node", [path.join(here, "analyse.mjs"), file, "--out", path.join(OUT, "analysis.json"), "--quiet"], { stdio: "inherit" });
if (!args.includes("--no-replay")) spawnSync("node", [path.join(here, "replay.mjs"), file, "--out", path.join(OUT, "replay"), "--fps", opt("--replay-fps", "2"), "--sheet-every", "2"], { stdio: "inherit" });
