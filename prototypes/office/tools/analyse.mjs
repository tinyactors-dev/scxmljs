// node tools/analyse.mjs <log> [--out findings.json] [--quiet]
// Automatic findings from a flight-recorder log (engine/log.js): feel, camera, interaction,
// comprehension proxies and errors, each with timestamps (wall seconds since the session's origin)
// and a severity (3 = confuses or blocks, 2 = annoys, 1 = worth a look, 0 = information).
//
// Two clocks. Wall time is what the visitor lived; app time is what the app's own animation lived
// (main.js caps a frame's dt at 100 ms, so under a slow software renderer the app runs slower than
// the wall). Thresholds about the app's pacing (a flight, a head entered and left) use app time;
// thresholds about the visitor's pace (rage taps) use wall time. Feel findings (frame rate) are
// left out for software-rendered sessions (SwiftShader, the explorers): their numbers are not a GPU's.
//
// Thresholds, and what they were calibrated on, are in TH below and in LOGGING.md.
import { writeFileSync } from "node:fs";
import { readLog, fmt } from "./logfile.mjs";

const args = process.argv.slice(2);
const FILE = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
const OUTF = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const QUIET = args.includes("--quiet");
if (!FILE) { console.error("usage: node tools/analyse.mjs <log> [--out findings.json]"); process.exit(2); }

export const TH = {
  long: 32, veryLong: 100,          // ms: a frame over these is a hitch / a stall (60 Hz = 16.7 ms)
  stutterFlight: 2.2,               // a frame in a flight longer than this times the session's median is a stutter
  rebuild: 50,                      // ms: a world rebuild longer than this is a hitch
  tinySel: 0.6,                     // % of the screen: a selected person smaller than this is tiny
  nothingUseful: 3000,              // ms (wall): looking at nothing pickable this long
  noPlates: 8000,                   // ms (wall): no readable plate in view this long
  nearPx: 30,                       // px: a dead tap with something pickable this close is a near miss
  repeatPx: 25, repeatMs: 3000,     // two taps this close in space and time with the same result
  rage: 3, rageMs: 1000,            // this many taps within this long
  headBounce: 2000,                 // ms (app): in a head and out again within this
  regret: 1500,                     // ms (app): back/Escape this soon after another action
  lost: 15000,                      // ms (wall): input but no change of mode this long
  limitRepeat: 3, limitWindow: 10000, // hitting an orbit limit this often within this long
  zoomFlips: 3, zoomWindow: 2500,   // wheel direction reversals within this long
  fightMs: 250,                     // ms: input inside a flight that did not stop it
};

const L = readLog(FILE);
const F = []; // findings
const add = (type, sev, t, msg, data = {}) => F.push({ type, sev, t: t == null ? null : +(t / 1000).toFixed(2), msg, ...data });
const S = L.session; const app = (t) => L.appAt(t);
const taps = L.by("pick", "tap"), acts = L.by("act").filter((e) => e.data.src !== "replay"), modes = L.by("mode", "change"), views = L.by("view", "frame");
const flights = []; { const open = []; for (const e of L.by("camera")) { if (e.type === "fly") open.push({ t0: e.t, kind: e.data.kind, data: e.data }); else if ((e.type === "arrive" || e.type === "interrupt") && open.length) { const f = open.shift(); f.t1 = e.t; f.end = e.type; f.by = e.data.by; flights.push(f); } } for (const f of open) { f.t1 = L.duration; f.end = "open"; flights.push(f); } }
const modeAt = (t) => { let m = ""; for (const e of modes) { if (e.t > t) break; m = e.data.to; } return m; };
const inFlight = (t) => flights.find((f) => t >= f.t0 && t <= f.t1);

