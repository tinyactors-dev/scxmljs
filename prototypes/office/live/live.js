// live/live.js: a system of statecharts running IN THE PAGE, still until the visitor acts.
//
// The charts run on a VirtualClock that never advances by itself, under the tracer
// (vendor/tracer.js, the same recorder the replays were made with), whose events feed the Office's
// sim incrementally (sim.append). Every visitor action is one trace instant: a press sends an
// event, a click on the clock advances virtual time to the next due timer. The engine runs the
// whole causal chain at once; the room then plays it back at a watchable pace up to a "released"
// cursor (everything, or one hop at a time when stepping) and comes to rest.
//
// Trace time is virtual time plus an offset that grows by STEP_MS at every press, so two presses
// at the same virtual instant are two instants of the trace (the chains do not interleave). Timer
// dues recorded before a press move with it, so a desk timer rings when its send really fires.
//
// The interface the world uses is in README.md.
import { createSession, nameMatch, VirtualClock } from "./vendor/scxmljs.js";
import { createTracer } from "./vendor/tracer.js";
import { createSim } from "../core/sim.js";

import { LIVE_SYSTEMS as SYSTEMS } from "./catalog.js";
export { SYSTEMS };
const STEP_MS = 1000; // trace ms between two presses at one virtual instant
const TAIL = 3.8; // playback seconds the room keeps moving after a chain (walk-outs, settling poses)
const HERE = new URL(".", import.meta.url);

