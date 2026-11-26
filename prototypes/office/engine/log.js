// engine/log.js: the flight recorder. One append-only, timestamped stream of what happens in a
// session: the visitor's inputs, what the app did about them, and how it felt (frame times). It is
// always on and cheap: high-rate channels live in fixed typed-array rings (about ten minutes and
// more), everything else is a compact tuple [t, channel, type, data] in a bounded list.
//
// Owns: the stream, its schema (LOGGING.md), export (a file the visitor saves; nothing is ever sent
// anywhere), the crash copy in sessionStorage (?log=1), and the error hooks (window.onerror,
// unhandledrejection, console.error/warn, failed fetches, WebGL context loss).
// Must never know: three.js, the world, a system. Callers describe what happened in plain values;
// the hooks at the real sources are one or two lines each, marked `// log:`.
//
// Times are milliseconds since the session's time origin (performance.now() at boot), rounded to
// 0.1 ms on export.

export const LOG_SCHEMA = "office-log/1";
// bump on every change that ships (the log says which build made it)
export const BUILD = "office-2026-11-26.3";

const KEEP_MS = 12 * 60 * 1000; // events older than this are dropped from the list
const MAX_EVENTS = 60000;

/** A fixed ring of rows of numbers (Float64), `fields` per row. */
function ring(fields, cap) {
  const n = fields.length, buf = new Float64Array(cap * n);
  let head = 0, size = 0;
  return {
    fields, cap,
    get size() { return size; },
    put(a, b, c, d, e, f, g, h, i, j) {
      const o = head * n; buf[o] = a;
      if (n > 1) buf[o + 1] = b; if (n > 2) buf[o + 2] = c; if (n > 3) buf[o + 3] = d; if (n > 4) buf[o + 4] = e;
      if (n > 5) buf[o + 5] = f; if (n > 6) buf[o + 6] = g; if (n > 7) buf[o + 7] = h; if (n > 8) buf[o + 8] = i; if (n > 9) buf[o + 9] = j;
      head = (head + 1) % cap; if (size < cap) size++;
    },
    /** the last row's field k */
    last(k = 0) { if (!size) return NaN; return buf[((head - 1 + cap) % cap) * n + k]; },
    /** flat array of every row, oldest first, rounded */
    flat(digits) {
      const out = new Array(size * n); const start = (head - size + cap) % cap;
      for (let r = 0; r < size; r++) { const o = ((start + r) % cap) * n; for (let k = 0; k < n; k++) { const p = digits[k] ?? 2; const m = 10 ** p; out[r * n + k] = Math.round(buf[o + k] * m) / m; } }
      return out;
    },
    clear() { head = 0; size = 0; },
  };
}

const ptype = { mouse: 0, touch: 1, pen: 2 };