// ---------------------------------------------------------------- feel
const dts = L.frames.map((f) => f.dt).filter((d) => d > 0).sort((a, b) => a - b);
const q = (p) => (dts.length ? dts[Math.min(dts.length - 1, Math.floor(p * dts.length))] : 0);
const med = q(0.5);
const feel = { frames: dts.length, fps: med ? +(1000 / med).toFixed(1) : 0, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +q(1).toFixed(1), over32: dts.filter((d) => d > TH.long).length, over100: dts.filter((d) => d > TH.veryLong).length, slowdown: +L.slow.toFixed(2) };
if (L.software) add("feel.software", 0, null, `software renderer (${S.gl?.renderer?.slice(0, 60)}): ${feel.fps} fps, app runs ${feel.slowdown}x slower than the wall; feel findings skipped`, { feel });
else {
  add("feel.summary", 0, null, `median ${feel.fps} fps; p95 ${feel.p95} ms, p99 ${feel.p99} ms, max ${feel.max} ms; ${feel.over32} frames over 32 ms, ${feel.over100} over 100 ms`, { feel });
  const longs = L.by("frame", "long"); const causes = {};
  for (const e of longs) { const k = (e.data.tags || ["(none)"]).filter((x) => x !== "view").map((x) => x.replace(/:.*/, "")).join("+") || "(none)"; (causes[k] ||= []).push(e); }
  for (const [k, list] of Object.entries(causes)) {
    const worst = list.reduce((a, b) => (b.data.dt > a.data.dt ? b : a)); const outside = list.filter((e) => e.data.work < e.data.dt / 2).length;
    add("feel.long", list.some((e) => e.data.dt > TH.veryLong) ? 2 : 1, worst.t, `${list.length} long frames with [${k}] (worst ${worst.data.dt} ms, our work ${worst.data.work} ms${outside ? `; ${outside} of them mostly outside our step+render: GC, compositor, texture upload` : ""})`, { count: list.length, at: list.slice(0, 12).map((e) => +(e.t / 1000).toFixed(2)) });
  }
  for (const f of flights) { const fr = L.frames.filter((x) => x.t > f.t0 + 20 && x.t <= f.t1); const bad = fr.filter((x) => x.dt > Math.max(TH.long, med * TH.stutterFlight)); if (bad.length) add("feel.flight-stutter", bad.length > 2 ? 2 : 1, f.t0, `${bad.length} of ${fr.length} frames stuttered during a ${f.kind} flight (worst ${Math.max(...bad.map((x) => x.dt)).toFixed(0)} ms)`); }
  for (const e of L.by("world", "rebuild")) if (e.data.ms > TH.rebuild) add("feel.rebuild", e.data.ms > 150 ? 2 : 1, e.t, `world rebuilt in ${e.data.ms} ms (${e.data.events} events, ${e.data.actors} actors)`);
}

