// core/situation.js: what an actor is doing at time t, for ANY chart, from the chart and the run.
// No per-system table. Kinds, in priority order:
//   absent     not alive
//   done       a top-level final state is active (the chart finished; it may still be tidying up)
//   exception  the active leaf is an exceptional state (named like fail/error/offline/backoff/...,
//              or reachable only by an exceptional event), or an error event just arrived
//   working    a burst: it changed state within the last BURST playback seconds
//   waiting    it sent someone a request and their answer has not come yet (and is not instant)
//   working    it started an invoke of something outside that has not finished
//   idle       stable in a state, waiting for outside input
// computeSituations(sim) -> Map(actorId -> [{kind, from, to, detail}]) segments in virtual ms.

export const EXC_STATE = /fail|error|offline|backoff|reject|timeout|abort|cancel|crash|dead|^left$|^locked$|^stopped$|^killed$/i;
export const EXC_EVENT = /(^|\.)(error|fail|failed|timeout|interrupt|cancel|offline|crash|rejected|abort|kill)(\.|$)/i;
const BURST = 0.7;       // playback seconds a state change counts as work
const ERR_SHOW = 1.4;    // playback seconds an error event shows
const MIN_WAIT = 0.45;
const EXC_HOLD = 2.5;   // playback seconds an exceptional state in one parallel region shows   // playback seconds: answers faster than this are not "waiting"

export function chartInfo(chart) {
  const info = { parent: new Map(), kind: new Map(), finals: new Set(), topFinals: new Set(), exceptional: new Set(), invokes: new Set(), children: new Map() };
  if (!chart || !chart.root) return info;
  const walk = (n, p) => { info.parent.set(n.id, p); info.kind.set(n.id, n.kind); info.children.set(n.id, (n.children || []).map((c) => c.id)); if (n.kind === "final") info.finals.add(n.id); if (n.invokes && n.invokes.length) info.invokes.add(n.id); (n.children || []).forEach((c) => walk(c, n.id)); };
  walk(chart.root, null);
  // the "top" of the chart: the root, or its single compound child (llm-chat's clients wrap in one)
  let top = chart.root; while (top.children && top.children.length === 1 && top.children[0].kind !== "atomic" && top.children[0].kind !== "final") top = top.children[0];
  for (const f of info.finals) { const p = info.parent.get(f); if (p === chart.root.id || p === top.id) info.topFinals.add(f); }
  // exceptional states: by name, or every transition into them is exceptional
  const inbound = new Map(); const all = [];
  const walkT = (n) => { all.push(n); for (const tr of n.transitions || []) for (const tg of tr.targets || []) (inbound.get(tg) || inbound.set(tg, []).get(tg)).push(tr); (n.children || []).forEach(walkT); };
  walkT(chart.root);
  const initials = new Set(); for (const n of all) for (const i of n.initial || []) initials.add(i);
  for (const n of all) {
    if (n.kind === "final" || n.id === chart.root.id) continue;
    if (EXC_STATE.test(n.id)) { info.exceptional.add(n.id); continue; }
    const ins = inbound.get(n.id) || [];
    if (ins.length && !initials.has(n.id) && ins.every((tr) => tr.event && EXC_EVENT.test(tr.event))) info.exceptional.add(n.id);
  }
  return info;
}

