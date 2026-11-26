// node tools/replay.mjs <log> [--out dir] [--fps 10] [--from s --to s] [--video] [--sheet-every n] [--third]
// Watch what a visitor did and saw: replays a flight-recorder log (engine/log.js) in headless
// Chromium (software GL) at the log's viewport. The page runs with ?replay=1: it keeps no clock or
// camera of its own; this script steps it by the log's app time, sets the playhead and the camera
// pose from the camera channel, and performs the visitor's actions (the act channel) at the moments
// they happened (the visitor walks in first person: their eye is the logged pose; --third puts the camera behind
// and above them and draws them as a whole block person where they stood). Each frame gets a strip BELOW the 3D view (a tool output, not the app): time, mode,
// what was picked, fps, what is in view; pointer marks (trail, taps) are drawn on the frame.
// Writes <out>/frames/NNNNN.png, <out>/sheet-K.png contact sheets, and with --video <out>/replay.mp4.
import { createRequire } from "node:module"; import http from "node:http"; import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"; import path from "node:path"; import { execFileSync, spawnSync } from "node:child_process";
import { readLog, poseAt, fmt } from "./logfile.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("/opt/node-tools/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname); const root = path.resolve(here, "../.."); // prototypes/

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FILE = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.match(/^--(out|fps|from|to|sheet-every)$/));
if (!FILE) { console.error("usage: node tools/replay.mjs <log> [--out dir] [--fps 10] [--from s --to s] [--video]"); process.exit(2); }
const L = readLog(FILE);
const OUT = opt("--out", path.join(here, "../out/replay", path.basename(FILE).replace(/\.json(\.gz)?$/, "")));
const FPS = Number(opt("--fps", 10)), FROM = Number(opt("--from", 0)) * 1000, TO = Math.min(L.duration, Number(opt("--to", 1e9)) * 1000);
const VIDEO = args.includes("--video"), EVERY = Number(opt("--sheet-every", Math.max(1, Math.round(FPS))));
const [W, H] = L.session.viewport || [1280, 720];
rmSync(path.join(OUT, "frames"), { recursive: true, force: true }); mkdirSync(path.join(OUT, "frames"), { recursive: true });

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".scxml": "application/xml" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!existsSync(f) || !f.startsWith(root)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const qs = new URLSearchParams(L.session.params || ""); for (const k of ["log", "noloop", "replay"]) qs.delete(k); qs.set("replay", "1"); if (args.includes("--third")) qs.set("third", "1");
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on("console", (m) => { const t = m.text(); if (/GL Driver|GPU stall|Automatic fallback/.test(t)) return; if (m.type() === "error" || m.type() === "warning") errors.push(t); });
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://localhost:${srv.address().port}/office/index.html?${qs}`); await page.waitForFunction(() => window.ready === true && window.api?.replay, null, { timeout: 120000 });

// ---- the timeline
const acts = L.by("act").filter((e) => e.data.src !== "replay");
const modes = L.by("mode", "change"), taps = L.by("pick", "tap"), secs = L.by("frame", "sec"), views = L.by("view", "frame");
const longs = L.by("frame", "long"), cam = L.by("camera"), errs = L.by("error"), gestures = L.by("input", "gesture");
const last = (arr, t) => { let r = null; for (const e of arr) { if (e.t > t) break; r = e; } return r; };
const within = (arr, t0, t1) => arr.filter((e) => e.t > t0 && e.t <= t1);
const appDt = (t0, t1) => Math.max(0, L.appAt(t1) - L.appAt(t0)) / 1000;
const pose = (t) => { const p = poseAt(L.cams, t); return p ? { playS: p.playS, cam: { p: [p.px, p.py, p.pz], t: [p.tx, p.ty, p.tz], fov: p.fov } } : null; };
const liveBusy = () => page.evaluate(() => !!(window.live && window.live.snapshot().busy));
async function step(dt, t, render) { const e = pose(t); await page.evaluate(([dt, e, r]) => window.api.replay.step(dt, e, r), [dt, e, render]); }