// ---------------------------------------------------------------- camera
for (const c of L.cams.filter((c) => c.jump)) {
  const near = L.events.filter((e) => Math.abs(e.t - c.t) < 120 && (e.ch === "camera" || e.ch === "act"));
  if (near.some((e) => e.type === "fly") || flights.some((f) => c.t >= f.t0 && c.t <= f.t1 + 150)) continue; // a flight moves fast at a low frame rate: not a jump
  const orb = L.by("input", "gesture").some((e) => ["orbit", "zoom", "pan", "drag", "pinch"].includes(e.data.kind) && c.t >= e.t - (e.data.ms || 0) - 50 && c.t <= e.t + 1500 * L.slow); // OrbitControls' damping coasts on after the release
  if (orb && L.software) continue; // a drag at 3 fps moves far between frames
  add("camera.jump", 2, c.t, `the camera jumped without a flight (${near.map((e) => e.ch + "/" + e.type).join(", ") || "no event nearby"})`, { pose: [c.px, c.py, c.pz] });
}
for (const f of flights.filter((f) => f.end === "interrupt")) add("camera.interrupted", f.by === "pointerdown" || f.by === "keys" ? 1 : 0, f.t0, `a ${f.kind} flight was interrupted by ${f.by} after ${((f.t1 - f.t0) / 1000).toFixed(1)}s`);
// input during a flight that the flight ignored (enter/leave flights do not stop for a drag; the wheel never stops a flight)
for (const f of flights) {
  const ins = L.by("input").filter((e) => e.t > f.t0 + TH.fightMs && e.t < f.t1 - 30 && (e.type === "wheel" || (e.type === "down")));
  const drags = L.by("input", "gesture").filter((e) => e.t > f.t0 && e.t < f.t1 && ["orbit", "zoom", "pan", "drag", "pinch"].includes(e.data.kind));
  if ((ins.length && f.end !== "interrupt") || drags.length) add("camera.fought", ["enter", "leave"].includes(f.kind) && !drags.length ? 1 : 2, ins[0]?.t ?? drags[0].t, `the visitor ${drags.length ? drags.map((d) => d.data.kind).join("/") : ins.map((x) => x.type).join("/")} during a ${f.kind} flight, which ${f.end === "interrupt" ? "then stopped" : "kept flying and overrode it"}`, { flight: f.kind });
}
// where flights end: inside something, or with the selected person off screen, hidden or tiny
for (const f of flights.filter((f) => f.end === "arrive")) {
  const push = L.by("camera", "push").find((e) => e.t >= f.t1 && e.t < f.t1 + 400);
  if (push) add("camera.ends-inside", 2, f.t1, `a ${f.kind} flight ended inside ${push.data.person ? "a person" : "furniture"}; the camera was pushed ${push.data.d} m along ${push.data.axis}`, { box: push.data.box });
  const v = views.find((e) => e.t >= f.t1 && e.t < f.t1 + 1200);
  if (v && v.data.sel) { const s = v.data.sel; if (!s.on) add("camera.sel-offscreen", 3, f.t1, `after a ${f.kind} flight the selected ${s.id} is off screen`); else if (s.occ) add("camera.sel-occluded", 2, f.t1, `after a ${f.kind} flight the selected ${s.id} is hidden behind something`); else if (s.pct < TH.tinySel) add("camera.sel-tiny", 2, f.t1, `after a ${f.kind} flight the selected ${s.id} fills only ${s.pct}% of the screen`); }
}
// pushes outside flights while orbiting: the visitor drags into furniture
{ const ps = L.by("camera", "push").filter((e) => e.data.by === "orbit"); if (ps.length) add("camera.orbit-pushed", ps.length > 5 ? 2 : 1, ps[0].t, `${ps.length} collision pushes while the visitor orbited (the view snaps out of furniture mid-drag)`, { at: ps.slice(0, 10).map((e) => +(e.t / 1000).toFixed(2)) }); }
// time looking at nothing useful, and without anything readable
function spans(pred) { const out = []; let s = null; for (let i = 0; i < views.length; i++) { const v = views[i]; if (pred(v.data)) { if (s === null) s = v.t; } else if (s !== null) { out.push([s, v.t]); s = null; } } if (s !== null) out.push([s, views.length ? views[views.length - 1].t + 500 : s]); return out; }
for (const [a, b] of spans((d) => d.pickable === 0 || (d.in[0] && d.in[0][6] < 0.3 && d.pickable < 2))) if (b - a >= TH.nothingUseful) add("camera.nothing", 2, a, `${((b - a) / 1000).toFixed(1)} s looking at nothing pickable (empty floor, wall, sky)`, { until: +(b / 1000).toFixed(2) });
{ const sp = spans((d) => d.readable === 0); const tot = sp.reduce((x, [a, b]) => x + b - a, 0); const span = views.length ? views[views.length - 1].t - views[0].t + 500 : 0;
  for (const [a, b] of sp) if (b - a >= TH.noPlates) add("view.no-plates", 1, a, `${((b - a) / 1000).toFixed(1)} s with no readable plate in view (all text under 9 px)`, { until: +(b / 1000).toFixed(2) });
  if (span) add("view.readable-share", tot / span > 0.6 ? 2 : 0, null, `no readable text in view ${Math.round((100 * tot) / span)}% of the session`); }