export function computeSituations(sim) {
  const out = new Map();
  const all = sim.messagesBetween(-1, sim.duration + 1);
  const trs = sim.transitionsBetween(-1, sim.duration + 1);
  const W = sim.warp, U = sim.unwarp;
  const extKind = (id) => { const a = sim.actor(id); return a && a.external ? String(a.kind || "") : null; };
  const sinkLike = (id) => /log|bus|sink|user|stage|input|timer|clock/i.test(extKind(id) || "");
  const byId = new Map(); for (const e of sim.eventsBetween(-1, sim.duration + 1)) byId.set(e.id, e);
  const hasCause = all.length && all.filter((m) => m.cause || m.via).length / all.length > 0.3;
  const descends = (r, m) => { let x = r, n = 0; const seen = new Set(); while (x && n++ < 10) { if (x.cause === m.id || x.via === m.id) return true; const nx = byId.get(x.cause) || byId.get(x.via); if (!nx || seen.has(nx.id)) return false; seen.add(nx.id); x = nx; } return false; };
  const isAnswer = (r, m) => (extKind(m.to) ? true : hasCause ? descends(r, m) : false);
  for (const a of sim.actors) {
    if (a.external) continue;
    const chart = sim.chartOf(a.id); const info = chartInfo(chart);
    const myTr = trs.filter((x) => x.actor === a.id && (x.to || []).length);
    const errTimes = [...trs.filter((x) => x.actor === a.id && x.event && EXC_EVENT.test(x.event)).map((x) => x.at), ...sim.eventsBetween(-1, sim.duration + 1).filter((e) => e.type === "error" && e.actor === a.id).map((e) => e.at)].sort((p, q) => p - q);
    // waiting intervals: request -> first answer from the same partner
    const waits = [];
    const mine = all.filter((m) => m.from === a.id || m.to === a.id);
    for (let i = 0; i < mine.length; i++) {
      const m = mine[i]; if (m.from !== a.id || m.to === a.id || m.to === "*" || sinkLike(m.to)) continue;
      let r = null;
      for (let j = i + 1; j < mine.length; j++) { const x = mine[j]; if (x.from === m.to && x.to === a.id && isAnswer(x, m)) { r = x; break; } }
      if (!r) continue;
      if (W(r.at) - W(m.at) < MIN_WAIT) continue;
      waits.push([m.at, r.at, m.to]);
    }
    // invokes of outside things still running: "invoke ..." to an external until a done/error from it
    const invokes = [];
    for (let i = 0; i < mine.length; i++) {
      const m = mine[i]; if (m.from !== a.id || !/^invoke\b/.test(m.name) || !extKind(m.to)) continue;
      let end = Infinity; for (let j = i + 1; j < mine.length; j++) { const x = mine[j]; if (x.from === m.to && x.to === a.id && /^(done|error)/.test(x.name)) { end = x.at; break; } }
      invokes.push([m.at, end, m.to]);
    }
    const enterTimes = trs.filter((x) => x.actor === a.id);
    const lastEntry = (st, t) => { let best = -Infinity; for (const x of enterTimes) { if (x.at > t) break; if ((x.to || []).includes(st)) best = x.at; } return best; };
    // a life that ended by finishing (a final state, or an end with reason "done") shows "done" for its last moment
    const doneEnds = [];
    const endEv = sim.eventsBetween(-1, sim.duration + 1).filter((e) => e.type === "end" && e.actor === a.id);
    for (const [b, e] of sim.lifetimes(a.id)) { if (e === Infinity) continue; const ev = endEv.find((x) => Math.abs(x.at - e) < 1e-6); const act = sim.activeAt(a.id, e - 1e-6); if ((ev && /done|final|complete|finish/i.test(ev.reason || "")) || (!ev?.reason && act.some((x) => info.topFinals.has(x)))) doneEnds.push([U(Math.max(0, W(e) - 0.6)), e]); }
    // timers it set itself (delayed sends): pending from set until due, cancel or fire
    const tev = sim.eventsBetween(-1, sim.duration + 1).filter((e) => e.type === "timer" && e.actor === a.id);
    const timers = [];
    for (const e of tev) if (e.action === "set") { const stop = tev.find((x) => x !== e && (x.timer === e.id) && x.action !== "set"); const due = e.due ?? (e.t + (e.delay || 0)); timers.push([e.at, Math.min(due, stop ? stop.at : Infinity)]); }
    // invoked children alive: delegated work
    const kids = sim.actors.filter((x) => !x.external && x.parent === a.id).map((x) => x.id);
    const classify = (t) => {
      if (!sim.alive(a.id, t)) return { kind: "absent" };
      if (doneEnds.some(([d0, d1]) => t >= d0 && t < d1)) return { kind: "done", detail: {} };
      const act = sim.activeAt(a.id, t);
      const leaves = act.filter((s) => !(info.children.get(s) || []).some((c) => act.includes(c)));
      if (act.some((s) => info.topFinals.has(s))) return { kind: "done", detail: { state: leaves[0] } };
      const s = W(t);
      const exc = leaves.find((x) => info.exceptional.has(x));
      if (exc) {
        // the whole actor is in trouble when the exceptional state is not one region among several;
        // in a parallel region it shows for EXC_HOLD after entering, then the other regions speak
        const inParallel = leaves.length > 1;
        const entered = lastEntry(exc, t);
        if (!inParallel || s - W(entered) < EXC_HOLD) return { kind: "exception", detail: { state: exc } };
      }
      const err = errTimes.find((x) => x <= t && s - W(x) < ERR_SHOW);
      if (err !== undefined) return { kind: "exception", detail: { state: leaves[0], error: true } };
      const burst = myTr.find((x) => x.at <= t && s - W(x.at) < BURST);
      if (burst) return { kind: "working", detail: { state: leaves[0], event: burst.event } };
      const w = waits.find(([t0, t1]) => t >= t0 && t < t1);
      if (w) return { kind: "waiting", detail: { state: leaves[0], with: w[2] } };
      const inv = invokes.find(([t0, t1]) => t >= t0 && t < t1);
      if (inv) return { kind: "working", detail: { state: leaves[0], with: inv[2] } };
      const kid = kids.find((k) => sim.alive(k, t));
      if (kid) return { kind: "working", detail: { state: leaves[0], with: kid, child: true } };
      const tm = timers.find(([t0, t1]) => t >= t0 && t < t1);
      if (tm) return { kind: "waiting", detail: { state: leaves[0], with: "timer" } };
      return { kind: "idle", detail: { state: leaves[0] } };
    };
    // candidate change times
    const times = new Set([0]);
    for (const [b, e] of sim.lifetimes(a.id)) { times.add(b); if (e !== Infinity) times.add(e); }
    const add = (x) => { if (Number.isFinite(x)) times.add(x); };
    for (const x of myTr) { add(x.at); add(U(W(x.at) + BURST)); add(U(W(x.at) + EXC_HOLD)); }
    for (const x of errTimes) add(U(W(x) + ERR_SHOW));
    for (const [t0, t1] of waits) { add(t0); add(t1); }
    for (const [t0, t1] of invokes) { add(t0); add(t1); }
    for (const [d0] of doneEnds) add(d0);
    for (const [t0, t1] of timers) { add(t0); add(t1); }
    for (const k of kids) for (const [b, e] of sim.lifetimes(k)) { add(b); add(e); }
    for (const m of mine) add(m.at);
    const ts = [...times].filter((x) => x >= 0).sort((p, q) => p - q);
    const segs = [];
    for (const t of ts) {
      const c = classify(t + 1e-6);
      const last = segs[segs.length - 1];
      if (last && last.kind === c.kind && (last.detail?.with ?? null) === (c.detail?.with ?? null)) { last.detail = c.detail; continue; }
      if (last) last.to = t;
      segs.push({ kind: c.kind, from: t, to: Infinity, detail: c.detail });
    }
    out.set(a.id, segs);
  }
  return out;
}
