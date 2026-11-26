// core/sim.js: a recorded run of ANY system of statecharts, as a pure function of time.
// No three.js here. Needs only the REQUIRED trace fields (charts, actors, externals, events of
// types spawn/end/config/transition/message, data/snapshot when there is a datamodel); uses
// cause/via, stories, worlds, wiring, docs when they are there.
//
// Time. A bus with zero latency puts a whole causal chain on one trace millisecond. Every event
// gets a `depth` (message hops before it inside its instant: from via/cause when recorded, else
// "after whatever reached the sender in this instant") and an effective time
// `at = t + depth * HOP` (HOP < 1 ms / max depth). Queries order by `at`; `t` stays the trace's.
// `warp` maps virtual ms to playback seconds: each hop of an instant gets HOP_SEC, idle gaps are
// compressed. `flight(m)` is the playback window a message spends in its tube.
//
// Lifetimes. An actor can live several times (a process kill and resume re-spawns the same id):
// lifetimes come from spawn/end events, else from bornAt/diedAt.
//
// Live use. `append(events)` adds events (sorted by t, after the last) and rebuilds the indexes.

import { computeSituations } from "./situation.js";

export async function loadSim(traceUrl) {
  let trace;
  if (typeof window === "undefined" && !/^https?:/.test(String(traceUrl))) {
    const fs = await import("node:fs");
    trace = JSON.parse(fs.readFileSync(traceUrl instanceof URL ? traceUrl : String(traceUrl), "utf8"));
  } else {
    const r = await fetch(traceUrl); if (!r.ok) throw new Error(`trace ${traceUrl}: ${r.status}`); trace = await r.json();
  }
  return createSim(trace);
}

function upperBound(arr, x, key) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (key(arr[m]) <= x) lo = m + 1; else hi = m; } return lo; }
const byAt = (e) => e.at;