// orbit limits hit again and again; zoom bouncing
{ const lim = L.by("camera", "limit"); for (let i = 0; i < lim.length; i++) { const w = lim.filter((e) => e.t >= lim[i].t && e.t < lim[i].t + TH.limitWindow); if (w.length >= TH.limitRepeat) { add("camera.limits", 1, lim[i].t, `${w.length} orbit limits hit within ${TH.limitWindow / 1000}s (${[...new Set(w.map((e) => e.data.which))].join(", ")})`); i += w.length - 1; } } }
{ const wh = L.by("input", "wheel"); let flips = []; for (let i = 1; i < wh.length; i++) if (Math.sign(wh[i].data.dy) !== Math.sign(wh[i - 1].data.dy) && wh[i].t - wh[i - 1].t < TH.zoomWindow) flips.push(wh[i].t); for (let i = 0; i < flips.length; i++) { const w = flips.filter((t) => t >= flips[i] && t < flips[i] + TH.zoomWindow * 2); if (w.length >= TH.zoomFlips) { add("camera.zoom-bounce", 1, flips[i], `zoom went in and out ${w.length} times in ${(TH.zoomWindow * 2) / 1000}s: the visitor is searching for a distance`); i += w.length - 1; } } }

// ---------------------------------------------------------------- interaction
const isDead = (tp) => !tp.data.act || (tp.data.act === "walk"); // walking on the floor is a fallback, not what a visitor aims for
const label = (h) => (h ? h.filter((x) => x != null).join(":") : "NOTHING");
for (const tp of taps) {
  const near = (tp.data.near || []).filter((x) => x[2] <= TH.nearPx && x[0] !== "board"); // the board's outline is the whole wall
  const hitK = tp.data.hit?.[0];
  const m = modeAt(tp.t);
  if (/^(entering|head|machine|leaving):/.test(m)) { if (!tp.data.act) add("tap.head-miss", 1, tp.t, `in ${m.replace(/ .*/, "")}: a tap on ${label(tp.data.hit)} did nothing (no machine, pad or button under it)`, { x: tp.data.x, y: tp.data.y }); continue; }
  if (!tp.data.act) {
    const n0 = near[0];
    add(n0 ? "tap.near-miss" : "tap.dead", n0 ? 2 : 1, tp.t, n0 ? `tap hit ${label(tp.data.hit)} and did nothing; ${n0[0]} ${n0[1]} was ${n0[2]} px away${n0[2] === 0 ? " (inside its outline)" : ""}` : `tap hit ${label(tp.data.hit)} and did nothing`, { x: tp.data.x, y: tp.data.y, hit: tp.data.hit, near: tp.data.near });
  } else if (tp.data.act === "walk") {
    const n0 = near.find((x) => ["actor", "station", "control", "capsule"].includes(x[0]));
    if (n0) add("tap.near-miss", 2, tp.t, `tap meant for ${n0[0]} ${n0[1]} (${n0[2]} px away${n0[2] === 0 ? ", inside its outline" : ""}) fell through to the floor and walked the camera`, { x: tp.data.x, y: tp.data.y, near: tp.data.near });
  } else if (hitK && tp.data.near?.length) {
    const inside = tp.data.near.filter((x) => x[2] === 0 && x[0] !== "board" && x[0] !== "directory"); const own = inside.find((x) => x[1] === tp.data.hit[1]);
    const smaller = inside.find((x) => x[1] !== tp.data.hit[1] && (!own || x[3] < own[3]) && ["actor", "station", "control", "capsule"].includes(x[0]));
    if (smaller && !own) add("tap.other", 1, tp.t, `tap inside ${smaller[0]} ${smaller[1]}'s outline picked ${label(tp.data.hit)} instead`, { x: tp.data.x, y: tp.data.y });
  }
}
// targets too small or too crowded to hit reliably (a thumb is ~40 px, a careful mouse ~8 px)
for (const tp of taps) {
  const own = (tp.data.near || []).find((x) => tp.data.hit && x[1] === tp.data.hit[1] && x[2] === 0);
  const rivals = (tp.data.near || []).filter((x) => x[2] <= 12 && x[1] !== tp.data.hit?.[1] && !["board", "directory", "clock"].includes(x[0]));
  if (own && own[3] < 0.15 && !/^(entering|head|machine|leaving):/.test(modeAt(tp.t))) add("tap.tiny-target", 1, tp.t, `tapped ${own[0]} ${own[1]}, which covers ${own[3]}% of the screen${rivals.length ? `, with ${rivals.map((x) => x[1]).join(", ")} within 12 px` : ""}`);
}
// live: a press that the room did not answer (the run did not grow): an inert control, or the FLOW/STEP lever holding it back
if (S.live) for (const a of acts.filter((e) => ["press", "advance", "headSend"].includes(e.type))) {
  const grew = L.by("world", "rebuild").some((e) => e.t > a.t && e.t < a.t + 2500); const play = modes.some((m) => m.t > a.t && m.t < a.t + 2500 && /\+playing/.test(m.data.to));
  if (!grew && !play && !/^(reset|time:mode)$/.test(a.data.id || "")) add("live.no-effect", 2, a.t, `${a.type} ${a.data.id || a.data.event || ""}: nothing happened in the room (an inert control, or the run is held back)`);
}
for (let i = 1; i < taps.length; i++) { const a = taps[i - 1], b = taps[i]; if (b.t - a.t < TH.repeatMs && Math.hypot(a.data.x - b.data.x, a.data.y - b.data.y) < TH.repeatPx && a.data.act === b.data.act && isDead(b)) add("tap.repeat", 2, b.t, `the same spot tapped again with the same (lack of) result: ${label(b.data.hit)} -> ${b.data.act || "nothing"}`); }
for (let i = 0; i < taps.length; i++) { const w = taps.filter((e) => e.t >= taps[i].t && e.t < taps[i].t + TH.rageMs); if (w.length >= TH.rage) { add("tap.rage", 2, taps[i].t, `${w.length} taps within ${TH.rageMs / 1000}s (${w.map((e) => e.data.act || "nothing").join(", ")})`); i += w.length - 1; } }
{ const fur = taps.filter((e) => e.data.hit?.[0] === "furniture"); if (fur.length) add("tap.scenery", fur.length > 3 ? 2 : 1, fur[0].t, `${fur.length} taps on desks and their objects, which look like things but do nothing`, { at: fur.slice(0, 10).map((e) => [+(e.t / 1000).toFixed(1), e.data.x, e.data.y]) }); }
{ const hov = L.by("pick", "hover"); const pickables = hov.filter((e) => e.data.cursor === "pointer").length; const touch = L.by("input", "down").filter((e) => e.data.type === "touch").length;
  if (touch && !hov.length) add("hover.touch", 1, null, "a touch session: no hover, so the pointer cursor (the only hover feedback) is never seen; nothing says what is tappable");
  else if (hov.length) add("hover.cursor-only", 0, null, `${hov.length} hover changes, ${pickables} onto something tappable; the only feedback is the cursor (no highlight in the world)`); }
{ const holds = L.by("input", "gesture").filter((e) => e.data.kind === "hold"); if (holds.length) add("input.hold", 1, holds[0].t, `${holds.length} long presses did nothing (a tap must be under 600 ms)`); }