const sh = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
// everything before --from is performed without frames (fast-forward)
const t0 = L.cams.length ? Math.max(0, L.cams[0].t) : 0; let tPrev = t0, ai = 0, n = 0;
const frameTimes = []; for (let t = Math.max(FROM, t0); t <= TO; t += 1000 / FPS) frameTimes.push(t);
let stopped = null;
for (const T of frameTimes) {
  // the actions up to T, each at its moment
  while (ai < acts.length && acts[ai].t <= T) {
    const a = acts[ai++]; await step(appDt(tPrev, a.t), a.t, false); tPrev = a.t;
    if (a.type === "system") { stopped = `the visitor switched to ${a.data.id}`; break; }
    await page.evaluate((x) => window.api.replay.perform(x), { do: a.type, ...a.data, src: undefined });
    for (let k = 0; k < 200 && (await liveBusy()); k++) await new Promise((r) => setTimeout(r, 20));
  }
  if (stopped) break;
  await step(appDt(tPrev, T), T, true); tPrev = T;
  const f = path.join(OUT, "frames", String(n).padStart(5, "0") + ".png"); await page.screenshot({ path: f });
  // ---- marks on the frame and the strip below it
  const draw = [];
  for (const p of L.pointer.filter((p) => p.t > T - 700 && p.t <= T)) draw.push("-fill", p.buttons ? "#ff8c1a" : "#3fd0ff", "-stroke", "none", "-draw", `circle ${p.x},${p.y} ${p.x + (p.buttons ? 4 : 3)},${p.y}`);
  for (const tp of taps.filter((e) => e.t > T - 1200 && e.t <= T)) { const ok = tp.data.act && tp.data.act !== "walk"; draw.push("-fill", "none", "-stroke", ok ? "#36e05a" : "#ff3030", "-strokewidth", "3", "-draw", `circle ${tp.data.x},${tp.data.y} ${tp.data.x + 16},${tp.data.y}`, "-stroke", "#000", "-strokewidth", "1", "-draw", `circle ${tp.data.x},${tp.data.y} ${tp.data.x + 30},${tp.data.y}`); }
  const m = last(modes, T), s = last(secs, T), v = last(views, T), tp = last(taps, T), ac = last(acts, T);
  const recent = [...within(longs, T - 1000, T).filter((e) => !L.software || e.data.dt > 1000).map((e) => `LONG ${e.data.dt}ms${e.data.tags ? " [" + e.data.tags.join(",") + "]" : ""}`), ...within(cam, T - 1000, T).filter((e) => e.type !== "arrive").map((e) => `cam ${e.type}${e.data.kind ? " " + e.data.kind : ""}${e.data.by ? " by " + e.data.by : ""}`), ...within(gestures, T - 1000, T).map((e) => `gesture ${e.data.kind}`), ...within(errs, T - 1000, T).map((e) => `ERROR ${e.data.msg || e.type}`)];
  const lines = [
    `${fmt(T)}  app ${fmt(L.appAt(T))}  ${m ? m.data.to : "?"}   fps ${s ? `${s.data.fps} p95 ${s.data.p95}ms max ${s.data.max}ms` : "?"}`,
    `last tap ${tp ? `${fmt(tp.t)} ${tp.data.hit ? tp.data.hit.join(":") : "NOTHING"} -> ${tp.data.act || "nothing"}${tp.data.near?.length ? "  near " + tp.data.near.filter((x) => x[2] <= 30).map((x) => `${x[0]}:${x[1]}@${x[2]}px`).join(" ") : ""}` : "-"}   last act ${ac ? `${fmt(ac.t)} ${ac.type} ${ac.data.id || ac.data.state || ""}` : "-"}`,
    `view: ${v ? `${v.data.pickable} pickable, ${v.data.readable}/${v.data.plates} plates readable${v.data.sel ? `, selected ${v.data.sel.on ? v.data.sel.pct + "%" : "OFF SCREEN"}${v.data.sel.occ ? " OCCLUDED" : ""}` : ""}; ${v.data.in.slice(0, 4).map((x) => `${x[0]}:${x[1]} ${x[6]}%`).join(", ")}` : "-"}`,
    recent.slice(0, 4).join("  |  ") || " ",
  ];
  const out = f.replace(/\.png$/, "-o.png");
  const args2 = [f, ...draw, "-background", "#14161b", "-gravity", "north", "-extent", `${W}x${H + 96}`, "-gravity", "northwest", "-font", "DejaVu-Sans-Mono", "-pointsize", "15", "-fill", "#e8e8e8", "-stroke", "none"];
  lines.forEach((ln, i) => args2.push("-fill", i === 3 ? "#ffb35a" : "#e8e8e8", "-annotate", `+10+${H + 6 + i * 22}`, ln));
  execFileSync("convert", [...args2, out]); rmSync(f); execFileSync("mv", [out, f]);
  n++; if (n % 20 === 0) console.log(`frame ${n}/${frameTimes.length} at ${fmt(T)}`);
}
if (stopped) console.log("stopped:", stopped);
// ---- contact sheets: every EVERY-th frame, 12 per sheet, labelled with their time
const all = Array.from({ length: n }, (_, i) => i).filter((i) => i % EVERY === 0);
const sheets = [];
for (let s = 0; s * 12 < all.length; s++) {
  const pick = all.slice(s * 12, s * 12 + 12); const file = path.join(OUT, `sheet-${s + 1}.png`);
  execFileSync("montage", [...pick.flatMap((i) => ["-label", fmt(frameTimes[i]), path.join(OUT, "frames", String(i).padStart(5, "0") + ".png")]), "-tile", "3x", "-geometry", `${Math.round(W / 2.2)}x+3+3`, "-pointsize", "14", "-background", "#222", "-fill", "#ddd", file]);
  sheets.push(file);
}
if (VIDEO && n) { const r = spawnSync("/usr/bin/ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(OUT, "frames", "%05d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", path.join(OUT, "replay.mp4")], { stdio: "inherit" }); if (r.status) console.log("ffmpeg failed"); }
writeFileSync(path.join(OUT, "replay.json"), JSON.stringify({ log: path.resolve(FILE), frames: n, fps: FPS, from: FROM, to: TO, sheets, errors, stopped }, null, 1));
console.log(`replayed ${n} frames -> ${OUT}`); for (const s of sheets) console.log("sheet", s); if (errors.length) console.log("page errors:", errors.slice(0, 5));
await browser.close(); srv.close();