const emitter = () => {
  const fns = new Map();
  return { on: (e, f) => { (fns.get(e) || fns.set(e, new Set()).get(e)).add(f); return () => fns.get(e).delete(f); }, emit: (e, x) => { for (const f of fns.get(e) || []) { try { f(x); } catch (err) { console.error(err); } } } };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

export async function bootLive(name, opts = {}) {
  const id = SYSTEMS.some((s) => s.id === name) ? name : "microwave";
  const def = (await import(new URL(`systems/${id}.js`, HERE).href)).default;
  const bus = emitter();
  const gapByT = new Map(); // trace t of an instant -> the playback gap before it
  const trace = { system: `live-${id}`, scenario: "live", charts: {}, actors: [], externals: [], events: [] };
  const paceByT = new Map(); // trace t -> playback speed-up of that instant (many instants in one press)
  const sim = createSim(trace, { live: { gapSec: (t) => gapByT.get(t) ?? (paceByT.has(t) ? 0.3 / paceByT.get(t) : undefined), spanSec: (t, g) => (paceByT.has(t) ? (g.quiet ? 0.12 : Math.max(0.35, g.D * 0.72)) / paceByT.get(t) : undefined) } });
  const texts = new Map();
  const load = async (file) => {
    if (!texts.has(file)) { const r = await fetch(new URL(`charts/${id}/${file}`, HERE)); if (!r.ok) throw new Error(`live: chart ${file}: ${r.status}`); texts.set(file, await r.text()); }
    return texts.get(file);
  };
  for (const f of def.preload || []) await load(f);

  let run = null; // everything of one run of the system: reset makes a new one
  let playS = 0, cursor = Infinity, stepping = false, busy = 0, viewingPast = false;
  const pending = []; // events recorded since the last append

  async function start() {
    const clock = new VirtualClock();
    let offset = 0;
    const traceClock = { now: () => clock.now() + offset };
    const roots = []; // sessions the system made (invoked children hang off them)
    let next = null; // the identity of the session being made
    const tracer = createTracer({
      system: trace.system,
      scenario: "live",
      clock: traceClock,
      app: def.app || { id: "user", label: "the person using it", kind: "user" },
      appCause: def.appCause,
      identify: (s, info) => (def.identify && def.identify(s, info)) || (info.parent ? undefined : next || undefined),
      resolveOrigin: def.resolveOrigin,
      onEvent: (e) => pending.push(e),
    });
    const app = def.app || { id: "user", label: "the person using it", kind: "user" };
    tracer.external(app.id, app);
    for (const x of def.externals || []) tracer.external(x.id, x);
    const engine = tracer.wrapEngine(createSession, () => next || undefined);
    run = { clock, tracer, roots, offset: () => offset, bump: (ms) => { offset += ms; }, engine, state: {}, timers: new Map() };
    run.setNext = (n) => (next = n);
    trace.charts = tracer.charts; trace.actors = tracer.actors; trace.events = [];
    Object.assign(sim.trace, { charts: trace.charts, actors: trace.actors, externals: [], events: trace.events });
    gapByT.clear(); paceByT.clear(); pending.length = 0;
    await def.boot(ctx);
    await settle();
    commit(null);
    playS = restS(); cursor = Infinity;
  }

  // ---- what a system definition gets ----
  const ctx = {
    get clock() { return run.clock; },
    get tracer() { return run.tracer; },
    get state() { return run.state; },
    load,
    /** Make, observe and start a session of a chart file; `who` names it ({id, label, chart, data}). */
    async spawn(file, who = {}, options = {}) {
      const source = await load(file);
      run.setNext({ id: who.id, label: who.label || who.id, chart: who.chart || file.replace(/\.scxml$/, ""), source: file, identity: who.identity || who.id });
      const s = await run.engine(source, { clock: run.clock, ...(def.sessionOptions ? def.sessionOptions(ctx) : {}), ...options, ...(who.data ? { data: who.data } : {}) });
      run.setNext(null);
      run.roots.push(s);
      s.start();
      return s;
    },
    as: (endpoint, fn) => run.tracer.as(endpoint, fn),
    /** A createSession for a system that makes its own sessions: observed, named by `hint(source, options)`, kept as a root. */
    engine: (hint) => async (source, options) => {
      run.setNext((hint && hint(source, options)) || null);
      try { const s = await run.engine(source, { clock: run.clock, ...options }); run.roots.push(s); return s; } finally { run.setNext(null); }
    },
    /** Inside a press: let virtual time run, timer by timer, while `pred()` holds (a model streaming its answer). */
    async advanceWhile(pred, max = 400) {
      let n = 0;
      while (n < max && pred()) { const nxt = run.clock.nextTimerAt; if (nxt === undefined) break; run.clock.run(nxt); await settle(true); n++; }
      return n;
    },
    /** Inside a press: let `ms` of virtual time pass (a leave that the bus delivers 1 ms later). */
    async advanceBy(ms) { run.clock.run(run.clock.now() + ms); await settle(true); },
    /** Count a promise the engine waits on (a chart fetched by a loader), so a press settles after it. */
    track: (p) => { run.inflight = (run.inflight || 0) + 1; return Promise.resolve(p).finally(() => { run.inflight--; }); },
    sessions: () => allSessions(),
    session: (actorId) => allSessions().get(actorId) || null,
    actorOf: (s) => run.tracer.actorOf(s),
    alive: (actorId) => { const s = allSessions().get(actorId); return !!s && s.status === "running"; },
    send: (actorId, event, data, from) => sendTo(actorId, event, data, from),
    sim,
  };

  function allSessions() {
    const out = new Map();
    const walk = (s) => { const a = run.tracer.actorOf(s); if (a && s.status !== "done") out.set(a, s); for (const inv of s.invocations || []) if (inv.session) walk(inv.session); };
    for (const s of run.roots) walk(s);
    return out;
  }

  // ---- running the engine ----
  async function settle(inner = false) {
    const { clock } = run;
    let quiet = 0;
    // microtasks first (the engine's queues and promise chains need no frame); a real task only
    // while something outside is awaited (a chart fetched by a loader)
    for (let i = 0; i < 4000 && quiet < 3; i++) {
      clock.run(clock.now());
      for (let k = 0; k < 8; k++) await null;
      let work = clock.ready > 0 || [...allSessions().values()].some((s) => s.processing);
      if ((run.inflight || 0) > 0) { await tick(); work = true; }
      quiet = work ? 0 : quiet + 1;
    }
    if (!inner) { await tick(); clock.run(clock.now()); for (let k = 0; k < 8; k++) await null; }
    run.tracer.flush();
  }
  // a timer's due moves with the offset; a delayed message tells its timer fired
  function fixTimers(list) {
    for (const e of list) {
      if (e.type === "timer" && e.action === "set") run.timers.set(e.id, e);
      else if (e.type === "timer" && e.timer) run.timers.delete(e.timer);
      else if (e.type === "message" && e.timer && run.timers.has(e.timer)) { const set = run.timers.get(e.timer); set.due = e.t; run.timers.delete(e.timer); list.push({ id: `${e.id}f`, t: e.t, type: "timer", actor: set.actor, action: "fired", timer: set.id }); }
    }
  }
  function commit(gapSec) {
    const list = pending.splice(0);
    fixTimers(list);
    const xs = new Map([...run.tracer.externals.values()].map((x) => [x.id, x]));
    for (const x of [def.app || { id: "user", label: "the person using it", kind: "user" }, ...(def.externals || [])]) if (!xs.has(x.id)) xs.set(x.id, { ...x }); // declared: their stations stand before anyone uses them
    sim.trace.externals = [...xs.values()];
    const t0 = list.length ? Math.min(...list.map((e) => e.t)) : null;
    if (t0 !== null && gapSec !== null) gapByT.set(t0, gapSec);
    // a press that let many instants pass (a streamed answer, a working process): play the later ones faster
    const ts = [...new Set(list.map((e) => e.t))].sort((a, b) => a - b);
    if (ts.length > 4) { const k = Math.min(6, ts.length / 4); for (const t of ts.slice(1)) paceByT.set(t, k); }
    sim.append(list);
    bus.emit("change", { events: list.length });
  }
  // one visitor action: bump the trace clock, do it, run the chain, append, tell the world
  async function act(fn, { advanceMs = 0 } = {}) {
    if (busy) return false;
    busy++;
    try {
      if (viewingPast) returnToNow();
      const lastS = sim.warp(Number.MAX_SAFE_INTEGER);
      const gap = Math.max(0.3, playS - lastS) + (advanceMs ? Math.min(2.2, 0.32 * Math.sqrt(advanceMs / 1000)) : 0);
      if (!advanceMs) { run.bump(STEP_MS); for (const e of run.timers.values()) if (typeof e.due === "number") e.due += STEP_MS; }
      await fn();
      await settle();
      commit(gap);
      return true;
    } finally { busy--; }
  }
  function sendTo(actorId, event, data, from) {
    const s = allSessions().get(actorId); if (!s) return false;
    run.tracer.as(from || (def.app || { id: "user" }).id, () => s.send(event, data));
    return true;
  }

  // ---- inputs: events the charts listen for that no chart sends ----
  const sentCache = new WeakMap();
  const sentBy = (model) => {
    if (sentCache.has(model)) return sentCache.get(model);
    const out = new Set(), aliases = new Set();
    const el = model.root.element;
    for (const tag of ["send", "raise"]) for (const n of el.getElementsByTagNameNS("*", tag)) { const ev = n.getAttribute("event"); if (ev) out.add(ev); const ty = n.getAttribute("type"); if (ty && !/scxml|#_/.test(ty)) aliases.add(ty.replace(/^.*[:/]/, "")); }
    for (const n of el.getElementsByTagNameNS("*", "invoke")) { const iid = n.getAttribute("id"); if (iid) aliases.add(iid); }
    const r = { events: out, aliases }; sentCache.set(model, r); return r;
  };
  function listensFor(model) {
    const out = [];
    for (const st of model.states) for (const t of st.transitions || []) for (const d of t.events || []) if (d && d !== "*" && !out.includes(d.replace(/\.\*$/, ""))) out.push(d.replace(/\.\*$/, ""));
    return out;
  }
  function inputsOf(actorId, s) {
    const all = [...allSessions().values()];
    const sent = new Set(), aliases = new Set();
    for (const x of all) { const r = sentBy(x.model); r.events.forEach((e) => sent.add(e)); r.aliases.forEach((a) => aliases.add(a)); }
    const cfg = def.inputs || {};
    let evs = listensFor(s.model).filter((e) => !sent.has(e) && !/^(done|error)\./.test(e) && ![...aliases].some((a) => e.startsWith(a + ".")));
    if (cfg.only) evs = cfg.only.filter((e) => evs.includes(e) || cfg.force?.includes(e));
    if (cfg.hide) evs = evs.filter((e) => !cfg.hide.some((h) => nameMatch([h], e)));
    if (cfg.order) evs.sort((a, b) => (cfg.order.indexOf(a) + 1 || 99) - (cfg.order.indexOf(b) + 1 || 99));
    return evs;
  }
  /** Would `event` be taken by `s` now? (a transition of an active state matches it and its cond holds or cannot be judged) */
  function accepts(s, event) {
    if (!s || s.status !== "running") return false;
    for (const st of s.configuration) for (const t of st.transitions || []) {
      if (!t.events?.length || !nameMatch(t.events, event)) continue;
      if (!t.cond || /_event/.test(t.cond)) return true;
      try { if (s.datamodel.evaluate(t.cond)) return true; } catch { return true; }
    }
    return false;
  }
  const payloadOf = (actorId, event) => { const p = def.inputs?.payloads?.[event]; return typeof p === "function" ? p(actorId, ctx) : p; };
  const labelOf = (event) => def.inputs?.labels?.[event] || event.replace(/[._]/g, " ").toUpperCase();

  function controls() {
    if (!run) return [];
    const out = [];
    const sessions = allSessions();
    const takers = [...sessions].filter(([a, s]) => !(def.inputs?.skip && def.inputs.skip(a)) && inputsOf(a, s).length);
    const atApp = (def.inputs?.at || (takers.length <= 1 ? "app" : "desk")) === "app";
    for (const [a, s] of takers) {
      for (const ev of inputsOf(a, s)) {
        const at = atApp ? (def.app || { id: "user" }).id : a;
        const en = !viewingPast && !busy && accepts(s, ev);
        // one button per payload when the definition offers several (ADD NOTEBOOK, ADD MUG)
        const variants = def.inputs?.variants?.[ev] || [{ label: labelOf(ev) }];
        variants.forEach((v, i) => out.push({ id: `in:${a}:${ev}${i ? `:${i}` : ""}`, at, group: a, kind: "button", label: v.label, event: ev, actor: a, enabled: en && (v.enabled ? v.enabled(a, ctx) !== false : true), press: () => act(() => sendTo(a, ev, "data" in v ? (typeof v.data === "function" ? v.data(a, ctx) : v.data) : payloadOf(a, ev))) }));
      }
    }
    for (const c of def.controls ? def.controls(ctx) : []) out.push({ kind: "button", ...c, enabled: !viewingPast && !busy && c.enabled !== false, press: () => act(() => c.press()) });
    return out;
  }
  function pendingTimers() {
    if (!run) return [];
    const now = run.clock.now() + run.offset();
    const list = [...run.timers.values()].filter((e) => typeof e.due === "number").map((e) => ({ actor: e.actor, due: e.due, in: e.due - now, id: e.id }));
    const nxt = run.clock.nextTimerAt;
    if (nxt !== undefined && !list.some((x) => x.due - run.offset() <= nxt + 1e-6)) list.push({ actor: null, due: nxt + run.offset(), in: nxt - run.clock.now(), id: "clock" });
    return list.sort((a, b) => a.due - b.due);
  }
  async function advance() {
    if (!run || busy) return false;
    const nxt = run.clock.nextTimerAt; if (nxt === undefined) return false;
    const d = nxt - run.clock.now();
    return act(() => { run.clock.run(nxt); }, { advanceMs: Math.max(1, d) });
  }
  // ---- playback pacing ----
  const lastS = () => sim.warp(Number.MAX_SAFE_INTEGER);
  const restS = () => lastS() + TAIL;
  function hops() {
    const s = new Set(); for (const e of sim.eventsBetween(-1, Number.MAX_SAFE_INTEGER)) if (e.type === "message" || e.type === "transition" || e.type === "spawn" || e.type === "end") s.add(Math.round(sim.warp(e.at) * 1000) / 1000);
    return [...s].sort((a, b) => a - b);
  }
  function step() {
    stepping = true;
    const from = Math.max(playS, cursor === Infinity ? playS : cursor);
    const h = hops().find((x) => x > from + 0.02);
    cursor = h === undefined ? restS() : h + 0.05;
    bus.emit("cursor", { cursor });
    return h !== undefined;
  }
  function setStepping(b) { stepping = !!b; cursor = stepping ? Math.max(playS, Math.min(cursor, playS)) : Infinity; bus.emit("cursor", { cursor }); }
  function returnToNow() { viewingPast = false; playS = Math.min(restS(), Math.max(playS, cursor === Infinity ? restS() : cursor)); bus.emit("now", {}); }

  async function reset() {
    if (busy) return;
    busy++;
    try {
      for (const s of run.roots) { try { s.dispose(); } catch {} }
      if (def.dispose) def.dispose(ctx);
      await start();
    } finally { busy--; }
    bus.emit("change", { reset: true });
  }

  function snapshot() {
    const actors = {};
    for (const [a, s] of allSessions()) { let values = {}; try { values = JSON.parse(JSON.stringify(s.snapshot())); } catch {} actors[a] = { states: s.activeStateIds(), values, status: s.status }; }
    return { system: id, now: run.clock.now(), traceNow: run.clock.now() + run.offset(), actors, pendingTimers: pendingTimers().length, events: sim.trace.events.length, playS, restS: restS(), atRest: atRest(), stepping, cursor, viewingPast, busy: !!busy, state: def.snapshot ? def.snapshot(ctx) : undefined };
  }
  // the world tells us where the playhead is; we tell it how far it may go
  const atRest = () => !viewingPast && playS >= Math.min(restS(), cursor) - 1e-6;
  const live = {
    id, def, title: def.title || id, sim, trace: sim.trace, office: { ...(def.office || {}), plan: { showIdleExternals: true, ...(def.office?.plan || {}) } }, systems: SYSTEMS,
    controls, pendingTimers, advance, step, setStepping, reset, snapshot,
    get stepping() { return stepping; }, get busy() { return !!busy; }, get viewingPast() { return viewingPast; },
    on: bus.on,
    /** The playback second the room may play up to now. */
    released: () => (viewingPast ? playS : Math.min(restS(), cursor)),
    restS, atRest,
    setPlayhead: (s) => { playS = s; },
    /** The visitor looked at the past (the board): the room shows that moment until returnToNow(). */
    viewPast: (s) => { viewingPast = s < restS() - 0.05; playS = s; bus.emit("now", {}); },
    returnToNow,
    send: (actorId, event, data) => act(() => sendTo(actorId, event, data)),
    accepts: (actorId, event) => accepts(allSessions().get(actorId), event),
    ctx,
  };
  ctx.live = live;
  await start();
  return live;
}