export function createSim(input, opts = {}) {
  const trace = { charts: {}, actors: [], externals: [], events: [], ...input };
  const sim = { trace };
  const HOP_SEC = opts.hopSec ?? 0.72;
  let ev, evSorted, byId, actors, actorById, lifetimes, configs, snaps, datas, messages, transitions, duration, knotsT, knotsS, situations, HOP;

  function build() {
    const events = trace.events;
    events.forEach((e, i) => { if (!e.id) e.id = `e${i}`; });
    byId = new Map(events.map((e) => [e.id, e]));

    // ---- actors and externals (also those only seen in events) ----
    actors = trace.actors.map((a) => ({ ...a }));
    const known = new Set(actors.map((a) => a.id));
    for (const e of events) if ((e.type === "spawn" || e.type === "config" || e.type === "transition") && e.actor && !known.has(e.actor)) { known.add(e.actor); actors.push({ id: e.actor, chart: e.chart || null, label: e.actor, role: "", bornAt: e.t }); }
    const exts = trace.externals.map((x) => ({ ...x, external: true }));
    for (const x of exts) known.add(x.id);
    for (const e of events) if (e.type === "message") for (const id of [e.from, e.to]) if (id && id !== "*" && !known.has(id)) { known.add(id); exts.push({ id, label: id, kind: "unknown", external: true }); }
    actors = [...actors, ...exts];
    actorById = new Map(actors.map((a) => [a.id, a]));

    // ---- depth inside an instant ----
    const depth = new Map(), lastTransOf = new Map(), inbox = new Map();
    for (const e of events) if (e.type === "message") { const k = `${e.t}|${e.to}`; (inbox.get(k) || inbox.set(k, []).get(k)).push(e); }
    const dep = (e) => {
      if (depth.has(e.id)) return depth.get(e.id);
      depth.set(e.id, 0);
      const same = (id) => { const c = id && byId.get(id); return c && c.t === e.t && c !== e ? c : null; };
      let d = 0;
      if (e.type === "message") {
        const v = same(e.via), c = same(e.cause);
        if (v) d = dep(v) + 1; else if (c) d = dep(c) + 1;
        else { const ins = (inbox.get(`${e.t}|${e.from}`) || []).filter((m) => m !== e); if (ins.length) d = Math.max(...ins.map(dep)) + 1; }
      } else if (e.type === "transition" || e.type === "spawn") {
        const c = same(e.cause);
        if (c) d = dep(c);
        else if (e.type === "transition" && e.event) { const ins = (inbox.get(`${e.t}|${e.actor}`) || []).filter((m) => m.name === e.event); if (ins.length) d = dep(ins[ins.length - 1]); else d = lastTransOf.get(`${e.t}|${e.actor}`) ?? 0; }
        else d = lastTransOf.get(`${e.t}|${e.actor}`) ?? 0;
      } else if (e.type === "snapshot" || e.type === "data") { const c = same(e.cause); d = c ? dep(c) : (lastTransOf.get(`${e.t}|${e.actor}`) ?? 0); }
      else if (e.type === "config" || e.type === "end") d = lastTransOf.get(`${e.t}|${e.actor}`) ?? 0;
      depth.set(e.id, d); return d;
    };
    const pos = new Map(events.map((e, i) => [e, i]));
    for (const e of events) {
      if (e.type === "transition") lastTransOf.set(`${e.t}|${e.actor}`, Math.max(lastTransOf.get(`${e.t}|${e.actor}`) ?? 0, dep(e)));
      else if (e.type === "config" || e.type === "end") { depth.delete(e.id); dep(e); }
      else dep(e);
    }
    const maxD = Math.max(1, ...depth.values());
    HOP = 0.8 / (maxD + 1);
    ev = events.map((e) => ({ ...e, depth: depth.get(e.id), at: e.t + depth.get(e.id) * HOP }));
    evSorted = ev.slice().sort((a, b) => a.at - b.at || pos.get(byId.get(a.id)) - pos.get(byId.get(b.id)));

    // ---- lifetimes ----
    lifetimes = new Map();
    const open = new Map();
    for (const e of evSorted) {
      if (e.type === "spawn") { if (open.has(e.actor)) (lifetimes.get(e.actor) || lifetimes.set(e.actor, []).get(e.actor)).push([open.get(e.actor), e.at]); open.set(e.actor, e.at); }
      else if (e.type === "end" && open.has(e.actor)) { (lifetimes.get(e.actor) || lifetimes.set(e.actor, []).get(e.actor)).push([open.get(e.actor), e.at]); open.delete(e.actor); }
    }
    for (const [id, a] of open) (lifetimes.get(id) || lifetimes.set(id, []).get(id)).push([a, Infinity]);
    for (const a of actors) if (!a.external && !lifetimes.has(a.id)) lifetimes.set(a.id, [[a.bornAt ?? 0, a.diedAt ?? Infinity]]);
    for (const a of actors) if (!a.external) { const l = lifetimes.get(a.id); a.bornAt = l[0][0]; a.diedAt = l[l.length - 1][1] === Infinity ? undefined : l[l.length - 1][1]; }

    // ---- per-actor timelines ----
    configs = new Map(); snaps = new Map(); datas = new Map();
    const push = (m, k, v) => { (m.get(k) || m.set(k, []).get(k)).push(v); };
    for (const e of evSorted) {
      if (e.type === "config") push(configs, e.actor, e);
      else if (e.type === "snapshot") push(snaps, e.actor, e);
      else if (e.type === "data" && "value" in e) push(datas, e.actor, e);
    }
    messages = evSorted.filter((e) => e.type === "message");
    transitions = evSorted.filter((e) => e.type === "transition");
    // configs synthesized from transitions when a trace has none for an actor
    for (const a of actors) if (!a.external && !configs.has(a.id)) {
      const ts = transitions.filter((x) => x.actor === a.id); let cur = new Set(); const list = [];
      for (const x of ts) { for (const s of x.from || []) cur.delete(s); for (const s of x.to || []) cur.add(s); list.push({ type: "config", actor: a.id, at: x.at, t: x.t, active: withAncestors(a.chart, [...cur]) }); }
      if (list.length) configs.set(a.id, list);
    }

    // ---- warp ----
    const groups = new Map();
    for (const e of ev) {
      const g = groups.get(e.t) || { t: e.t, D: 0, quiet: true };
      g.D = Math.max(g.D, e.depth);
      if (e.type === "message" || e.type === "transition" || e.type === "spawn" || e.type === "end") g.quiet = false;
      groups.set(e.t, g);
    }
    const gl = [...groups.values()].sort((a, b) => a.t - b.t);
    knotsT = [-1]; knotsS = [0];
    let s = 0.8;
    // long runs: shrink per-hop and per-gap time so a loop stays watchable
    const nHops = gl.reduce((n, g) => n + (g.quiet ? 0.15 : Math.max(0.5, g.D)), 0);
    const hopSec = opts.live ? HOP_SEC : Math.max(0.22, Math.min(HOP_SEC, 55 / Math.max(1, nHops))); // live: a fixed pace, so earlier instants keep their playback times as the run grows
    const gapK = opts.gapK ?? 0.052 * Math.min(1, hopSec / HOP_SEC);
    for (let i = 0; i < gl.length; i++) {
      const g = gl[i];
      if (i > 0) { const prevEnd = gl[i - 1].t + (gl[i - 1].D + 1) * HOP; const gap = g.t - prevEnd; s += opts.live ? (opts.live.gapSec?.(g.t) ?? 0.3) : Math.max(0.12, Math.min(2.8, gapK * Math.sqrt(Math.max(0, gap)))); } // live: the gap is when the visitor acted
      knotsT.push(g.t); knotsS.push(s);
      s += opts.live?.spanSec?.(g.t, g) ?? (g.quiet ? 0.12 : Math.max(0.35, g.D * hopSec)); // live: a long chain of instants (a streamed answer) may be played faster
      knotsT.push(g.t + (g.D + 1) * HOP); knotsS.push(s);
    }
    const lastT = knotsT[knotsT.length - 1];
    duration = Math.max(trace.duration || 0, Math.ceil(lastT));
    if (!opts.live && duration > lastT) { /* live: no tail, the run is open-ended */ s += Math.max(0.6, Math.min(3, 0.11 * Math.sqrt(duration - lastT))); knotsT.push(duration); knotsS.push(s); }
    const CAP = opts.maxLoop ?? 100;
    if (!opts.live && s > CAP) { /* live: never rescaled */ const k = CAP / s; for (let i = 0; i < knotsS.length; i++) knotsS[i] *= k; s = CAP; }
    sim.playDuration = s + 2.0;
    sim.hopSec = hopSec;
    sim.duration = duration; sim.HOP = HOP;
    sim.actors = actors;
    situations = null; // computed lazily
  }

  function withAncestors(chartName, ids) {
    const ch = trace.charts[chartName]; if (!ch) return ids;
    const parent = new Map(); const walk = (n, p) => { parent.set(n.id, p); (n.children || []).forEach((c) => walk(c, n.id)); }; walk(ch.root, null);
    const out = new Set(); for (const id of ids) { let x = id; while (x && !out.has(x)) { out.add(x); x = parent.get(x); } }
    return [...out];
  }

  function lifeAt(id, t) { const l = lifetimes.get(id); if (!l) return null; for (const r of l) if (t >= r[0] && t < r[1]) return r; return null; }
  function alive(id, t) { const a = actorById.get(id); if (!a) return false; if (a.external) return true; return !!lifeAt(id, t); }
  function activeAt(id, t) {
    const a = actorById.get(id); if (!a || a.external) return [];
    const life = lifeAt(id, t); if (!life) return [];
    const list = configs.get(id); if (!list) return [];
    const i = upperBound(list, t, byAt) - 1;
    return i >= 0 && list[i].at >= life[0] - 1e-9 ? list[i].active.slice() : [];
  }
  function valuesAt(id, t) {
    const out = {}; let since = -Infinity;
    const list = snaps.get(id);
    if (list) { const i = upperBound(list, t, byAt) - 1; if (i >= 0) { Object.assign(out, list[i].values); since = list[i].at; } }
    const dl = datas.get(id);
    if (dl) for (const d of dl) { if (d.at > t) break; if (d.at > since) out[d.key] = d.value; }
    return out;
  }
  const range = (arr, t0, t1) => { const i0 = upperBound(arr, t0 - 1e-9, byAt); const out = []; for (let i = i0; i < arr.length && arr[i].at < t1; i++) out.push(arr[i]); return out; };
  const msgOut = (e) => ({ id: e.id, t: e.t, at: e.at, depth: e.depth, from: e.from, to: e.to, name: e.name, summary: e.summary, cause: e.cause, via: e.via, delay: e.delay });
  function warp(t) {
    if (t <= knotsT[0]) return 0;
    if (t >= knotsT[knotsT.length - 1]) return knotsS[knotsS.length - 1];
    const i = upperBound(knotsT, t, (x) => x) - 1; const t0 = knotsT[i], t1 = knotsT[i + 1];
    return knotsS[i] + (t1 > t0 ? (t - t0) / (t1 - t0) : 0) * (knotsS[i + 1] - knotsS[i]);
  }
  function unwarp(sec) {
    if (sec <= 0) return Math.max(0, knotsT[0]);
    if (sec >= knotsS[knotsS.length - 1]) return duration;
    const i = upperBound(knotsS, sec, (x) => x) - 1; const s0 = knotsS[i], s1 = knotsS[i + 1];
    return Math.max(0, knotsT[i] + (s1 > s0 ? (sec - s0) / (s1 - s0) : 0) * (knotsT[i + 1] - knotsT[i]));
  }

  build();

  Object.assign(sim, {
    get actorsList() { return actors; },
    actor: (id) => actorById.get(id) || null,
    chartOf: (id) => { const a = actorById.get(id); return a && !a.external ? trace.charts[a.chart] || null : null; },
    lifetimes: (id) => (lifetimes.get(id) || []).map((r) => r.slice()),
    lifeAt, alive, activeAt, valuesAt,
    messagesBetween: (t0, t1) => range(messages, t0, t1).map(msgOut),
    transitionsBetween: (t0, t1) => range(transitions, t0, t1).map((e) => ({ id: e.id, t: e.t, at: e.at, depth: e.depth, actor: e.actor, event: e.event, from: e.from, to: e.to, cause: e.cause })),
    eventsBetween: (t0, t1) => range(evSorted, t0, t1),
    event: (id) => { const e = byId.get(id); if (!e) return null; const x = ev.find((y) => y.id === id); return x ? { ...x } : null; },
    get stories() { return trace.stories || []; },
    warp, unwarp,
    // a hop departs when its sender's step runs, but spends at least 0.7 s in the tube so it can be seen
    flight: (m) => { const s1 = warp(m.at); const s0 = m.depth > 0 ? Math.min(warp(m.at - HOP), s1 - 0.7) : s1 - 1.0; return [Math.max(0, s0), s1]; },
    // a broadcast ("*") goes to every actor alive then, but its sender
    recipients: (m) => (m.to === "*" ? actors.filter((a) => !a.external && a.id !== m.from && alive(a.id, m.at)).map((a) => a.id) : [m.to]),
    situationAt: (id, t) => { if (!situations) situations = computeSituations(sim); const segs = situations.get(id); if (!segs || !segs.length) return { kind: alive(id, t) ? "idle" : "absent", since: 0 }; const i = upperBound(segs, t, (s) => s.from) - 1; return i < 0 ? { kind: "absent", since: 0 } : { kind: segs[i].kind, since: segs[i].from, detail: segs[i].detail }; },
    situations: (id) => { if (!situations) situations = computeSituations(sim); return (situations.get(id) || []).map((s) => ({ ...s })); },
    append(events) { trace.events.push(...events); build(); },
  });
  return sim;
}
