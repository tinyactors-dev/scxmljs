// core/sim.js: the recorded run as a pure function of time. No three.js in here.
//
// The trace records the bus with zero latency, so a causal chain (stage -> Ada -> host -> model)
// happens at one virtual millisecond. To let a viewer follow it, every event gets a `depth`: the
// number of message hops before it within its instant, and an effective time `at = t + depth * HOP`
// (HOP is a few hundredths of a millisecond, always below the 1 ms between distinct trace times).
// activeAt / valuesAt / the *Between queries order by `at`; `t` stays the trace's time.
// warp() maps virtual ms to playback seconds: idle gaps are compressed, and each instant's hops
// are stretched to a fixed playback time per hop, so one loop plays in about 80 s.

const HOP = 0.04; // virtual ms per hop inside one instant (max depth * HOP < 1 ms)

export async function loadSim(traceUrl) {
  let trace;
  if (typeof window === "undefined" && !/^https?:/.test(String(traceUrl))) {
    const fs = await import("node:fs");
    trace = JSON.parse(fs.readFileSync(traceUrl instanceof URL ? traceUrl : String(traceUrl), "utf8"));
  } else {
    trace = await (await fetch(traceUrl)).json();
  }
  return createSim(trace);
}

function upperBound(arr, x, key) { // first index with key(arr[i]) > x
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (key(arr[m]) <= x) lo = m + 1; else hi = m; }
  return lo;
}