// ---------------------------------------------------------------- comprehension proxies
{ const first = taps.find((e) => e.data.act && e.data.act !== "walk"); const ready = L.ready; add("comp.first-success", first ? (first.t - ready > 20000 ? 2 : 0) : 2, first ? first.t : null, first ? `first tap that did something: ${((first.t - ready) / 1000).toFixed(1)} s after the page was ready (${first.data.act} ${label(first.data.hit)})` : `no tap did anything in ${((L.duration - ready) / 1000).toFixed(0)} s`); }
{ const enter = modes.filter((m) => /^(entering|head):/.test(m.data.to) && !/^(entering|head|machine):/.test(m.data.from));
  for (const e of enter) { const out = modes.find((m) => m.t > e.t && !/^(entering|head|machine|leaving):/.test(m.data.to)); if (out && app(out.t) - app(e.t) < TH.headBounce) add("comp.head-bounce", 2, e.t, `entered ${e.data.to.replace(/ .*/, "")} and was out again ${((app(out.t) - app(e.t)) / 1000).toFixed(1)} s (app) later (${out.data.cause})`); } }
for (let i = 1; i < acts.length; i++) { const a = acts[i - 1], b = acts[i]; if (b.type === "back" && a.type !== "back" && app(b.t) - app(a.t) < TH.regret) add("comp.regret", 1, b.t, `back right after ${a.type} ${a.data.id || a.data.state || ""} (${((app(b.t) - app(a.t)) / 1000).toFixed(1)} s app)`); }
{ const inputs = L.by("input").filter((e) => e.type === "down" || e.type === "wheel" || (e.type === "key" && e.data.down)); const marks = [L.ready, ...modes.map((m) => m.t), L.duration];
  for (let i = 1; i < marks.length; i++) { const a = marks[i - 1], b = marks[i]; if (b - a < TH.lost) continue; const n = inputs.filter((e) => e.t > a && e.t < b).length; if (n >= 6) add("comp.lost", 2, a, `${((b - a) / 1000).toFixed(0)} s and ${n} inputs without any change of mode: the visitor is trying things that do not respond`, { until: +(b / 1000).toFixed(2) }); } }
{ const tally = {}; for (const m of modes) { const k = m.data.to.replace(/:.*?( |$)/, "$1").replace(/ \+(playing|rest)/, ""); tally[k] = (tally[k] || 0) + 1; } add("comp.modes", 0, null, `mode visits: ${Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(", ")}`); }