export function createLog(opts = {}) {
  const origin = opts.origin ?? performance.now();
  const now = () => performance.now() - origin;
  const r1 = (x) => Math.round(x * 10) / 10;
  const events = [];
  const rings = {
    // every frame: time at the frame's start, dt since the previous start, ms our step+render took
    frame: ring(["t", "dt", "work"], 1 << 17),
    // the camera at >= 10 Hz and at every jump: position, look target, vertical fov, playback second; jump = 1 on a discontinuity
    camera: ring(["t", "px", "py", "pz", "tx", "ty", "tz", "fov", "playS", "jump"], 1 << 14),
    // the pointer, sampled: every move while a button is down at <= 30 Hz, hover at <= 10 Hz
    pointer: ring(["t", "x", "y", "buttons", "type", "id"], 1 << 15),
  };
  const digits = { frame: [1, 2, 2], camera: [1, 3, 3, 3, 3, 3, 3, 2, 3, 0], pointer: [1, 0, 0, 0, 0, 0] };
  const session = { schema: LOG_SCHEMA, build: BUILD, startedAt: new Date().toISOString(), epoch: Date.now() - now() };
  let cost = 0, costN = 0; // our own cost per frame (ms), for the overhead budget
  let viewCost = 0, viewN = 0; // the view sampler's, per sample (twice a second)

  function ev(ch, type, data) {
    const t = now();
    events.push(data === undefined ? [t, ch, type] : [t, ch, type, data]);
    if (events.length > MAX_EVENTS) { const cut = events.findIndex((e) => e[0] > t - KEEP_MS); events.splice(0, Math.max(cut, events.length - MAX_EVENTS + 1000)); }
    return t;
  }

  // ---------------------------------------------------------------- frames
  // frameStart(): call first thing in the animation callback; frameEnd(info) after render.
  // Tags noted during a frame (note("flight"), note("rebuild")) are attached when the NEXT frame
  // finds this one was long: dt at frame N is the time frame N-1 (and whatever ran after it) took.
  let appMs = 0; // the app's own clock: main.js steps by min(100 ms, dt)
  let lastStart = -1, workStart = 0, tags = [], prevTags = [], prevWork = 0;
  const sec = { t0: -1, n: 0, dts: [], calls: 0, tris: 0, work: 0, max: 0 };
  let secInfo = { fps: 0, p50: 0, p95: 0, max: 0 };
  function frameStart() {
    const c0 = performance.now(); const t = c0 - origin;
    const dt = lastStart < 0 ? 0 : t - lastStart; lastStart = t; workStart = c0;
    rings.frame.put(t, dt, prevWork); appMs += Math.min(100, dt);
    if (dt > 32) ev("frame", "long", { dt: r1(dt), work: r1(prevWork), tags: prevTags.length ? prevTags : undefined, sev: dt > 100 ? 2 : 1 });
    if (sec.t0 < 0) sec.t0 = t;
    if (dt > 0) { sec.dts.push(dt); sec.n++; if (dt > sec.max) sec.max = dt; }
    if (t - sec.t0 >= 1000) {
      const d = sec.dts.sort((a, b) => a - b); const q = (p) => (d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))] : 0);
      secInfo = { fps: r1((sec.n * 1000) / (t - sec.t0)), p50: r1(q(0.5)), p95: r1(q(0.95)), max: r1(sec.max) };
      ev("frame", "sec", { ...secInfo, calls: Math.round(sec.calls / Math.max(1, sec.n)), tris: Math.round(sec.tris / Math.max(1, sec.n)), work: r1(sec.work / Math.max(1, sec.n)), ...(sec.extra || {}) });
      sec.t0 = t; sec.n = 0; sec.dts.length = 0; sec.calls = 0; sec.tris = 0; sec.work = 0; sec.max = 0; sec.extra = null;
    }
    prevTags = tags; tags = [];
    cost += performance.now() - c0;
    return dt;
  }
  /** after render: renderer.info.render ({calls, triangles}); extra: per-second fields (e.g. visible objects) */
  function frameEnd(info, extra) {
    const c0 = performance.now();
    prevWork = c0 - workStart;
    sec.work += prevWork;
    if (info) { sec.calls += info.calls; sec.tris += info.triangles; }
    if (extra) sec.extra = extra;
    costN++; cost += performance.now() - c0;
  }
  const note = (tag) => { if (!tags.includes(tag)) tags.push(tag); };

  // ---------------------------------------------------------------- camera
  // sample(p, t, fov, playS, moving): stores a row when 66 ms passed, or the pose jumped
  let camLast = -1e9, cpx = NaN, cpy = 0, cpz = 0, ctx = 0, cty = 0, ctz = 0;
  function camera(p, tg, fov, playS) {
    const c0 = performance.now(); const t = c0 - origin;
    const step = Math.hypot(p.x - cpx, p.y - cpy, p.z - cpz), tstep = Math.hypot(tg.x - ctx, tg.y - cty, tg.z - ctz);
    const jump = Number.isFinite(step) && (step > 0.75 || tstep > 1.5);
    if (t - camLast >= 66 || jump) { rings.camera.put(t, p.x, p.y, p.z, tg.x, tg.y, tg.z, fov, playS, jump ? 1 : 0); camLast = t; }
    cpx = p.x; cpy = p.y; cpz = p.z; ctx = tg.x; cty = tg.y; ctz = tg.z;
    cost += performance.now() - c0;
  }

  // ---------------------------------------------------------------- input (passive listeners at the source: the canvas)
  let lastMove = -1e9;
  function attachInput(el, target = window) {
    const on = (t, ty, f) => t.addEventListener(ty, f, { capture: true, passive: true });
    const pt = (e) => ptype[e.pointerType] ?? 0;
    on(el, "pointerdown", (e) => { rings.pointer.put(now(), e.clientX, e.clientY, e.buttons, pt(e), e.pointerId); ev("input", "down", { x: e.clientX, y: e.clientY, b: e.button, type: e.pointerType, id: e.pointerId }); });
    on(el, "pointermove", (e) => { const t = now(); if (t - lastMove < (e.buttons ? 33 : 100)) return; lastMove = t; rings.pointer.put(t, e.clientX, e.clientY, e.buttons, pt(e), e.pointerId); });
    on(el, "pointerup", (e) => { rings.pointer.put(now(), e.clientX, e.clientY, 0, pt(e), e.pointerId); ev("input", "up", { x: e.clientX, y: e.clientY, type: e.pointerType, id: e.pointerId }); });
    on(el, "pointercancel", (e) => ev("input", "cancel", { id: e.pointerId }));
    on(el, "wheel", (e) => ev("input", "wheel", { x: e.clientX, y: e.clientY, dy: Math.round(e.deltaY), dx: Math.round(e.deltaX), mode: e.deltaMode, ctrl: e.ctrlKey || undefined }));
    on(target, "keydown", (e) => { if (!e.repeat) ev("input", "key", { key: e.key, down: 1 }); });
    on(target, "keyup", (e) => ev("input", "key", { key: e.key, down: 0 }));
    on(target, "resize", () => ev("session", "resize", { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
    on(document, "visibilitychange", () => ev("session", "visibility", { state: document.visibilityState }));
    on(el, "webglcontextlost", () => ev("error", "webgl-lost", {}));
    on(el, "webglcontextrestored", () => ev("error", "webgl-restored", {}));
  }

  // ---------------------------------------------------------------- errors (hooks at the source)
  function attachErrors() {
    addEventListener("error", (e) => { if (e.target && e.target !== window && e.target.src) ev("error", "resource", { src: String(e.target.src) }); else ev("error", "error", { msg: String(e.message), at: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined, stack: e.error?.stack?.slice(0, 600) }); }, true);
    addEventListener("unhandledrejection", (e) => ev("error", "rejection", { msg: String(e.reason?.message || e.reason), stack: e.reason?.stack?.slice(0, 600) }));
    for (const level of ["error", "warn"]) {
      const orig = console[level].bind(console);
      console[level] = (...a) => { try { ev("error", "console", { level, msg: a.map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(" ").slice(0, 400) }); } catch {} orig(...a); };
    }
    if (window.fetch) {
      const of = window.fetch.bind(window);
      window.fetch = async (...a) => { const url = String(a[0]?.url || a[0]); try { const r = await of(...a); if (!r.ok) ev("error", "fetch", { url, status: r.status }); return r; } catch (err) { ev("error", "fetch", { url, msg: String(err.message || err) }); throw err; } };
    }
  }

  // per frame: the rings, the hooks and the per-frame sampling; the view sample apart (it runs twice a
  // second whatever the frame rate), and both amortised at 60 Hz
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  function overhead() { const f = costN ? cost / costN : 0, v = viewN ? viewCost / viewN : 0; return { msPerFrame: r4(f), frames: costN, msPerViewSample: r4(v), viewSamples: viewN, msPerFrameAt60: r4(f + v / 30) }; }

  // ---------------------------------------------------------------- export
  function toJSON() {
    const out = { ...session, exportedAt: new Date().toISOString(), duration: r1(now()), rings: {}, events: events.map((e) => (e[0] = r1(e[0]), e)) };
    for (const [k, r] of Object.entries(rings)) out.rings[k] = { fields: r.fields, data: r.flat(digits[k]) };
    out.overhead = overhead();
    if (previous) out.previous = previous;
    return out;
  }
  async function bytes() {
    const text = JSON.stringify(toJSON());
    if (typeof CompressionStream === "function") {
      const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
      return { blob: await new Response(s).blob(), ext: ".json.gz" };
    }
    return { blob: new Blob([text], { type: "application/json" }), ext: ".json" };
  }
  /** saves the session as a file the visitor keeps; returns its name */
  async function download() {
    ev("session", "export", {});
    const { blob, ext } = await bytes();
    const stamp = new Date().toISOString().replace(/[:]/g, "-").replace(/\..*/, "");
    const name = `office-log-${stamp}${ext}`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return name;
  }

  // ---------------------------------------------------------------- the crash copy (?log=1)
  // the last session's copy is moved aside at boot (so a crash, a hang or a reload keeps it), and
  // exported with this one as `previous`; this session's copy is rewritten every 10 s when idle
  let previous = null;
  const KEY = "office-log:cur", PREV = "office-log:prev";
  try { const cur = sessionStorage.getItem(KEY); if (cur) { sessionStorage.setItem(PREV, cur); sessionStorage.removeItem(KEY); } const p = sessionStorage.getItem(PREV); if (p) previous = JSON.parse(p); } catch {}
  function arm(intervalMs = 10000) {
    const save = () => {
      note("log-save");
      try { const j = toJSON(); delete j.previous; sessionStorage.setItem(KEY, JSON.stringify(j)); }
      catch { try { const j = toJSON(); delete j.previous; j.rings.frame.data = j.rings.frame.data.slice(-3 * 4000); j.rings.pointer.data = []; j.events = j.events.slice(-4000); sessionStorage.setItem(KEY, JSON.stringify(j)); } catch {} }
    };
    const tick = () => (window.requestIdleCallback ? requestIdleCallback(save, { timeout: 4000 }) : save());
    setInterval(tick, intervalMs);
    ev("session", "armed", { intervalMs });
  }

  return {
    origin, now, session, rings, events, ev, note, frameStart, frameEnd, camera, attachInput, attachErrors,
    toJSON, export: toJSON, bytes, download, arm, appNow: () => appMs, get previous() { return previous; },
    get secInfo() { return secInfo; },
    overhead,
    /** charge work done elsewhere for the recorder: per frame (the hooks' sampling), or a view sample */
    charge: (ms, view = false) => { if (view) { viewCost += ms; viewN++; } else cost += ms; },
  };
}