export function createSim(trace) {
  const events = trace.events;
  const byId = new Map(events.map((e) => [e.id, e]));

  // ---- depth within an instant ----
  // A message sent during transition `via` departs when that step runs and arrives one hop later.
  // A transition runs when the message that caused it arrives. Links to an earlier instant count 0.
  const depth = new Map();
  const lastTransOf = new Map(); // `${t}|${actor}` -> depth of the last transition (file order)
  const inbox = new Map();       // `${t}|${actor}` -> messages to it at t, earlier in file order
  for (const e of events) if (e.type === "message") { const k = `${e.t}|${e.to}`; if (!inbox.has(k)) inbox.set(k, []); inbox.get(k).push(e); }
  function dep(e) {
    if (depth.has(e.id)) return depth.get(e.id);
    depth.set(e.id, 0); // guards cycles
    const same = (id) => { const c = id && byId.get(id); return c && c.t === e.t && c !== e ? c : null; };
    let d = 0;
    if (e.type === "message") {
      const v = same(e.via), c = same(e.cause);
      if (v) d = dep(v) + 1; else if (c) d = dep(c) + 1;
      else { // no recorded link inside this instant: after whatever reached the sender in it
        const ins = (inbox.get(`${e.t}|${e.from}`) || []).filter((m) => m !== e); if (ins.length) d = Math.max(...ins.map(dep)) + 1;
      }
    } else if (e.type === "transition" || e.type === "spawn") {
      const c = same(e.cause); if (c) d = dep(c);
    } else if (e.type === "snapshot" || e.type === "data") {
      const c = same(e.cause); d = c ? dep(c) : (lastTransOf.get(`${e.t}|${e.actor}`) ?? 0);
    } else if (e.type === "config" || e.type === "end") {
      d = lastTransOf.get(`${e.t}|${e.actor}`) ?? 0;
    }
    depth.set(e.id, d); return d;
  }
  for (const e of events) {
    if (e.type === "transition") { lastTransOf.set(`${e.t}|${e.actor}`, dep(e)); }
    else if (e.type === "config" || e.type === "end") { depth.delete(e.id); dep(e); }
    else dep(e);
  }
  // A transition triggered by a message happens when it arrives; ensure monotone per actor
  // (configs after transitions already take the transition's depth).
  const at = (e) => e.t + depth.get(e.id) * HOP;
  const ev = events.map((e) => ({ ...e, depth: depth.get(e.id), at: at(e) }));
  const evSorted = ev.slice().sort((a, b) => a.at - b.at || (a.id.slice(1) - b.id.slice(1)));

  // ---- actors ----
  const actors = [
    ...trace.actors.map((a) => ({ ...a })),
    ...trace.externals.map((x) => ({ ...x, external: true })),
  ];
  const actorById = new Map(actors.map((a) => [a.id, a]));

  // per-actor timelines
  const configs = new Map(), snaps = new Map(), datas = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const e of evSorted) {
    if (e.type === "config") push(configs, e.actor, e);
    else if (e.type === "snapshot") push(snaps, e.actor, e);
    else if (e.type === "data" && "value" in e) push(datas, e.actor, e);
  }
  const messages = evSorted.filter((e) => e.type === "message");
  const transitions = evSorted.filter((e) => e.type === "transition");
  const byAt = (e) => e.at;

  function alive(a, t) {
    if (!a || a.external) return !!a;
    if (t < a.bornAt) return false;
    if (a.diedAt != null && t >= a.diedAt) return false;
    return true;
  }
  function activeAt(actorId, t) {
    const a = actorById.get(actorId);
    if (!a || a.external || !alive(a, t)) return [];
    const list = configs.get(actorId); if (!list) return [];
    const i = upperBound(list, t, byAt) - 1;
    return i >= 0 ? list[i].active.slice() : [];
  }
  function valuesAt(actorId, t) {
    const list = snaps.get(actorId); const out = {};
    let since = -Infinity;
    if (list) { const i = upperBound(list, t, byAt) - 1; if (i >= 0) { Object.assign(out, list[i].values); since = list[i].at; } }
    const dl = datas.get(actorId);
    if (dl) for (const d of dl) { if (d.at > t) break; if (d.at > since) out[d.key] = d.value; }
    return out;
  }
  const range = (arr, t0, t1) => { const i0 = upperBound(arr, t0 - 1e-9, byAt); const out = []; for (let i = i0; i < arr.length && arr[i].at < t1; i++) out.push(arr[i]); return out; };
  function messagesBetween(t0, t1) {
    return range(messages, t0, t1).map((e) => ({ id: e.id, t: e.t, at: e.at, depth: e.depth, from: e.from, to: e.to, name: e.name, summary: e.summary, cause: e.cause, via: e.via }));
  }
  function transitionsBetween(t0, t1) {
    return range(transitions, t0, t1).map((e) => ({ id: e.id, t: e.t, at: e.at, depth: e.depth, actor: e.actor, event: e.event, from: e.from, to: e.to, cause: e.cause }));
  }
  function eventsBetween(t0, t1) { return range(evSorted, t0, t1); }

  // ---- warp: virtual ms -> playback seconds ----
  // knots: for each instant t0 with max depth D: [t0 -> s], [t0 + (D+1)*HOP -> s + hops]
  const HOP_SEC = 0.72;       // playback seconds per hop inside an instant
  const groups = new Map();
  for (const e of ev) {
    const g = groups.get(e.t) || { t: e.t, D: 0, n: 0, quiet: true };
    g.D = Math.max(g.D, e.depth); g.n++;
    if (e.type === "message" && !/^log\.batch$|^snapshot\.send$|^invoke package/.test(e.name)) g.quiet = false;
    if (e.type === "transition" && !String(e.actor).startsWith("package:")) g.quiet = false;
    groups.set(e.t, g);
  }
  const gl = [...groups.values()].sort((a, b) => a.t - b.t);
  const knotsT = [], knotsS = [];
  let s = 0.8; // a moment of rest before anything happens
  knotsT.push(-1); knotsS.push(0);
  for (let i = 0; i < gl.length; i++) {
    const g = gl[i];
    if (i > 0) {
      const prevEnd = gl[i - 1].t + (gl[i - 1].D + 1) * HOP;
      const gap = g.t - prevEnd; // virtual ms of nothing happening
      // gaps: short ones keep their length-ish, long ones compressed (sqrt), never below 0.25 s
      s += Math.max(0.22, Math.min(2.8, 0.052 * Math.sqrt(gap)));
    }
    knotsT.push(g.t); knotsS.push(s);
    const hops = g.quiet ? 0.12 : Math.max(0.35, g.D * HOP_SEC);
    s += hops;
    knotsT.push(g.t + (g.D + 1) * HOP); knotsS.push(s);
  }
  // tail to the end of the run plus a pause
  const lastT = knotsT[knotsT.length - 1];
  const duration = Math.max(trace.duration, Math.ceil(lastT));
  if (duration > lastT) { s += Math.max(0.6, Math.min(3, 0.11 * Math.sqrt(duration - lastT))); knotsT.push(duration); knotsS.push(s); }
  const playDuration = s + 2.0; // seconds per loop, with a pause at the end (clamped to duration)

  function warp(t) {
    if (t <= knotsT[0]) return 0;
    if (t >= knotsT[knotsT.length - 1]) return knotsS[knotsS.length - 1];
    const i = upperBound(knotsT, t, (x) => x) - 1;
    const t0 = knotsT[i], t1 = knotsT[i + 1];
    const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    return knotsS[i] + f * (knotsS[i + 1] - knotsS[i]);
  }
  function unwarp(sec) {
    if (sec <= 0) return Math.max(0, knotsT[0]);
    const lastS = knotsS[knotsS.length - 1];
    if (sec >= lastS) return duration;
    const i = upperBound(knotsS, sec, (x) => x) - 1;
    const s0 = knotsS[i], s1 = knotsS[i + 1];
    const f = s1 > s0 ? (sec - s0) / (s1 - s0) : 0;
    return Math.max(0, knotsT[i] + f * (knotsT[i + 1] - knotsT[i]));
  }

  return {
    trace,
    duration,
    playDuration,          // playback seconds of one loop (warp(duration) + a pause)
    HOP, HOP_SEC,
    actors,
    actor: (id) => actorById.get(id) || null,
    chartOf: (id) => { const a = actorById.get(id); return a && !a.external ? trace.charts[a.chart] || null : null; },
    alive: (id, t) => alive(actorById.get(id), t),
    activeAt, valuesAt, messagesBetween, transitionsBetween, eventsBetween,
    event: (id) => { const e = byId.get(id); return e ? { ...e, depth: depth.get(id), at: at(e) } : null; },
    stories: trace.stories || [],
    warp, unwarp,
    // playback seconds a message spends in its tube: a hop inside an instant departs when its
    // sender's step runs; a message with no link inside its instant (a reply of the model, a timer)
    // travels for a second before it arrives at `at`.
    flight: (m) => { const s1 = warp(m.at); const s0 = m.depth > 0 ? warp(m.at - HOP) : Math.max(0, s1 - 1.0); return [s0, s1]; },
  };
}