// ---------------------------------------------------------------- errors
for (const e of L.by("error")) add("error." + e.type, e.type === "console" && e.data.level === "warn" ? 1 : 3, e.t, `${e.type}: ${e.data.msg || e.data.url || e.data.src || ""}${e.data.status ? " " + e.data.status : ""}`.slice(0, 300));

// ---------------------------------------------------------------- report
F.sort((a, b) => b.sev - a.sev || (a.t ?? -1) - (b.t ?? -1));
const counts = {}; for (const f of F) counts[f.type] = (counts[f.type] || 0) + 1;
const summary = { log: FILE, system: S.system, live: S.live, build: S.build, viewport: S.viewport, gl: S.gl?.renderer, synthetic: S.synthetic || null, duration: +(L.duration / 1000).toFixed(1), appDuration: +(L.appAt(L.duration) / 1000).toFixed(1), feel, taps: taps.length, deadTaps: taps.filter((t) => !t.data.act).length, walkTaps: taps.filter((t) => t.data.act === "walk").length, acts: acts.length, modes: modes.length, overhead: S.overhead, counts };
if (OUTF) writeFileSync(OUTF, JSON.stringify({ summary, thresholds: TH, findings: F }, null, 1));
const sevName = ["info", "low", "MED", "HIGH"];
if (!QUIET) {
  console.log(`== ${S.live ? "live:" + S.live : S.system}  ${summary.duration}s (app ${summary.appDuration}s)  ${S.viewport?.join("x")}  ${S.gl?.renderer?.slice(0, 50)}  build ${S.build}${S.synthetic ? "  persona " + S.synthetic.persona : ""}`);
  console.log(`   ${taps.length} taps (${summary.deadTaps} did nothing, ${summary.walkTaps} walked), ${acts.length} actions, ${modes.length} mode changes; recorder overhead ${S.overhead?.msPerFrame} ms/frame`);
  for (const f of F) console.log(`${sevName[f.sev].padEnd(4)} ${f.t == null ? "     " : fmt(f.t * 1000).padStart(6)}  ${f.type.padEnd(22)} ${f.msg}`);
} else console.log(`analysis: ${F.filter((f) => f.sev >= 2).length} medium/high findings of ${F.length} -> ${OUTF || "(stdout)"}  ${Object.entries(counts).filter(([k]) => !/summary|software|modes|share|cursor/.test(k)).map(([k, n]) => `${k}:${n}`).join(" ")}`);
