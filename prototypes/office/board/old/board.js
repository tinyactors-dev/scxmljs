// board/board.js: the telemetry board of "The Office", for ANY system of statecharts.
//
// One 2D canvas that WORLD maps onto a wall screen: the recorded run as a trace. Nothing here
// knows a system by name: rows, span names, colours and behaviours all come from the trace.
//   rows      one per long-lived actor, grouped by chart; short-lived actors of one chart collapse
//             into a swarm lane (how many alive, and doing what) that expands into packed tracks;
//             invoked children sit in a sub-row under their parent; externals that talk both ways
//             get a slim row; a system of ONE actor becomes that actor's state timeline, one lane
//             per parallel region.
//   spans     what someone is doing, by situation kind (sim.situations when the sim has it, else
//             our own derivation from active states): working (solid), waiting (hatched),
//             exception (red), done (grey). Named by the most specific active state.
//   marks     messages (fan-outs bundled, high-volume chatter faint), births and ends, mass deaths
//             and the rebirth after them as one vertical event across all rows, axis breaks over
//             long idle gaps.
//   behaviours  trace.stories when present; else episodes derived from causality (each uncaused
//             stimulus and what it led to), or from time bursts when the trace has no links.
//   what-ifs  reels only when trace.worlds exist.
// Everything is drawn in a 1600 x 900 design space and scaled to the canvas.

const DW = 1600, DH = 900;
const PAD = 24;
const CHIP_Y = 14, CHIP_H = 84;
const HEAD_Y = 104, HEAD_H = 46;
const BAND_Y = 152, BAND_H = 48;
const LANE_Y = 204;
const AXIS_H = 38;
const TAB_Y = 806, TAB_H = 80;
const LABEL_X = PAD - 6, LABEL_W = 232;
const TL_X0 = PAD + LABEL_W + 10, TL_X1 = DW - PAD;

const C = {
  bg: "#0b0f14", rowA: "#121821", rowB: "#0f141b", grid: "#1f2833", text: "#f4efe2", dim: "#7d8794",
  world: "#ff4fd8", play: "#ffffff", chainBack: "#fff2c2", chainFwd: "#57e8ff", select: "#ffe14d",
  birth: "#7dff9a", death: "#ff5a48",
};
// one palette for every system: the situation kind
const KIND = {
  working: { color: "#2ee6b0", hatch: false, rank: 3 },
  waiting: { color: "#ffb000", hatch: true, rank: 2 },
  exception: { color: "#ff5a48", hatch: false, rank: 4 },
  done: { color: "#8d9bb0", hatch: true, rank: 1 },
  idle: { color: "#3a4756", hatch: false, rank: 0 },
};
const KIND_ORDER = ["exception", "working", "waiting", "done", "idle"]; // bottom-up in a swarm band
const STORY_COLORS = ["#4fc3ff", "#2ee6b0", "#ffe14d", "#ff9f40", "#ff6248", "#a99bff", "#8dff6b", "#ff8fd0"];
const EXC_STATE = /fail|error|offline|backoff|reject|timeout|abort|cancel|crash|dead|declin|^left$|^killed$/i;
const EXC_EVENT = /(^|\.)(error|fail|failed|timeout|cancel|offline|crash|rejected|declined|abort|kill)(\.|$)/i;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const font = (px, w = 800) => `${w} ${px}px ${FONT}`;
const human = (s) => String(s || "").replace(/^__/, "").replace(/[-_.:/]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim().toUpperCase();
const shortLabel = (s) => human(String(s || "").replace(/\s*\(.*$/, "").replace(/:.*$/, "").replace(/^the\s+/i, ""));

// ---------------------------------------------------------------- reading a take (base run or a what-if)
function deriveTake(S, label) {
  const evs = S.eventsBetween(-Infinity, Infinity);
  const byId = new Map(evs.map((e) => [e.id, e]));
  const actors = new Map(S.actors.map((a) => [a.id, a]));
  const charts = S.trace.charts || {};
  const parentOf = (e) => (e.type === "message" ? e.via || e.cause : e.cause || null);
  const children = new Map();
  for (const e of evs) { const p = parentOf(e); if (p && byId.has(p)) { if (!children.has(p)) children.set(p, []); children.get(p).push(e); } }
  const msgs = evs.filter((e) => e.type === "message");
  const trs = evs.filter((e) => e.type === "transition");
  const end = S.duration;

  // lifetimes (an actor may come back under the same id)
  const lives = new Map();
  for (const a of S.actors) if (!a.external) {
    let l = S.lifetimes ? S.lifetimes(a.id) : null;
    if (!l || !l.length) l = [[a.bornAt ?? 0, a.diedAt ?? Infinity]];
    lives.set(a.id, l.map(([b, d]) => [b, d === Infinity || d == null ? Infinity : d]));
  }
  // how each life ended: done | cancelled | disposed (the tracer's end.reason), by the end's time
  const endReason = new Map(); for (const e of evs) if (e.type === "end" && e.reason) endReason.set(`${e.actor}@${Math.round(e.at)}`, e.reason);
  const reasonOf = (id, d) => endReason.get(`${id}@${Math.round(d)}`) || null;
  // timers an actor set itself: pending from the set until due, its cancel, or its end
  const timers = new Map();
  { const byT = new Map(); for (const e of evs) if (e.type === "timer") { if (e.action === "set") { const r = { a0: e.at, a1: e.due != null ? e.due : e.at + (e.delay || 0), id: e.id }; byT.set(e.id, r); (timers.get(e.actor) || timers.set(e.actor, []).get(e.actor)).push(r); } else if (e.action === "cancel" && byT.has(e.timer)) { const r = byT.get(e.timer); r.a1 = Math.min(r.a1, e.at); } } }
  const endOf = (id) => { const l = lives.get(id); const d = l ? l[l.length - 1][1] : Infinity; return d === Infinity ? end : d; };
  const bornOf = (id) => { const l = lives.get(id); return l ? l[0][0] : 0; };

  // chatter: an event name that is a large share of all traffic is background (a log, a sync feed)
  const nameCount = new Map(); for (const m of msgs) nameCount.set(m.name, (nameCount.get(m.name) || 0) + 1);
  // ...and fire-and-forget: it almost never makes its receiver change state
  const caused = new Map(); for (const e of evs) if (e.type === "transition" && e.cause) { const c = byId.get(e.cause); if (c && c.type === "message") caused.set(c.name, (caused.get(c.name) || 0) + 1); }
  const chatter = new Set([...nameCount].filter(([k, n]) => n >= 20 && n >= 0.12 * msgs.length && (caused.get(k) || 0) < 0.1 * n).map(([k]) => k));
  const isFaint = (m) => chatter.has(m.name);

  // per chart: what each state means, from the chart and the run (fallback classifier)
  const info = new Map();
  const chartInfo = (name) => {
    if (info.has(name)) return info.get(name);
    const ch = charts[name]; const I = { parent: new Map(), kids: new Map(), kind: new Map(), node: new Map(), exc: new Set(), finals: new Set(), invokes: new Set(), cls: new Map(), regions: [] };
    if (ch && ch.root) {
      const walk = (n, p) => { I.node.set(n.id, n); I.parent.set(n.id, p); I.kind.set(n.id, n.kind); I.kids.set(n.id, (n.children || []).map((c) => c.id)); if (n.kind === "final") I.finals.add(n.id); if (n.invokes && n.invokes.length) I.invokes.add(n.id); if (EXC_STATE.test(n.id)) I.exc.add(n.id); (n.children || []).forEach((c) => walk(c, n.id)); };
      walk(ch.root, null);
      // states every entering transition reaches by an exceptional event
      const inb = new Map(); const walkT = (n) => { for (const tr of n.transitions || []) for (const tg of tr.targets || []) (inb.get(tg) || inb.set(tg, []).get(tg)).push(tr); (n.children || []).forEach(walkT); }; walkT(ch.root);
      for (const [id, ins] of inb) if (ins.length && ins.every((t) => t.event && EXC_EVENT.test(t.event)) && I.kind.get(id) !== "final") I.exc.add(id);
      // regions: children of every parallel state (leaf-most first), else the top compound
      const regs = []; const findPar = (n) => { if (n.kind === "parallel") for (const c of n.children || []) { if (c.kind === "parallel") findPar(c); else regs.push(c.id); if (c.kind !== "parallel") (c.children || []).forEach(findPar); } else (n.children || []).forEach(findPar); };
      findPar(ch.root);
      I.regions = regs.length ? regs : [ch.root.id];
    }
    // the run: dwell per leaf, and how leaving it happened (by someone else's message, or by itself)
    const dwell = new Map(), byOther = new Map(), bySelf = new Map(), byTimer = new Map(), sentOnEntry = new Map();
    const timerish = (c, id) => c && c.type === "message" && (c.from === id && c.to === id || /timer|clock/i.test(String((actors.get(c.from) || {}).kind || c.from)));
    for (const a of S.actors) if (a.chart === name) {
      const cf = evs.filter((e) => e.type === "config" && e.actor === a.id);
      for (let i = 0; i < cf.length; i++) {
        const t1 = i + 1 < cf.length ? cf[i + 1].at : endOf(a.id);
        const act = new Set(cf[i].active);
        for (const s of act) if (!(I.kids.get(s) || []).some((k) => act.has(k))) dwell.set(s, (dwell.get(s) || 0) + Math.max(0, t1 - cf[i].at));
      }
      for (const tr of trs) if (tr.actor === a.id) {
        const c = byId.get(tr.cause);
        const timed = timerish(c, a.id) || (c && c.type === "timer");
        const other = !timed && c && c.type === "message" && c.from !== a.id;
        const M = timed ? byTimer : other ? byOther : bySelf;
        for (const s of tr.from || []) M.set(s, (M.get(s) || 0) + 1);
        const sent = (children.get(tr.id) || []).some((m) => m.type === "message" && m.from === a.id && m.to !== a.id && !isFaint(m));
        if (sent) for (const s of tr.to || []) sentOnEntry.set(s, (sentOnEntry.get(s) || 0) + 1);
      }
    }
    // the resting state of each region: where the chart spends most of its time
    const regionOf = (id) => { let x = id; while (x != null) { const p = I.parent.get(x); if (p == null || I.kind.get(p) === "parallel" || p === (charts[name] && charts[name].root.id)) return x; x = p; } return id; };
    const restBy = new Map();
    for (const [s, d] of dwell) { const r = regionOf(s); const tot = restBy.get(r) || { best: null, d: -1, sum: 0 }; tot.sum += d; if (d > tot.d) { tot.best = s; tot.d = d; } restBy.set(r, tot); }
    for (const id of I.node.keys()) {
      let k;
      if (I.finals.has(id)) k = "done";
      else if (I.exc.has(id)) k = "exception";
      else if (I.invokes.has(id)) k = "waiting";
      else {
        // rest = it waits there for someone else (left by others' messages, or never left); work = it leaves by itself
        const r = restBy.get(regionOf(id)); const share = r && r.sum ? (dwell.get(id) || 0) / r.sum : 0;
        const other = byOther.get(id) || 0, self = bySelf.get(id) || 0;
        const timer = byTimer.get(id) || 0;
        if (/^(idle|ready|rest|home)$/i.test(id)) k = "idle";
        else if (timer > self && timer >= other) k = "waiting"; // a timer runs out: waiting for time
        else if (self > other) k = "working";
        else if (other > 0 && (sentOnEntry.get(id) || 0) > 0 && !(r && r.best === id && share >= 0.5)) k = "waiting";
        else if (other > 0 || (r && r.best === id) || share >= 0.35) k = "idle";
        else k = "working";
      }
      I.cls.set(id, k);
    }
    info.set(name, I); return I;
  };
  const leavesOf = (I, active) => { const act = new Set(active); return active.filter((s) => !(I.kids.get(s) || []).some((k) => act.has(k))); };

  // spans of an actor: [{kind, name, a0, a1}] including idle
  const segCache = new Map();
  function segsOf(id) {
    if (segCache.has(id)) return segCache.get(id);
    const a = actors.get(id); let out = [];
    if (!a || a.external) { segCache.set(id, out); return out; }
    const I = chartInfo(a.chart);
    const cf = evs.filter((e) => e.type === "config" && e.actor === id);
    const leafAt = (t) => { let c = null; for (const e of cf) { if (e.at > t + 1e-9) break; c = e; } return c ? leavesOf(I, c.active) : []; };
    const best = (leaves, want) => {
      let pick = null, pr = -1;
      for (const s of leaves) { const k = I.cls.get(s) || "working"; const r = k === want ? 10 : KIND[k].rank; if (r > pr) { pr = r; pick = s; } }
      return pick;
    };
    const myTr = trs.filter((x) => x.actor === id);
    const entered = (at, leaves) => { let last = null; for (const x of myTr) { if (x.at > at + 1e-6) break; last = x; } if (!last) return null; return leaves.find((l) => (last.to || []).includes(l)) || null; };
    if (typeof S.situations === "function") {
      for (const s of S.situations(id)) {
        if (s.kind === "absent") continue;
        const a1 = Math.min(s.to === Infinity ? endOf(id) : s.to, endOf(id));
        let kind = s.kind; const leaves = leafAt(s.from + 1e-6);
        let st = s.detail && s.detail.state;
        // a long stretch of internal work is work, not rest: the classifier only sees bursts
        // when every active leaf is somewhere it works or waits by itself, it is not resting
        if (kind === "idle" && leaves.length && leaves.every((x) => I.cls.get(x) !== "idle" && !I.invokes.has(x))) { const w = leaves.find((x) => I.cls.get(x) === "working") || leaves[0]; kind = I.cls.get(w) || "working"; st = w; }
        if (kind === "waiting" || kind === "working") st = entered(s.from, leaves) || best(leaves, kind) || st;
        out.push({ kind, a0: s.from, a1, state: st, with: s.detail && s.detail.with });
      }
    } else {
      for (let i = 0; i < cf.length; i++) {
        const a0 = cf[i].at, a1 = i + 1 < cf.length ? cf[i + 1].at : endOf(id);
        const leaves = leavesOf(I, cf[i].active); if (!leaves.length) continue;
        const st = best(leaves); const kind = I.cls.get(st) || "working";
        out.push({ kind, a0, a1, state: st });
      }
    }
    // merge neighbours with the same kind and state; drop empty
    const m = [];
    for (const s of out) { if (s.a1 <= s.a0) continue; const l = m[m.length - 1]; if (l && l.kind === s.kind && l.state === s.state && Math.abs(l.a1 - s.a0) < 1e-6) l.a1 = s.a1; else m.push({ ...s, actor: id, take: label }); }
    // a timer it set itself and is waiting for: idle stretches under it are waiting, until the timer is due
    const tl = (timers.get(id) || []).map((r) => [r.a0, Math.min(r.a1, endOf(id))]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
    let res = m;
    if (tl.length) {
      res = [];
      for (const sg of m) {
        if (sg.kind !== "idle") { res.push(sg); continue; }
        let cur = sg.a0;
        for (const [a, b] of tl) {
          if (b <= cur || a >= sg.a1) continue;
          if (a > cur) res.push({ ...sg, a0: cur, a1: a });
          const e1 = Math.min(b, sg.a1); res.push({ ...sg, kind: "waiting", a0: Math.max(a, cur), a1: e1, timer: true }); cur = e1;
        }
        if (cur < sg.a1) res.push({ ...sg, a0: cur, a1: sg.a1 });
      }
      const mm = []; for (const x of res) { const l = mm[mm.length - 1]; if (l && l.kind === x.kind && l.state === x.state && Math.abs(l.a1 - x.a0) < 1e-6) l.a1 = x.a1; else mm.push(x); } res = mm;
    }
    segCache.set(id, res); return res;
  }
  // a region's states over time (single-actor timeline)
  function regionSegs(id, region) {
    const a = actors.get(id); const I = chartInfo(a.chart);
    const under = (s) => { let x = s; while (x != null) { if (x === region) return true; x = I.parent.get(x); } return false; };
    // the main lane: the deepest active state that is not inside a parallel state (a parallel state stands for its regions)
    const mainOf = (active) => { const act = new Set(active); let best = null, bd = -1; for (const s of act) { let d = 0, x = I.parent.get(s), ok = true; while (x != null) { if (I.kind.get(x) === "parallel") { ok = false; break; } d++; x = I.parent.get(x); } if (ok && d > bd && s !== "__root__") { best = s; bd = d; } } return best; };
    const cf = evs.filter((e) => e.type === "config" && e.actor === id); const out = [];
    for (let i = 0; i < cf.length; i++) {
      const a0 = cf[i].at, a1 = i + 1 < cf.length ? cf[i + 1].at : endOf(id);
      const leaves = region === "__main__" ? [mainOf(cf[i].active)].filter(Boolean) : leavesOf(I, cf[i].active).filter(under); if (!leaves.length) continue;
      const st = leaves[0]; const l = out[out.length - 1];
      if (l && l.state === st && Math.abs(l.a1 - a0) < 1e-6) l.a1 = a1; else out.push({ kind: I.cls.get(st) || "working", a0, a1, state: st, actor: id, take: label, region });
    }
    return out.filter((s) => s.a1 > s.a0);
  }

  // messages, bundled: one sender, one name, one instant
  const bundles = []; const bundleOf = new Map(); const keyed = new Map();
  for (const m of msgs) {
    const key = `${m.t}|${m.from}|${m.name}|${m.depth}`;
    let b = keyed.get(key);
    if (!b) { b = { key, id: m.id, ids: [], at: m.at, t: m.t, from: m.from, to: [], name: m.name, faint: isFaint(m), take: label }; keyed.set(key, b); bundles.push(b); }
    b.ids.push(m.id); if (!b.to.includes(m.to)) b.to.push(m.to); bundleOf.set(m.id, b);
  }
  return { S, label, evs, byId, children, parentOf, msgs, trs, actors, lives, endOf, bornOf, reasonOf, hasReasons: endReason.size > 0, segsOf, regionSegs, chartInfo, bundles, bundleOf, isFaint, duration: S.duration, stories: S.trace.stories || [] };
}

// ---------------------------------------------------------------- the board
export function createBoard({ sim, width = DW, height = DH, rows, baseUrl, createSim, now } = {}) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  const stat = document.createElement("canvas"); stat.width = width; stat.height = height;
  const sctx = stat.getContext("2d");
  const sx = width / DW, sy = height / DH;
  const clock = now || (() => performance.now());
  const sysName = sim.trace.system || "llm-chat";
  const dataBase = baseUrl ? new URL(baseUrl, document.baseURI) : new URL(`../data/${sysName}/`, import.meta.url);

  const base = deriveTake(sim, "base");
  const worldRefs = sim.trace.worlds || [];
  const HAS_WORLDS = worldRefs.length > 0;
  const LANE_B = HAS_WORLDS ? 766 : 848;
  const AXIS_Y = LANE_B;

  // ---------------------------------------------------------- choosing rows
  const nonFaintBy = new Map(); // id -> count of non-faint messages it sends or receives
  for (const m of base.msgs) if (!base.isFaint(m)) for (const x of [m.from, m.to]) nonFaintBy.set(x, (nonFaintBy.get(x) || 0) + 1);
  const people = sim.actors.filter((a) => !a.external);
  const active = people.filter((a) => (nonFaintBy.get(a.id) || 0) > 0 || base.trs.some((t) => t.actor === a.id));
  const life = (a) => base.endOf(a.id) - base.bornOf(a.id);
  const dur = Math.max(1, sim.duration);
  // invoked children: a parent whose chart invokes the child's chart
  const isInvokedChild = (a) => {
    if (!a.parent) return false; const p = base.actors.get(a.parent); if (!p || p.external) return false;
    const pc = (sim.trace.charts || {})[p.chart]; const cc = (sim.trace.charts || {})[a.chart] || {};
    let hit = false; const src = String(cc.source || a.chart).replace(/^.*\//, "");
    const walk = (n) => { for (const iv of n.invokes || []) { const s = String(iv.src || "").replace(/^.*\//, ""); if (s && (s === src || s.replace(/\.scxml$/, "") === a.chart)) hit = true; if (iv.id && a.id.endsWith(iv.id)) hit = true; } (n.children || []).forEach(walk); };
    if (pc && pc.root) walk(pc.root);
    return hit;
  };
  const kidsOf = new Map();
  for (const a of active) {
    if (!isInvokedChild(a) || !active.some((p) => p.id === a.parent)) continue;
    if (!kidsOf.has(a.parent)) kidsOf.set(a.parent, []);
    kidsOf.get(a.parent).push(a);
  }
  const isKid = (a) => kidsOf.has(a.parent) && kidsOf.get(a.parent).includes(a);

  function pack(list) { // interval packing of lifetimes into tracks
    const tracks = [];
    for (const a of list.slice().sort((p, q) => base.bornOf(p.id) - base.bornOf(q.id))) {
      const b = base.bornOf(a.id); let tr = tracks.find((t) => t.end <= b - 1e-6);
      if (!tr) { tr = { end: -Infinity, ids: [] }; tracks.push(tr); }
      tr.ids.push(a.id); tr.end = base.endOf(a.id);
    }
    return tracks.map((t) => t.ids);
  }

  let lanes = []; const expanded = new Set();
  // group by chart kind: charts made from one source file are one kind
  const kindOf = (a) => { const c = (sim.trace.charts || {})[a.chart]; return c && c.source ? String(c.source).replace(/^.*\//, "").replace(/\.scxml$/, "") : a.chart; };
  const groups = new Map();
  for (const a of active) { if (isKid(a)) continue; const k = kindOf(a); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
  const SINGLE = active.length === 1;
  function buildLaneList() {
    const out = [];
    if (SINGLE) {
      const a = active.find((x) => !isKid(x)); const I = base.chartInfo(a.chart);
      // how much of its life a parallel state is active: regions get lanes when it is a lasting structure
      const rootId = (sim.trace.charts[a.chart] || {}).root?.id;
      const hasPar = I.regions.length && I.regions[0] !== rootId;
      let parT = 0; const cfs = base.evs.filter((e) => e.type === "config" && e.actor === a.id);
      cfs.forEach((e, i) => { if (e.active.some((x) => I.kind.get(x) === "parallel")) parT += (i + 1 < cfs.length ? cfs[i + 1].at : base.endOf(a.id)) - e.at; });
      const frac = parT / Math.max(1, base.endOf(a.id) - base.bornOf(a.id));
      if (!hasPar || frac < 0.9) out.push({ key: "region:__main__", type: "region", actor: a.id, region: "__main__", label: human(a.label || a.id), actors: [a.id], weight: 1 });
      if (hasPar && frac >= 0.25) for (const r of I.regions) out.push({ key: `region:${r}`, type: "region", actor: a.id, region: r, label: human(r), sub: human(a.label || a.id), actors: [a.id], weight: 1 });
    } else {
      const traffic = (ids) => ids.reduce((s, id) => s + (nonFaintBy.get(id) || 0), 0);
      const order = [...groups.entries()].map(([chart, list]) => ({ chart, list, first: Math.min(...list.map((a) => base.bornOf(a.id))), traffic: traffic(list.map((a) => a.id)) }));
      order.sort((p, q) => p.first - q.first || q.traffic - p.traffic);
      // the hub group (most traffic per member) goes in the middle
      const hub = order.slice().sort((p, q) => q.traffic / q.list.length - p.traffic / p.list.length)[0];
      const rest = order.filter((g) => g !== hub); const mid = Math.floor(rest.length / 2);
      const seq = hub ? [...rest.slice(0, mid), hub, ...rest.slice(mid)] : rest;
      const pref = rows ? new Map(rows.map((id, i) => [id, i])) : null;
      // many kinds of actors: keep at most ~10 individual rows
      const indiv = seq.reduce((s, g) => s + g.list.length, 0); const crowded = indiv > 10;
      for (const g of seq) {
        // one logical actor that comes back under a new id (same chart kind, same name, lives apart) keeps one row
        const merged = []; const byName = new Map();
        for (const a of g.list.slice().sort((p, q) => base.bornOf(p.id) - base.bornOf(q.id))) {
          const nm = String(a.identity || a.label || a.id).toLowerCase(); const m = byName.get(nm);
          if (m && base.endOf(m.ids[m.ids.length - 1]) <= base.bornOf(a.id) + 1e-6) m.ids.push(a.id);
          else { const r = { a, ids: [a.id] }; byName.set(nm, r); merged.push(r); }
        }
        // within the group, frequent talkers sit next to each other (a greedy chain from the busiest)
        if (merged.length > 2) {
          const talk = (p, q) => { let n = 0; for (const m of base.msgs) if (!base.isFaint(m) && ((p.ids.includes(m.from) && q.ids.includes(m.to)) || (q.ids.includes(m.from) && p.ids.includes(m.to)))) n++; return n; };
          const vol = (r) => r.ids.reduce((s2, id) => s2 + (nonFaintBy.get(id) || 0), 0);
          const left = merged.slice(); const chain = [left.splice(left.indexOf(left.reduce((a, b) => (vol(b) > vol(a) ? b : a))), 1)[0]];
          while (left.length) { const last = chain[chain.length - 1]; let bi = 0, bv = -1; left.forEach((r, i) => { const v = talk(last, r) * 1000 - base.bornOf(r.ids[0]) / 1e6; if (v > bv) { bv = v; bi = i; } }); chain.push(left.splice(bi, 1)[0]); }
          merged.splice(0, merged.length, ...chain);
        }
        const lifeOf = (r) => r.ids.reduce((s, id) => s + base.endOf(id) - base.bornOf(id), 0);
        const short = merged.filter((r) => lifeOf(r) < 0.35 * dur);
        const swarmIt = merged.length > 12 || (merged.length >= 4 && short.length >= 0.6 * merged.length) || (merged.length >= 3 && crowded && short.length >= 0.6 * merged.length);
        let owners = swarmIt ? merged.filter((r) => lifeOf(r) >= 0.6 * dur) : merged;
        if (owners.length > 6 && swarmIt) owners = [];
        const swarm = swarmIt ? merged.filter((r) => !owners.includes(r)) : [];
        if (pref) owners.sort((p, q) => (pref.get(p.a.id) ?? 1e9) - (pref.get(q.a.id) ?? 1e9));
        for (const r of owners) {
          const a = r.a;
          out.push({ key: `actor:${a.id}`, type: "actor", actor: a.id, actors: r.ids, label: human(r.ids.length > 1 ? String(a.label || a.id).replace(/\s*\(.*$/, "") : a.label || a.id), sub: r.ids.length > 1 ? `×${r.ids.length}` : null, weight: 1 });
          const kids = r.ids.flatMap((id) => kidsOf.get(id) || []);
          // children of one kind that come and go share packed tracks; distinct long-lived children get a sub-row each
          const kinds2 = new Map(); for (const k of kids) { const kk = kindOf(k); if (!kinds2.has(kk)) kinds2.set(kk, []); kinds2.get(kk).push(k); }
          for (const [kk, list] of kinds2) {
            const shortN = list.filter((k) => life(k) < 0.5 * dur).length;
            if (list.length >= 2 && (shortN >= 0.5 * list.length || list.length >= 4)) { const tr = pack(list); out.push({ key: `kids:${a.id}:${kk}`, type: "tracks", parent: a.id, actors: list.map((k) => k.id), tracks: tr, label: human(kk), sub: `×${list.length}`, kid: true, swarm: tr.length > 3, weight: 0 }); }
            else for (const k of list) out.push({ key: `actor:${k.id}`, type: "actor", actor: k.id, actors: [k.id], label: human(String(k.label || k.id).replace(/^.*\//, "")), kid: true, weight: 0.62 });
          }
        }
        if (swarm.length) { const ids = swarm.flatMap((r) => r.ids); out.push({ key: `swarm:${g.chart}`, type: "tracks", chart: g.chart, actors: ids, tracks: pack(ids.map((id) => base.actors.get(id))), label: human(g.chart), sub: `×${ids.length}`, swarm: true, weight: 0 }); }
      }
    }
    // externals that talk both ways get a slim row
    const ext = sim.actors.filter((a) => a.external).map((x) => {
      let snd = 0, rcv = 0; for (const m of base.msgs) { if (base.isFaint(m)) continue; if (m.from === x.id && m.to !== x.id) snd++; if (m.to === x.id) rcv++; }
      return { x, snd, rcv };
    }).filter((e) => e.snd >= 2 && e.rcv >= 1).sort((p, q) => q.snd + q.rcv - p.snd - p.rcv).slice(0, SINGLE ? 5 : 4);
    for (const { x } of ext) out.push({ key: `ext:${x.id}`, type: "ext", actor: x.id, actors: [x.id], label: shortLabel(x.label || x.id), weight: 0.62 });
    return out;
  }
  const laneList = buildLaneList();
  // where each actor is drawn
  const laneOfActor = new Map();
  for (const L of laneList) for (const id of L.actors) if (!laneOfActor.has(id)) laneOfActor.set(id, L);

  // a lane where nothing happens (no work, hardly a message) gets half the height
  const quietCache = new Map();
  function quiet(L) {
    if (quietCache.has(L.key)) return quietCache.get(L.key);
    let busy = 0, life = 0, msgsN = 0;
    for (const id of L.actors) { if (!base.lives.has(id)) continue; for (const sg of base.segsOf(id)) if (sg.kind !== "idle") busy += sg.a1 - sg.a0; life += base.endOf(id) - base.bornOf(id); msgsN += nonFaintBy.get(id) || 0; }
    const q = L.type !== "ext" && L.type !== "region" && life > 0 && busy / life < 0.02 && msgsN < 3 * L.actors.length;
    quietCache.set(L.key, q); return q;
  }
  // geometry: weights -> px
  let laneTop = new Map(), laneH = new Map();
  function layout() {
    const w = (L) => {
      const q = quiet(L) ? 0.5 : 1;
      if (L.type === "tracks") { const open = !L.swarm || expanded.has(L.key); return q * (open ? Math.max(0.55, L.tracks.length * (L.kid ? 0.34 : 0.3)) : 1.1); }
      return L.weight * (L.type === "actor" ? q : 1);
    };
    const total = laneList.reduce((s, L) => s + w(L), 0) || 1;
    const unit = Math.min(SINGLE ? 210 : 150, (LANE_B - LANE_Y) / total);
    let y = LANE_Y; laneTop = new Map(); laneH = new Map();
    for (const L of laneList) { const h = w(L) * unit; laneTop.set(L.key, y); laneH.set(L.key, h); y += h; }
    lanes = laneList;
  }
  layout();
  const lanesBottom = () => { const L = lanes[lanes.length - 1]; return L ? laneTop.get(L.key) + laneH.get(L.key) : LANE_Y; };
  const isOpen = (L) => L.type === "tracks" && (!L.swarm || expanded.has(L.key));
  function yOf(id, e) { // the y where actor/external id is drawn (e: the event, for region lanes)
    const L = laneOfActor.get(id); if (!L) return null;
    if (SINGLE && L.type === "region") {
      const rl = regionLaneOf(e); return rl ? laneTop.get(rl.key) + laneH.get(rl.key) / 2 : laneTop.get(L.key) + laneH.get(L.key) / 2;
    }
    if (isOpen(L)) { const i = L.tracks.findIndex((t) => t.includes(id)); const th = laneH.get(L.key) / L.tracks.length; return laneTop.get(L.key) + th * (i + 0.5); }
    return laneTop.get(L.key) + laneH.get(L.key) / 2;
  }
  // single-actor mode: which region a message or transition belongs to
  const regionLanes = laneList.filter((L) => L.type === "region");
  function regionLaneOf(e) {
    if (!e || !regionLanes.length) return regionLanes[0] || null;
    const a = base.actors.get(regionLanes[0].actor); const I = base.chartInfo(a.chart);
    let tr = e.type === "transition" ? e : null;
    if (!tr && e.type === "message") tr = (e.via && base.byId.get(e.via)) || (base.children.get(e.id) || []).find((x) => x.type === "transition") || null;
    const sts = tr ? [...(tr.to || []), ...(tr.from || [])] : [];
    for (const s of sts) { let x = s; while (x != null) { const L = regionLanes.find((r) => r.region === x); if (L) return L; x = I.parent.get(x); } }
    return regionLanes[0];
  }

  // ---------------------------------------------------------- swarm occupancy
  function occupancy(take, ids) {
    const pts = [];
    for (const id of ids) {
      for (const [b, d] of take.lives.get(id) || []) { pts.push([b, "alive", 1]); pts.push([d === Infinity ? take.duration : d, "alive", -1]); }
      for (const s of take.segsOf(id)) { pts.push([s.a0, s.kind, 1]); pts.push([s.a1, s.kind, -1]); }
    }
    pts.sort((p, q) => p[0] - q[0] || p[2] - q[2]);
    const steps = []; const c = { alive: 0, working: 0, waiting: 0, exception: 0, done: 0, idle: 0 }; let peak = 0;
    for (let i = 0; i < pts.length; i++) {
      c[pts[i][1]] += pts[i][2];
      if (i + 1 < pts.length && pts[i + 1][0] === pts[i][0]) continue;
      peak = Math.max(peak, c.alive); steps.push({ at: pts[i][0], ...c });
    }
    return { steps, peak };
  }
  const occCache = new Map();
  const occOf = (take, L) => { const k = take.label + L.key; if (!occCache.has(k)) { let ids = L.actors; if (take !== base) ids = [...take.actors.values()].filter((a) => !a.external && (L.actors.includes(a.id) || (L.chart && a.chart === L.chart && !laneOfActor.has(a.id)))).map((a) => a.id); occCache.set(k, occupancy(take, ids)); } return occCache.get(k); };

  // ---------------------------------------------------------- births, ends, mass deaths
  function massEvents(take) {
    const ends = [], spawns = [];
    for (const [id, l] of take.lives) for (const [b, d] of l) { spawns.push(b); if (d !== Infinity && d < take.duration - 1) ends.push(d); }
    ends.sort((a, b) => a - b); spawns.sort((a, b) => a - b);
    const win = Math.max(2, take.duration * 0.002);
    const cluster = (arr) => { const out = []; let i = 0; while (i < arr.length) { let j = i; while (j + 1 < arr.length && arr[j + 1] - arr[i] <= win) j++; out.push({ at: arr[i], n: j - i + 1 }); i = j + 1; } return out; };
    const aliveAt = (t) => { let n = 0; for (const l of take.lives.values()) for (const [b, d] of l) if (b < t && d >= t) n++; return n; };
    // a mass death: many end at once, most of them without finishing (no final state), most of those alive
    const endsAt = (at) => { const out = []; for (const [id, l] of take.lives) for (const [, d] of l) if (d !== Infinity && d >= at && d <= at + win) out.push(id); return out; };
    const unfinished = (id) => { const sg = take.segsOf(id); const last = sg[sg.length - 1]; return !last || last.kind !== "done"; };
    let deaths = cluster(ends).map((c) => ({ ...c, ids: endsAt(c.at) }));
    if (take.hasReasons) deaths = deaths.map((c) => ({ ...c, ids: c.ids.filter((id) => take.lives.get(id).some(([, d]) => d >= c.at && d <= c.at + win && take.reasonOf(id, d) === "disposed")) })).map((c) => ({ ...c, n: c.ids.length })).filter((c) => c.n >= 2);
    else deaths = deaths.filter((c) => c.n >= 3 && c.n >= 0.5 * aliveAt(c.at) && c.ids.filter(unfinished).length >= 0.5 * c.n);
    // the rebirth: the same names (identity or label) come back
    const nameOf = (id) => { const a = take.actors.get(id) || {}; return String(a.identity || String(a.label || id).replace(/\s*\(.*$/, "")).trim().toLowerCase(); };
    const births = [];
    for (const d of deaths) {
      const names = new Set(d.ids.map(nameOf));
      const back = []; for (const [id, l] of take.lives) { const a = take.actors.get(id) || {}; if (a.incarnation != null && a.incarnation < 2) continue; for (const [b] of l) if (b > d.at && names.has(nameOf(id))) back.push(b); }
      back.sort((p, q) => p - q);
      const near = back.filter((b) => b <= (back[0] ?? 0) + 0.06 * take.duration);
      if (near.length >= 2) births.push({ at: near[0], n: near.length });
    }
    return { deaths, births };
  }
  const mass = massEvents(base);

  // ---------------------------------------------------------- behaviours: stories, else episodes
  const stories = base.stories || [];
  let behaviours = []; // {id, label, color, kind, ids:Set, a0, a1, steps?, root?, from?}
  let kinds = [];      // chips when episodes are grouped: {key, label, color, items:[behaviour]}
  if (stories.length) {
    behaviours = stories.map((s, i) => {
      const ids = new Set(s.steps.flatMap((x) => x.events));
      for (const id of [...ids]) for (const c of base.children.get(id) || []) if (c.type === "message" && !base.isFaint(c)) ids.add(c.id);
      const ats = [...ids].map((id) => base.byId.get(id)?.at).filter((x) => x != null);
      const a0 = Math.min(...s.steps.map((x) => x.t0), ...ats), a1 = Math.max(...s.steps.map((x) => x.t1), ...ats);
      const generic = s.derived || /^(episode|story|behaviou?r|ep)[-_ ]?\d+$/i.test(s.id);
      const first = s.steps.flatMap((x) => x.events).map((id) => base.byId.get(id)).find((e) => e && e.type === "message");
      const lab = generic && first ? human(first.name) : human(s.id);
      return { id: s.id, label: lab, kind: lab, question: s.question, color: STORY_COLORS[i % STORY_COLORS.length], ids, a0, a1, steps: s.steps };
    });
    kinds = behaviours.map((b) => ({ key: b.id, label: b.label, color: b.color, items: [b] }));
    if (behaviours.length > 7) { // many stories: one chip per kind, ×N
      const by = new Map(); for (const b of behaviours) (by.get(b.label) || by.set(b.label, []).get(b.label)).push(b);
      kinds = [...by.entries()].map(([k, items], i) => ({ key: k, label: k, color: STORY_COLORS[i % STORY_COLORS.length], items }));
      for (const k of kinds) for (const b of k.items) b.color = k.color;
    }
  } else {
    behaviours = deriveEpisodes(base);
    const byKind = new Map(); for (const b of behaviours) (byKind.get(b.kind) || byKind.set(b.kind, []).get(b.kind)).push(b);
    kinds = [...byKind.entries()].sort((p, q) => p[1][0].a0 - q[1][0].a0).map(([k, items], i) => ({ key: k, label: items[0].label, color: STORY_COLORS[i % STORY_COLORS.length], items }));
    for (const k of kinds) for (const b of k.items) b.color = k.color;
    // few episodes: one chip each
    if (behaviours.length <= 7) kinds = behaviours.map((b) => ({ key: b.id, label: b.label, color: b.color, items: [b] }));
  }
  function deriveEpisodes(take) {
    const linked = take.evs.filter((e) => (e.type === "message" || e.type === "transition") && take.parentOf(e) && take.byId.has(take.parentOf(e))).length;
    const total = take.evs.filter((e) => e.type === "message" || e.type === "transition").length || 1;
    const eps = [];
    const labelOf = (e) => e.type === "message" ? human(e.name) : e.type === "spawn" ? `NEW ${human(take.actors.get(e.actor)?.chart || e.actor)}` : human(e.event || e.type);
    if (linked / total >= 0.2) {
      // causality: every uncaused stimulus and its closure
      const firstAt = Math.min(...take.evs.filter((e) => e.type === "spawn").map((e) => e.at), Infinity);
      const roots = take.evs.filter((e) => (e.type === "message" || e.type === "spawn") && !(take.parentOf(e) && take.byId.has(take.parentOf(e))) && !(e.type === "message" && take.isFaint(e)));
      for (const r of roots) {
        const ids = new Set([r.id]); const q = [r]; let n = 0;
        while (q.length && n < 4000) { const e = q.shift(); n++; for (const c of take.children.get(e.id) || []) if (!ids.has(c.id) && !(c.type === "message" && take.isFaint(c))) { ids.add(c.id); q.push(c); } }
        const core = [...ids].map((id) => take.byId.get(id)).filter((e) => e.type === "message" || e.type === "transition");
        if (core.length < 2) continue;
        const ats = core.map((e) => e.at);
        const from = r.type === "message" ? r.from : r.actor;
        const boot = r.type === "spawn" && r.at <= firstAt + 1;
        eps.push({ id: `ep-${r.id}`, kind: boot ? "start" : r.type === "message" ? `${from}|${r.name}` : `spawn|${take.actors.get(r.actor)?.chart}`, label: boot ? "START" : labelOf(r), from, root: r.id, ids, a0: Math.min(r.at, ...ats), a1: Math.max(...ats), size: core.length });
      }
    } else {
      // no links: bursts of activity separated by quiet
      const ev = take.evs.filter((e) => (e.type === "message" && !take.isFaint(e)) || e.type === "transition").sort((p, q) => p.at - q.at);
      const gaps = []; for (let i = 1; i < ev.length; i++) gaps.push(ev[i].at - ev[i - 1].at);
      const med = gaps.slice().sort((p, q) => p - q)[Math.floor(gaps.length / 2)] || 1;
      const cut = Math.max(med * 6, take.duration * 0.004, 50);
      let cur = null;
      for (const e of ev) {
        if (!cur || e.at - cur.a1 > cut) { cur = { first: e, ids: new Set(), a0: e.at, a1: e.at }; eps.push(cur); }
        cur.ids.add(e.id); cur.a1 = e.at;
      }
      for (const c of eps) {
        const r = c.first; const from = r.type === "message" ? r.from : r.actor;
        Object.assign(c, { id: `ep-${r.id}`, kind: r.type === "message" ? `${from}|${r.name}` : `${take.actors.get(r.actor)?.chart}|${r.event}`, label: labelOf(r), from, root: r.id, size: c.ids.size, burst: true });
      }
    }
    const boots = eps.filter((e) => e.kind === "start");
    if (boots.length > 1) { const b0 = boots[0]; for (const b of boots.slice(1)) { for (const id of b.ids) b0.ids.add(id); b0.a0 = Math.min(b0.a0, b.a0); b0.a1 = Math.max(b0.a1, b.a1); b0.size += b.size; } eps.splice(0, eps.length, ...eps.filter((e) => e.kind !== "start" || e === b0)); }
    return eps.filter((e) => e.size >= 2).sort((p, q) => p.a0 - q.a0);
  }

  // ---------------------------------------------------------- state
  let t = 0, world = null, loading = null; const worldCache = new Map();
  let pick = null;          // the picked behaviour
  let kindPage = 0;         // chip paging
  const kindCursor = new Map();
  let msgSel = null, hlLane = null, hover = null;
  let view = null, framed = false, lastUser = -1e9;
  let staticKey = "", lastDrawKey = "";
  const listeners = { seek: [], select: [], world: [] };
  const emit = (ev, payload) => { for (const fn of listeners[ev] || []) try { fn(payload); } catch (err) { console.error(err); } };

  // ---------------------------------------------------------- the time axis
  const axis = () => (world ? world.take.S : sim);
  const axisEnd = () => Math.max(sim.duration, world ? world.take.duration : 0);
  function W(at) { const S = axis(); const d = S.duration; return at <= d ? S.warp(at) : S.warp(d) + (at - d) * 0.0005; }
  function Winv(s) { const S = axis(); const d = S.duration; const sd = S.warp(d); return s <= sd ? S.unwarp(s) : d + (s - sd) / 0.0005; }
  const fullView = () => ({ w0: 0, w1: W(axisEnd()) + 0.6 });
  const V = () => view || fullView();
  const X = (at) => { const v = V(); return TL_X0 + ((W(at) - v.w0) / (v.w1 - v.w0)) * (TL_X1 - TL_X0); };
  const tAtX = (x) => { const v = V(); return Math.max(0, Math.min(axisEnd(), Winv(v.w0 + ((x - TL_X0) / (TL_X1 - TL_X0)) * (v.w1 - v.w0)))); };
  const forkAt = () => (world ? world.ref.forkAt : Infinity);
  const forkX = () => (world ? X(sim.event(world.ref.divergesAtEvent)?.at ?? world.ref.forkAt) : Infinity);
  // long idle gaps: an axis break
  const breaks = (() => {
    const ts = [...new Set(base.evs.filter((e) => e.type !== "snapshot" && e.type !== "data").map((e) => e.at))].sort((a, b) => a - b);
    const out = []; for (let i = 1; i < ts.length; i++) { const g = ts[i] - ts[i - 1]; if (g >= 20000 || (g >= 4000 && g >= 0.2 * dur)) out.push({ a0: ts[i - 1], a1: ts[i], gap: g }); }
    return out;
  })();
  const fmtT = (ms, step = 1) => {
    if (ms < 1000 && step < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) { const s = ms / 1000; return `${step < 1000 ? s.toFixed(1) : step < 10000 ? s.toFixed(s % 1 ? 1 : 0) : Math.round(s)}s`; }
    const m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000); return s ? `${m}m${String(s).padStart(2, "0")}` : `${m}m`;
  };
  const fmtGap = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`);

  // ---------------------------------------------------------- lit sets
  function litOf() {
    if (!pick) return null;
    const rowsLit = new Set(); const bundlesLit = new Set();
    for (const id of pick.ids) {
      const e = base.byId.get(id); if (!e) continue;
      const b = base.bundleOf.get(id);
      if (b && !b.faint) { bundlesLit.add(b); for (const x of [b.from, ...b.to]) { const L = laneOfActor.get(x); if (L) rowsLit.add(L.key); } }
      if (e.actor) { const L = laneOfActor.get(e.actor); if (L) rowsLit.add(SINGLE && e.type === "transition" ? regionLaneOf(e).key : L.key); }
    }
    if (pick.steps) for (const s of pick.steps) { const L = laneOfActor.get(s.actor); if (L) rowsLit.add(L.key); }
    if (SINGLE) for (const L of regionLanes) rowsLit.add(L.key);
    return { ...pick, rowsLit, bundlesLit };
  }
  function chainOf(take, bundle) {
    const back = []; const fwd = []; const seen = new Set(bundle.ids);
    let p = take.parentOf(take.byId.get(bundle.id)); let n = 0;
    while (p && n++ < 40) { const e = take.byId.get(p); if (!e || seen.has(p)) break; seen.add(p); back.push(e); p = take.parentOf(e); }
    let frontier = bundle.ids.map((id) => take.byId.get(id)); let depth = 0;
    while (frontier.length && depth++ < 6 && fwd.length < 60) {
      const next = [];
      for (const e of frontier) for (const c of take.children.get(e.id) || []) {
        if (seen.has(c.id)) continue; seen.add(c.id);
        if (c.type === "message" && take.isFaint(c)) continue;
        if (c.type !== "message" && c.type !== "transition") continue;
        fwd.push(c); next.push(c);
      }
      frontier = next;
    }
    return { back, fwd, ids: [...bundle.ids, ...back.map((e) => e.id), ...fwd.map((e) => e.id)] };
  }

  // ---------------------------------------------------------- drawing helpers
  const patterns = new Map();
  function hatch(g, color, alpha = 1) {
    const key = color + alpha;
    if (!patterns.has(key)) {
      const p = document.createElement("canvas"); p.width = p.height = 16; const q = p.getContext("2d");
      q.fillStyle = color; q.globalAlpha = alpha * 0.28; q.fillRect(0, 0, 16, 16);
      q.globalAlpha = alpha; q.strokeStyle = color; q.lineWidth = 4;
      q.beginPath(); q.moveTo(-4, 20); q.lineTo(20, -4); q.moveTo(-4, 4); q.lineTo(4, -4); q.moveTo(12, 20); q.lineTo(20, 12); q.stroke();
      patterns.set(key, p);
    }
    return g.createPattern(patterns.get(key), "repeat");
  }
  const measures = new Map();
  function fit(g, cands, maxW, px) {
    g.font = font(px);
    for (const c of cands) { const k = px + c; let w = measures.get(k); if (w == null) { w = g.measureText(c).width; measures.set(k, w); } if (w <= maxW) return c; }
    return null;
  }
  function fitSized(g, text, maxW, sizes) {
    for (const px of sizes) if (fit(g, [text], maxW, px)) return [text, px];
    const px = sizes[sizes.length - 1]; let t2 = text; g.font = font(px);
    while (t2.length > 2 && g.measureText(t2 + "…").width > maxW) t2 = t2.slice(0, -1);
    return [t2.length > 2 ? t2 + "…" : "", px];
  }
  const labelCands = (name) => { const w = name.split(" "); const c = [name]; if (w.length > 1) c.push(w[w.length - 1], w[0]); for (let n = Math.min(10, name.length - 1); n >= 3; n -= 2) c.push(name.slice(0, n) + "…"); return c; };
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, Math.max(0, h), Math.min(r, h / 2)) : g.rect(x, y, w, h); }
  function arrowHead(g, x, y, dir, s) { g.beginPath(); g.moveTo(x, y); g.lineTo(x - s * 0.75, y - dir * s); g.lineTo(x + s * 0.75, y - dir * s); g.closePath(); g.fill(); }

  // ---------------------------------------------------------- static layer
  function drawStatic() {
    const g = sctx; g.setTransform(sx, 0, 0, sy, 0, 0);
    g.fillStyle = C.bg; g.fillRect(0, 0, DW, DH);
    const lit = litOf();
    drawChips(g, lit); drawHeader(g, lit); drawBand(g, lit); drawLanes(g, lit); drawAxis(g);
    if (HAS_WORLDS) drawTabs(g);
  }

  // chips: stories, episodes, or kinds of episodes (×N), paged when many
  function chipItems() {
    const n = kinds.length; if (n <= 7) return kinds.map((k, i) => ({ k, i }));
    const per = 6; const pages = Math.ceil(n / per); const p = kindPage % pages;
    return [...kinds.slice(p * per, p * per + per).map((k, j) => ({ k, i: p * per + j })), { more: true, left: n - (p * per + per) > 0 ? n - (p * per + per) : n - per }];
  }
  function chipRects() {
    const items = chipItems(); const n = Math.max(items.length, 1), gap = 12;
    const w = (DW - 2 * PAD - gap * (n - 1)) / n;
    return items.map((it, j) => ({ ...it, x: PAD + j * (w + gap), y: CHIP_Y, w, h: CHIP_H }));
  }
  function drawChips(g, lit) {
    if (!kinds.length) {
      g.font = font(28, 700); g.fillStyle = C.dim; g.textAlign = "left"; g.textBaseline = "middle";
      g.fillText("—", PAD, CHIP_Y + CHIP_H / 2); return;
    }
    for (const r of chipRects()) {
      if (r.more) {
        rrect(g, r.x, r.y, r.w, r.h, 14); g.fillStyle = "#18202a"; g.fill(); g.lineWidth = 3; g.strokeStyle = C.dim; g.stroke();
        g.fillStyle = C.text; g.textAlign = "center"; g.textBaseline = "middle"; g.font = font(30, 800); g.fillText("▸ MORE", r.x + r.w / 2, r.y + r.h / 2 + 2);
        continue;
      }
      const { k, i } = r; const col = k.color; const sel = pick && k.items.includes(pick);
      const hov = hover && hover.type === "chip" && hover.key === k.key;
      rrect(g, r.x, r.y, r.w, r.h, 14); g.fillStyle = sel ? col : "#18202a"; g.fill();
      if (!sel) { g.lineWidth = 4; g.strokeStyle = col; g.stroke(); }
      g.fillStyle = sel ? "#0b0f14" : col; g.beginPath(); g.arc(r.x + 34, r.y + r.h / 2, 20, 0, Math.PI * 2); g.fill();
      g.fillStyle = sel ? col : "#0b0f14"; g.font = font(i + 1 >= 10 ? 20 : 26, 900); g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(i + 1), r.x + 34, r.y + r.h / 2 + 1);
      let count = "";
      if (k.items.length > 1) count = sel ? `${k.items.indexOf(pick) + 1}/${k.items.length}` : `×${k.items.length}`;
      g.font = font(24, 900); const cw = count ? g.measureText(count).width + 10 : 0;
      const avail = r.w - 76 - cw; g.fillStyle = sel ? "#0b0f14" : (lit && !sel ? C.dim : C.text); g.textAlign = "left";
      const one = [34, 30, 26].find((px) => fit(g, [k.label], avail, px));
      const words = k.label.split(" ");
      let two = null;
      if (!one && words.length > 1) for (const px of [28, 24, 21, 18]) { g.font = font(px, 800); for (let cut = 1; cut < words.length; cut++) { const l1 = words.slice(0, cut).join(" "), l2 = words.slice(cut).join(" "); if (g.measureText(l1).width <= avail && g.measureText(l2).width <= avail) { two = { px, l1, l2 }; break; } } if (two) break; }
      if (one) { g.font = font(one, 800); g.fillText(k.label, r.x + 62, r.y + r.h / 2 + 2); }
      else if (two) { g.font = font(two.px, 800); g.fillText(two.l1, r.x + 62, r.y + r.h / 2 - two.px * 0.52); g.fillText(two.l2, r.x + 62, r.y + r.h / 2 + two.px * 0.6); }
      else { const [txt, px] = fitSized(g, k.label, avail, [24, 20]); g.font = font(px, 800); g.fillText(txt, r.x + 62, r.y + r.h / 2 + 2); }
      if (count) { g.font = font(24, 900); g.textAlign = "right"; g.fillStyle = sel ? "#0b0f14" : col; g.fillText(count, r.x + r.w - 12, r.y + r.h / 2 + 2); }
      if (hov && !sel) { rrect(g, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 16); g.lineWidth = 3; g.strokeStyle = C.text; g.stroke(); }
    }
  }
  function drawHeader(g, lit) {
    let text = null, color = C.text;
    if (lit) {
      color = lit.color;
      if (lit.question) text = lit.question;
      else { const fromA = sim.actor ? sim.actor(lit.from) : null; text = `${lit.label.toLowerCase()}${fromA ? ` from ${shortLabel(fromA.label || fromA.id).toLowerCase()}` : ""}  ·  ${lit.size} steps${lit.burst ? "" : ""}`; }
    } else if (msgSel) { const b = msgSel.bundle; text = `${b.name}${b.ids.length > 1 ? `  ×${b.ids.length}` : ""}`; color = C.select; }
    else if (world) { text = world.ref.change; color = C.world; }
    else if (loading) { text = "…"; color = C.world; }
    if (!text) return;
    g.font = font(30, 700); g.textBaseline = "middle"; g.textAlign = "left";
    let s = text; while (g.measureText(s).width > DW - 2 * PAD && s.length > 4) s = s.slice(0, -2);
    if (s !== text) s = s.slice(0, -1) + "…";
    g.fillStyle = color; g.fillText(s, PAD, HEAD_Y + HEAD_H / 2);
  }
  function bracketRects() {
    const lanesB = [[], []]; const out = [];
    behaviours.forEach((b) => {
      let x0 = X(b.a0) - 6, x1 = X(b.a1) + 6; if (x1 - x0 < 16) { const c = (x0 + x1) / 2; x0 = c - 8; x1 = c + 8; }
      if (x1 < TL_X0 - 20 || x0 > TL_X1 + 20) return;
      let lane = lanesB.findIndex((l) => l.every(([p, q]) => x1 < p - 3 || x0 > q + 3)); if (lane < 0) lane = 1;
      lanesB[lane].push([x0, x1]);
      out.push({ b, x0, x1, y: BAND_Y + 2 + lane * 23, h: 20 });
    });
    return out;
  }
  function drawBand(g, lit) {
    g.save(); g.beginPath(); g.rect(TL_X0 - 20, BAND_Y, TL_X1 - TL_X0 + 40, BAND_H); g.clip();
    const num = new Map(); kinds.forEach((k, i) => k.items.forEach((b) => num.set(b, i + 1)));
    for (const r of bracketRects()) {
      const col = r.b.color; const sel = r.b === pick;
      g.globalAlpha = (lit && !sel) || (world && r.x1 > forkX() + 8) ? 0.25 : 1;
      rrect(g, r.x0, r.y, r.x1 - r.x0, r.h, 6); g.fillStyle = sel ? col : col + "55"; g.fill();
      g.lineWidth = 2; g.strokeStyle = col; g.stroke();
      if (r.x1 - r.x0 >= 22) { g.fillStyle = sel ? "#0b0f14" : col; g.font = font(17, 900); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(num.get(r.b) || ""), Math.max(r.x0 + 10, Math.min(r.x1 - 10, (r.x0 + r.x1) / 2)), r.y + r.h / 2 + 1); }
    }
    g.restore(); g.globalAlpha = 1;
  }

  // sibling sub-rows share one type size: the largest at which (nearly) all of them fit
  let kidPxV = 0;
  function kidPx(g) {
    if (kidPxV) return kidPxV;
    const kids = laneList.filter((L) => L.kid); const avail = LABEL_W - 48 - 30 - 40;
    kidPxV = [24, 22, 20, 18].find((px) => kids.filter((L) => fit(g, ["↳ " + L.label], avail, px)).length >= 0.85 * kids.length) || 16;
    return kidPxV;
  }
  function laneLabel(g, L, y, h, isHl, dim) {
    const big = L.type === "ext" ? [28, 24, 20, 17] : L.kid ? [kidPx(g), 16] : [36, 32, 28, 24, 20];
    const indent = L.kid ? 30 : 0;
    const subW = L.sub ? (g.font = font(Math.min(24, big[0] - 4), 900), g.measureText(L.sub).width + 10) : 0;
    const maxH = h - 6;
    const sizes = big.filter((px) => px <= maxH * 0.9); if (!sizes.length) sizes.push(Math.max(10, Math.floor(maxH * 0.8)));
    const avail = LABEL_W - 48 - indent - (L.type === "region" ? 0 : subW);
    const full = (L.kid ? "↳ " : "") + L.label; const bare = full.replace(/\s*\(.*$/, "");
    // shrink, then wrap to two lines, then drop a parenthetical, and only then cut
    const minPx = Math.max(15, sizes[sizes.length - 1]);
    let txt, px, two = null;
    const oneFit = sizes.find((q) => q >= minPx && fit(g, [full], avail, q));
    const bareFit = bare !== full ? sizes.find((q) => q >= minPx && fit(g, [bare], avail, q)) : null;
    if (oneFit) { txt = full; px = oneFit; }
    else if (bareFit && (L.kid || L.type === "ext")) { txt = bare; px = bareFit; }
    else {
      const lineH = (q) => q * 1.05;
      for (const cand of bare !== full ? [full, bare] : [full]) {
        const words = cand.split(" "); if (words.length < 2) continue;
        for (const q of [Math.min(28, sizes[0]), 24, 21, 18, 16]) {
          if (2 * lineH(q) > h - 4) continue; g.font = font(q, 900);
          for (let cut = 1; cut < words.length && !two; cut++) { const l1 = words.slice(0, cut).join(" "), l2 = words.slice(cut).join(" "); if (g.measureText(l1).width <= avail + (L.sub ? subW : 0) && g.measureText(l2).width <= avail) two = { l1, l2, px: q }; }
          if (two) break;
        }
        if (two) break;
      }
      if (!two) [txt, px] = bare !== full && !sizes.some((q) => fit(g, [full], avail, q)) ? fitSized(g, bare, avail, sizes) : fitSized(g, full, avail, sizes);
    }
    g.textAlign = "left"; g.textBaseline = "middle";
    g.fillStyle = isHl ? C.select : dim ? "#4a525c" : L.type === "ext" ? "#b9c2cc" : C.text;
    if (two) {
      g.font = font(two.px, 900); const lh = two.px * 1.05;
      g.fillText(two.l1, LABEL_X + 42 + indent, y + h / 2 - lh / 2 + 1); g.fillText(two.l2, LABEL_X + 42 + indent, y + h / 2 + lh / 2 + 1);
      if (L.sub && L.type !== "region") { const tw = g.measureText(two.l2).width; g.font = font(Math.max(12, two.px - 4), 900); g.fillStyle = C.dim; g.fillText(L.sub, LABEL_X + 42 + indent + tw + 8, y + h / 2 + lh / 2 + 2); }
      if (L.swarm) { g.fillStyle = C.dim; g.font = font(20, 900); g.textAlign = "right"; g.fillText(expanded.has(L.key) ? "▾" : "▸", LABEL_X + LABEL_W - 4, y + h / 2 + 2); }
      return;
    }
    g.font = font(px, 900);
    const ty = L.type === "region" && L.sub && h > 70 ? y + h / 2 + 10 : y + h / 2 + 2;
    g.fillText(txt, LABEL_X + 42 + indent, ty);
    if (L.sub && L.type !== "region") { const tw = g.measureText(txt).width; g.font = font(Math.max(12, Math.min(24, px - 4)), 900); g.fillStyle = C.dim; g.fillText(L.sub, LABEL_X + 42 + indent + tw + 8, y + h / 2 + 3); }
    if (L.type === "region" && L.sub && h > 70) { g.font = font(17, 800); g.fillStyle = C.dim; g.fillText(L.sub, LABEL_X + 42, y + h / 2 - 20); }
    if (L.swarm) { // an expand affordance
      const open = expanded.has(L.key); g.fillStyle = C.dim; g.font = font(20, 900); g.textAlign = "right";
      g.fillText(open ? "▾" : "▸", LABEL_X + LABEL_W - 4, y + h / 2 + 2);
    }
  }

  function drawLanes(g, lit) {
    const fx = forkX(); const fk = forkAt();
    lanes.forEach((L, i) => {
      const y = laneTop.get(L.key), h = laneH.get(L.key);
      g.fillStyle = L.kid ? "#0d1218" : L.type === "ext" ? "#0e1319" : i % 2 ? C.rowB : C.rowA; g.fillRect(0, y, DW, h);
      const isHl = hlLane === L.key || (msgSel && msgSel.lanes.has(L.key));
      const dim = lit && !lit.rowsLit.has(L.key);
      if (isHl) { g.fillStyle = "#ffffff12"; g.fillRect(0, y, DW, h); }
      laneLabel(g, L, y, h, isHl, dim);
      if (hover && hover.type === "lane" && hover.key === L.key) { g.strokeStyle = C.text; g.lineWidth = 3; g.strokeRect(LABEL_X, y + 3, LABEL_W, h - 6); }
      g.strokeStyle = C.grid; g.lineWidth = L.kid ? 1 : 2; g.beginPath(); g.moveTo(L.kid ? TL_X0 - 40 : 0, y); g.lineTo(DW, y); g.stroke();
    });

    g.save(); g.beginPath(); g.rect(TL_X0, LANE_Y, TL_X1 - TL_X0, lanesBottom() - LANE_Y); g.clip();
    if (world && fx < TL_X1) { g.fillStyle = "#ff4fd80d"; g.fillRect(fx, LANE_Y, TL_X1 - fx + 10, lanesBottom() - LANE_Y); }
    // axis breaks: long quiet stretches
    for (const b of breaks) {
      const x0 = X(b.a0), x1 = X(b.a1); if (x1 < TL_X0 || x0 > TL_X1) continue;
      const xm = (x0 + x1) / 2; g.strokeStyle = "#5a6676"; g.lineWidth = 2;
      for (const dx of [-5, 5]) { g.beginPath(); for (let yy = LANE_Y; yy <= lanesBottom(); yy += 16) { const xx = xm + dx + ((yy / 16) % 2 ? 4 : -4); yy === LANE_Y ? g.moveTo(xx, yy) : g.lineTo(xx, yy); } g.stroke(); }
    }
    const labels = [];
    const spanAlpha = (s, L) => {
      if (!lit) return msgSel ? (msgSel.lanes.has(L.key) ? 0.95 : 0.35) : 1;
      if (!lit.rowsLit.has(L.key)) return 0.12;
      return s.a1 >= lit.a0 - 1 && s.a0 <= lit.a1 + 1 ? 1 : 0.22;
    };
    const box = (s, x0, x1, y, h, col, k, alpha, ghost, withLabel) => {
      if (x1 < TL_X0 - 50 || x0 > TL_X1 + 50 || x1 <= x0) return;
      if (ghost) { g.globalAlpha = alpha * 0.65; g.fillStyle = col; rrect(g, x0, y - 8, x1 - x0, Math.min(10, h * 0.25), 3); g.fill(); g.globalAlpha = 1; return; }
      g.globalAlpha = alpha; rrect(g, x0, y, x1 - x0, h, Math.min(6, h / 3));
      g.fillStyle = k.hatch ? hatch(g, col) : col; g.fill();
      if (k.hatch && h > 8) { g.lineWidth = h > 20 ? 3 : 1.5; g.strokeStyle = col; g.stroke(); }
      g.globalAlpha = 1;
      if (withLabel && h >= 20) labels.push({ x0, x1, y, h, col, k, alpha, name: s.name });
    };
    // one actor's spans in a band [y, y+h]
    const drawSegs = (segs, L, y, h, isWorld, xmin = -1e9, opts = {}) => {
      for (const s of segs) {
        if (s.kind === "idle" && !opts.showIdle) continue;
        const k = KIND[s.kind] || KIND.working;
        let x0 = Math.max(X(s.a0), xmin), x1 = Math.max(X(s.a1), X(s.a0) + 2);
        const col = isWorld ? (s.kind === "exception" ? KIND.exception.color : s.kind === "idle" ? "#5a2a55" : C.world) : k.color;
        const a = spanAlpha(s, L) * (s.kind === "idle" ? 0.9 : 1);
        const named = { ...s, name: human(s.state) };
        if (world && !isWorld) {
          if (x0 < fx) box(named, x0, Math.min(x1, fx), y, h, col, k, a, false, opts.labels !== false);
          if (x1 > fx) box(named, Math.max(x0, fx), x1, y + 8, h, col, k, a, true, false);
        } else box(named, x0, x1, y, h, col, k, a, false, opts.labels !== false);
      }
    };
    // birth notch and end cap
    const lifeMarks = (take, id, y, h, isWorld) => {
      for (const [b, d] of take.lives.get(id) || []) {
        if (b > 0.5) { const x = X(b); g.fillStyle = isWorld ? C.world : C.birth; g.beginPath(); g.moveTo(x, y + h / 2 - Math.min(9, h / 2)); g.lineTo(x + Math.min(10, h / 2), y + h / 2); g.lineTo(x, y + h / 2 + Math.min(9, h / 2)); g.closePath(); g.fill(); }
        if (d !== Infinity && d < take.duration - 1) endCap(g, take, id, d, X(d), y + 2, h - 4);
      }
    };
    const absent = (take, idOrIds, y, h, xmin, xmax) => {
      const ids = [].concat(idOrIds); const ls = ids.flatMap((id) => take.lives.get(id) || []).sort((p, q) => p[0] - q[0]);
      const l = ls.length ? ls : null; const id = ids[0]; if (!l) { if (!(take.actors.get(id) || {}).external) { g.fillStyle = hatch(g, take === base ? "#2a323d" : "#3d2440"); g.fillRect(Math.max(xmin, TL_X0), y + 1, xmax - Math.max(xmin, TL_X0), h - 2); } return; }
      let prev = -1;
      const gaps = []; for (const [b, d] of l) { gaps.push([prev, b]); prev = d; } gaps.push([prev, Infinity]);
      for (const [p0, p1] of gaps) {
        let x0 = p0 < 0 ? TL_X0 - 10 : X(p0), x1 = p1 === Infinity ? TL_X1 + 10 : X(p1);
        x0 = Math.max(x0, xmin); x1 = Math.min(x1, xmax); if (x1 - x0 < 1) continue;
        g.fillStyle = hatch(g, take === base ? "#2a323d" : "#3d2440"); g.fillRect(x0, y + 1, x1 - x0, h - 2);
      }
    };

    for (const L of lanes) {
      const y = laneTop.get(L.key), h = laneH.get(L.key);
      if (L.type === "actor" || L.type === "region") {
        const pad = Math.min(12, h * 0.13);
        if (world) { absent(base, L.actors, y, h, -1e9, fx); const wl = L.actors.filter((id) => world.take.actors.has(id)); if (wl.length) absent(world.take, wl, y, h, fx, 1e9); else { g.fillStyle = hatch(g, "#3d2440"); g.fillRect(fx, y + 1, TL_X1 - fx + 10, h - 2); } }
        else absent(base, L.actors, y, h, -1e9, 1e9);
        for (const id of L.type === "region" ? [L.actor] : L.actors) {
          const segs = L.type === "region" ? base.regionSegs(id, L.region) : base.segsOf(id);
          drawSegs(segs, L, y + pad, h - 2 * pad, false, -1e9, { showIdle: L.type === "region" });
          if (world && world.take.actors.has(id)) drawSegs((L.type === "region" ? world.take.regionSegs(id, L.region) : world.take.segsOf(id)).filter((s) => X(s.a1) > fx + 1), L, y + pad, h - 2 * pad, true, fx, { showIdle: L.type === "region" });
          if (L.type === "actor") lifeMarks(base, id, y, h, false);
        }
      } else if (L.type === "ext") {
        // an external is busy from a request until its last answer to that requester
        const pad = Math.min(10, h * 0.16);
        const spans = extSpans(base, L.actor);
        for (const s of spans) box({ name: human(s.name) }, X(s.a0), Math.max(X(s.a1), X(s.a0) + 3), y + pad, h - 2 * pad, KIND.working.color + "cc", KIND.working, lit ? (lit.rowsLit.has(L.key) ? 0.8 : 0.12) : 0.8, false, true);
      } else if (L.type === "tracks") {
        if (isOpen(L)) {
          const th = h / L.tracks.length;
          L.tracks.forEach((ids, ti) => {
            const ty = y + ti * th; const pad = Math.max(1, Math.min(5, th * 0.16));
            if (ti) { g.strokeStyle = "#18202a"; g.lineWidth = 1; g.beginPath(); g.moveTo(TL_X0, ty); g.lineTo(TL_X1, ty); g.stroke(); }
            for (const id of ids) {
              // a thin bar for the whole life, then its spans over it
              for (const [b, d] of base.lives.get(id) || []) { const x0 = X(b), x1 = X(d === Infinity ? base.duration : d); g.globalAlpha = lit && !lit.rowsLit.has(L.key) ? 0.15 : 1; g.fillStyle = "#2a3644"; g.fillRect(x0, ty + pad, Math.max(2, x1 - x0), th - 2 * pad); g.globalAlpha = 1; }
              drawSegs(base.segsOf(id), L, ty + pad, th - 2 * pad, false, -1e9, { labels: th >= 26 });
              if (world && world.take.actors.has(id)) drawSegs(world.take.segsOf(id).filter((s) => X(s.a1) > fx + 1), L, ty + pad, th - 2 * pad, true, fx, { labels: false });
              lifeMarks(base, id, ty, th, false);
              if (hlActor === id) { g.strokeStyle = C.select; g.lineWidth = 3; const [b, d] = (base.lives.get(id) || [[0, base.duration]])[0]; g.strokeRect(X(b) - 2, ty + 1, X(d === Infinity ? base.duration : d) - X(b) + 4, th - 2); }
            }
          });
        } else drawSwarm(g, L, y, h, lit);
      }
    }

    // messages
    const yEnds = (b, take) => {
      const msg0 = take.byId.get(b.id);
      const y0 = yOf(b.from, msg0); const ys = [...new Set(b.to.map((x) => yOf(x, msg0)).filter((v) => v != null))];
      return { y0, ys };
    };
    const isExtLane = (id) => { const L = laneOfActor.get(id); return L && L.type === "ext"; };
    const drawBundle = (b, color, alpha, width, take, full = false) => {
      const x = X(b.at); if (x < TL_X0 - 20 || x > TL_X1 + 20) return;
      const { y0, ys } = yEnds(b, take);
      g.globalAlpha = alpha; g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width;
      // to or from an external's slim row: two short stubs, not a line across every row
      if (!full && !b.faint && y0 != null && ys.length && (isExtLane(b.from) || b.to.every(isExtLane)) && !(isExtLane(b.from) && b.to.every(isExtLane))) {
        const actorY = isExtLane(b.from) ? ys[0] : y0; const extY = isExtLane(b.from) ? y0 : ys[0]; const dir = extY > actorY ? 1 : -1; const out = !isExtLane(b.from);
        g.beginPath(); g.moveTo(x, actorY); g.lineTo(x, actorY + dir * 20); g.stroke();
        if (out) { g.beginPath(); g.arc(x, actorY, width + 1.5, 0, Math.PI * 2); g.fill(); } else arrowHead(g, x, actorY, -dir, 8);
        g.beginPath(); g.moveTo(x, extY - dir * 12); g.lineTo(x, extY); g.stroke();
        g.globalAlpha = 1; return;
      }
      if (b.faint) { for (const yy of [y0, ...ys].filter((v) => v != null)) { g.beginPath(); g.moveTo(x, yy + 10); g.lineTo(x, yy + 20); g.stroke(); } g.globalAlpha = 1; return; }
      const targets = ys.filter((yy) => y0 == null || Math.abs(yy - y0) > 2);
      if (y0 != null && targets.length) {
        const hs = Math.max(9, width * 3);
        const up = targets.filter((yy) => yy < y0), down = targets.filter((yy) => yy > y0);
        for (const grp of [up, down]) {
          if (!grp.length) continue;
          const far = grp.reduce((m, yy) => (Math.abs(yy - y0) > Math.abs(m - y0) ? yy : m)); const dir = far > y0 ? 1 : -1;
          g.beginPath(); g.moveTo(x, y0); g.lineTo(x, far - dir * hs * 0.9); g.stroke();
          for (const yy of grp) arrowHead(g, x, yy, dir, hs);
        }
        g.beginPath(); g.arc(x, y0, width + 3, 0, Math.PI * 2); g.fill();
      } else {
        const yy = y0 != null ? y0 : ys[0]; if (yy == null) { g.globalAlpha = 1; return; }
        const inbound = y0 == null; const len = 22;
        g.beginPath(); g.moveTo(x, inbound ? yy - len - 6 : yy - 4); g.lineTo(x, inbound ? yy - 6 : yy - len); g.stroke();
        if (inbound) arrowHead(g, x, yy - 1, 1, 8); else { g.beginPath(); g.arc(x, yy - len, 3.5, 0, Math.PI * 2); g.fill(); }
      }
      g.globalAlpha = 1;
    };
    const dense = base.bundles.length > 400;
    const msgStyle = (b) => {
      const isWorld = b.take === "world"; const tick = !b.to.some((x) => laneOfActor.has(x)) || !laneOfActor.has(b.from);
      let color = isWorld ? C.world : C.text, alpha = b.faint ? 0.22 : tick ? 0.32 : dense ? 0.45 : 0.8, width = b.faint ? 2 : tick ? 2 : dense ? 2 : 3;
      // into or out of an open swarm of many tracks: thinner, so the tracks stay readable
      const crowd = [b.from, ...b.to].some((x) => { const L = laneOfActor.get(x); return L && L.type === "tracks" && isOpen(L) && L.tracks.length > 6; });
      if (crowd) { alpha *= 0.45; width = Math.min(width, 1.5); }
      if (lit) { if (lit.bundlesLit.has(b)) { color = lit.color; alpha = 1; width = 5; } else alpha *= 0.12; }
      if (msgSel) { if (msgSel.bundle === b) return null; alpha *= 0.3; }
      return [color, alpha, width];
    };
    const all = world ? [...base.bundles.filter((b) => b.at <= fk + 1e-6 && X(b.at) <= fx + 0.5).map((b) => [b, base]), ...world.take.bundles.filter((b) => b.at > fk + 1e-6 && X(b.at) > fx - 0.5).map((b) => [b, world.take])] : base.bundles.map((b) => [b, base]);
    for (const pass of [true, false]) for (const [b, take] of all) if (b.faint === pass) { const st = msgStyle(b); if (st) drawBundle(b, ...st, take, !!(lit && lit.bundlesLit.has(b))); }

    // span labels on top of the marks
    for (const Lb of labels) {
      const px = Lb.h >= 40 ? 26 : Lb.h >= 28 ? 20 : 15;
      const txt = fit(g, labelCands(Lb.name), Lb.x1 - Lb.x0 - 12, px); if (!txt) continue;
      g.globalAlpha = Lb.alpha; g.font = font(px, 900); g.textAlign = "left"; g.textBaseline = "middle";
      const tw = g.measureText(txt).width; const tx = Math.max(Lb.x0 + 6, Math.min(TL_X0 + 6, Lb.x1 - 6 - tw)); const cy = Lb.y + Lb.h / 2;
      g.fillStyle = Lb.k.hatch ? "#0b0f14e6" : Lb.col; rrect(g, tx - 5, cy - px * 0.66, tw + 10, px * 1.32, 5); g.fill();
      g.fillStyle = Lb.k.hatch ? Lb.col : Lb.col === KIND.idle.color ? C.text : "#0b0f14"; g.fillText(txt, tx, cy + 1);
      g.globalAlpha = 1;
    }
    if (hover && hover.type === "msg") drawBundle(hover.bundle, C.select, 1, 5, hover.bundle.take === "world" ? world.take : base, true);

    // mass deaths and the rebirths after them
    for (const d of mass.deaths) {
      const x = X(d.at); if (x < TL_X0 - 10 || x > TL_X1 + 10) continue;
      g.fillStyle = C.death; g.globalAlpha = 0.9; g.fillRect(x - 5, LANE_Y, 10, lanesBottom() - LANE_Y); g.globalAlpha = 1;
      tag(g, x, `✕ ${d.n}`, C.death, "left");
    }
    for (const b of mass.births) {
      const x = X(b.at); if (x < TL_X0 - 10 || x > TL_X1 + 10) continue;
      g.fillStyle = C.birth; g.globalAlpha = 0.75; g.fillRect(x - 3, LANE_Y, 6, lanesBottom() - LANE_Y); g.globalAlpha = 1;
      tag(g, x, `↻ ${b.n}`, C.birth, "right");
    }
    if (lit && lit.steps) drawSteps(g, lit.steps, lit.color);
    else if (lit) drawChain(g, { take: base, bundle: base.bundleOf.get(lit.root) || null, root: base.byId.get(lit.root), chain: { back: [], fwd: [...lit.ids].map((id) => base.byId.get(id)).filter((e) => e && (e.type === "message" || e.type === "transition") && e.id !== lit.root) }, color: lit.color });
    if (msgSel) drawChain(g, msgSel);
    g.restore();

    if (world && fx >= TL_X0 && fx <= TL_X1) {
      g.strokeStyle = C.world; g.lineWidth = 4; g.setLineDash([14, 10]);
      g.beginPath(); g.moveTo(fx, LANE_Y); g.lineTo(fx, lanesBottom()); g.stroke(); g.setLineDash([]);
      g.fillStyle = C.world; g.beginPath(); g.moveTo(fx, LANE_Y + 20); g.lineTo(fx - 14, LANE_Y); g.lineTo(fx + 14, LANE_Y); g.closePath(); g.fill();
    }
    if (world) { const ex = X(world.take.duration); if (ex > fx && ex < TL_X1) { g.fillStyle = C.world; g.fillRect(ex - 4, LANE_Y, 8, lanesBottom() - LANE_Y); g.fillStyle = hatch(g, "#3d2440"); g.fillRect(ex + 4, LANE_Y, TL_X1 - ex - 4, lanesBottom() - LANE_Y); } }
  }
  // an end: done = a grey bar, cancelled = an amber bar with a slash, disposed (killed) = a red ✕
  function endCap(g, take, id, d, x, y, h) {
    const segs = take.segsOf(id); const last = segs[segs.length - 1];
    const reason = take.reasonOf(id, d) || (last && last.kind === "done" ? "done" : null);
    const failed = last && (last.kind === "exception" || EXC_STATE.test(last.state || ""));
    if (reason === "disposed") {
      const r = Math.min(9, h / 2); g.strokeStyle = C.death; g.lineWidth = 4; g.lineCap = "round";
      g.beginPath(); g.moveTo(x - r, y + h / 2 - r); g.lineTo(x + r, y + h / 2 + r); g.moveTo(x + r, y + h / 2 - r); g.lineTo(x - r, y + h / 2 + r); g.stroke();
      g.fillStyle = C.death; g.fillRect(x - 1.5, y, 3, h);
    } else if (reason === "cancelled") {
      g.fillStyle = "#ffb000"; g.fillRect(x - 2, y, 4, h); g.strokeStyle = "#ffb000"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x - 7, y + h / 2 + 7); g.lineTo(x + 7, y + h / 2 - 7); g.stroke();
    } else { g.fillStyle = failed ? C.death : reason === "done" ? "#c9d3df" : "#ff9a8a"; g.fillRect(x - 2, y, 4, h); }
  }
  function tag(g, x, text, color, side) {
    g.font = font(22, 900); const w = g.measureText(text).width + 18;
    const tx = Math.max(TL_X0, Math.min(TL_X1 - w, side === "left" ? x - w - 8 : x + 8)); const ty = LANE_Y + 4;
    rrect(g, tx, ty, w, 28, 8); g.fillStyle = color; g.fill();
    g.fillStyle = "#0b0f14"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, tx + w / 2, ty + 15);
  }
  const extCache = new Map();
  function extSpans(take, id) {
    const k = take.label + id; if (extCache.has(k)) return extCache.get(k);
    const ms = take.msgs.filter((m) => !take.isFaint(m) && (m.to === id || m.from === id));
    const out = [];
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i]; if (m.to !== id || m.from === id) continue;
      let last = null;
      for (let j = i + 1; j < ms.length; j++) { const x = ms[j]; if (x.to === id && x.from === m.from) break; if (x.from === id && x.to === m.from) last = x; }
      if (last && last.at > m.at) { const prev = out[out.length - 1]; if (prev && prev.a1 >= m.at) prev.a1 = Math.max(prev.a1, last.at); else out.push({ a0: m.at, a1: last.at, name: m.name }); }
    }
    extCache.set(k, out); return out;
  }
  function drawSwarm(g, L, y, h, lit) {
    const dim = lit && !lit.rowsLit.has(L.key) ? 0.25 : 1;
    const pad = 8; const H = h - 2 * pad;
    const parts = [[base, -1e9, world ? forkX() : 1e9]]; if (world) parts.push([world.take, forkX(), 1e9]);
    for (const [take, xmin, xmax] of parts) {
      const { steps, peak } = occOf(take, L); const scale = H / Math.max(1, occOf(base, L).peak, peak);
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i]; const n = steps[i + 1]; const a1 = n ? n.at : take.duration;
        let x0 = Math.max(X(s.at), xmin), x1 = Math.min(X(a1), xmax); if (x1 <= x0 || x1 < TL_X0 || x0 > TL_X1) continue;
        let yy = y + pad + H;
        for (const k of KIND_ORDER) {
          const c = s[k]; if (!c) continue; const hh = c * scale;
          const col = take === base ? KIND[k].color : k === "exception" ? KIND.exception.color : k === "idle" ? "#5a2a55" : C.world;
          g.globalAlpha = dim * (k === "idle" ? 0.9 : 1); g.fillStyle = KIND[k].hatch ? hatch(g, col) : col; g.fillRect(x0, yy - hh, x1 - x0 + 0.5, hh); yy -= hh;
        }
      }
      g.globalAlpha = 1;
    }
    // each birth a tick on top, each end a tick at the foot
    g.globalAlpha = dim;
    for (const id of L.actors) for (const [b, d] of base.lives.get(id) || []) {
      if (b > 0.5) { const x = X(b); g.fillStyle = C.birth; g.fillRect(x - 1, y + 1, 2, 7); }
      if (d !== Infinity && d < base.duration - 1) { const segs = base.segsOf(id); const last = segs[segs.length - 1]; const x = X(d); const rs = base.reasonOf(id, d); g.fillStyle = rs === "disposed" || (last && (last.kind === "exception" || EXC_STATE.test(last.state || ""))) ? C.death : rs === "cancelled" ? "#ffb000" : "#c9d3df"; g.fillRect(x - 1, y + h - 8, 2, 7); }
    }
    g.globalAlpha = 1;
    // peak, small, at the right
    const pk = occOf(base, L).peak; g.font = font(16, 800); g.fillStyle = C.dim; g.textAlign = "right"; g.textBaseline = "top"; g.fillText(`≤${pk} at once`, TL_X1 - 6, y + 4);
  }

  function evPoint(take, e) { // where an event is drawn: {x, y0, y1}
    if (!e) return null;
    if (e.type === "message") {
      const y0 = yOf(e.from, e), y1 = yOf(e.to, e); if (y0 == null && y1 == null) return null;
      return { x: X(e.at), y0: y0 ?? y1 - 28, y1: y1 ?? y0 - 28, msg: true };
    }
    const yy = e.actor ? yOf(e.actor, e) : null; if (yy == null) return null;
    return { x: X(e.at), y0: yy, y1: yy };
  }
  function drawSteps(g, steps, color) {
    const R = 17; const pts = [];
    for (const step of steps) {
      const evs = step.events.map((id) => base.byId.get(id)).filter(Boolean);
      const first = evs.find((e) => e.type !== "data" && e.type !== "snapshot") || evs[0];
      const at = first ? first.at : step.t0;
      let yy = yOf(step.actor, first); if (yy == null && first) yy = yOf(first.to, first) ?? yOf(first.actor, first) ?? yOf(first.from, first);
      if (yy == null) yy = laneTop.get(lanes[0].key) + laneH.get(lanes[0].key) / 2;
      const L = lanes.find((l) => yy >= laneTop.get(l.key) && yy < laneTop.get(l.key) + laneH.get(l.key));
      const y = L ? laneTop.get(L.key) + Math.min(R + 2, laneH.get(L.key) / 2) : yy;
      let x = X(at); for (const p of pts) if (Math.abs(p.y - y) < 2 * R + 4 && Math.abs(p.x - x) < 2 * R + 4) x = p.x + 2 * R + 6;
      pts.push({ x, y });
    }
    g.strokeStyle = color; g.lineWidth = 6; g.lineJoin = "round";
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
    pts.forEach((p, i) => {
      g.fillStyle = "#0b0f14"; g.beginPath(); g.arc(p.x, p.y, R + 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = color; g.beginPath(); g.arc(p.x, p.y, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0b0f14"; g.font = font(21, 900); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(i + 1), p.x, p.y + 1);
    });
  }
  function drawChain(g, sel) {
    const { take, chain } = sel; const main = sel.bundle ? sel.bundle.ids.map((id) => take.byId.get(id)) : sel.root ? [sel.root] : [];
    const fwdCol = sel.color || C.chainFwd, backCol = C.chainBack;
    const pos = new Map(); const place = (e) => { if (!pos.has(e.id)) pos.set(e.id, evPoint(take, e)); return pos.get(e.id); };
    const linkTo = (e, color, w) => {
      let p = take.parentOf(e); let pp = null; let n = 0;
      while (p && n++ < 50) { const pe = take.byId.get(p); if (!pe) break; pp = place(pe); if (pp) break; p = take.parentOf(pe); }
      const q = place(e); if (!pp || !q) return;
      g.strokeStyle = color; g.lineWidth = w; g.lineCap = "round";
      g.beginPath(); g.moveTo(pp.x, pp.y1); g.bezierCurveTo((pp.x + q.x) / 2, pp.y1, (pp.x + q.x) / 2, q.y0, q.x, q.y0); g.stroke();
    };
    const drawNode = (e, color, w) => {
      const q = place(e); if (!q) return; g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w;
      if (q.msg && Math.abs(q.y1 - q.y0) > 4) { const dir = q.y1 > q.y0 ? 1 : -1; g.beginPath(); g.moveTo(q.x, q.y0); g.lineTo(q.x, q.y1 - dir * 14); g.stroke(); arrowHead(g, q.x, q.y1, dir, 16); }
      g.beginPath(); g.arc(q.x, q.y0, w * 1.6, 0, Math.PI * 2); g.fill();
    };
    g.save(); g.shadowColor = "#000"; g.shadowBlur = 6;
    for (const e of chain.back) linkTo(e, backCol, 5);
    for (const e of chain.fwd) linkTo(e, fwdCol, 5);
    for (const e of main) linkTo(e, backCol, 5);
    for (const e of chain.back) drawNode(e, backCol, 5);
    for (const e of chain.fwd) drawNode(e, fwdCol, 5);
    g.shadowBlur = 14; g.shadowColor = sel.color || C.select;
    for (const e of main) drawNode(e, sel.color ? C.text : C.select, 8);
    g.restore();
  }

  function drawAxis(g) {
    g.fillStyle = C.bg; g.fillRect(TL_X0 - 30, AXIS_Y, TL_X1 - TL_X0 + 60, AXIS_H);
    g.font = font(18, 700); g.textAlign = "center"; g.textBaseline = "middle"; g.strokeStyle = "#3a4450"; g.lineWidth = 2;
    const v = V(); const t0 = Math.max(0, Winv(v.w0)), t1 = Math.min(axisEnd(), Winv(v.w1));
    const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 1200000, 3600000];
    const step = STEPS.find((s) => (t1 - t0) / s <= 300) || 3600000;
    let last = -1e9;
    for (let ms = Math.ceil(t0 / step) * step; ms <= t1 + 1e-6; ms += step) {
      const x = X(ms); if (x < TL_X0 - 1 || x > TL_X1 + 1) continue;
      if (x - last < 70) { g.beginPath(); g.moveTo(x, AXIS_Y); g.lineTo(x, AXIS_Y + 4); g.stroke(); continue; }
      g.beginPath(); g.moveTo(x, AXIS_Y); g.lineTo(x, AXIS_Y + 8); g.stroke();
      g.fillStyle = C.dim; g.fillText(fmtT(ms, step), x, AXIS_Y + 22); last = x;
    }
    // breaks: how much quiet was folded away
    for (const b of breaks) {
      const xm = (X(b.a0) + X(b.a1)) / 2; if (xm < TL_X0 || xm > TL_X1) continue;
      const txt = `+${fmtGap(b.gap)}`; g.font = font(18, 900); const w = g.measureText(txt).width + 14;
      rrect(g, xm - w / 2, AXIS_Y + 8, w, 26, 6); g.fillStyle = "#2a3340"; g.fill(); g.fillStyle = C.text; g.fillText(txt, xm, AXIS_Y + 22);
    }
  }
  function tabRects() {
    const tabs = [{ id: null, label: "AS RECORDED" }, ...worldRefs.map((w) => ({ id: w.id, label: human(w.id) }))].slice(0, 6);
    const gap = 12, n = tabs.length; const w = (DW - 2 * PAD - gap * (n - 1)) / n;
    return tabs.map((tb, i) => ({ ...tb, x: PAD + i * (w + gap), y: TAB_Y, w, h: TAB_H }));
  }
  let tabPx = 0;
  function drawTabs(g) {
    const rs = tabRects();
    if (!tabPx) tabPx = [32, 30, 28, 26, 24, 22, 20].find((px) => rs.every((r) => fit(g, [r.label], r.w - 66, px))) || 20;
    for (const r of rs) {
      const sel = (world ? world.ref.id : loading) === r.id || (r.id === null && !world && !loading);
      const col = r.id === null ? C.text : C.world;
      rrect(g, r.x, r.y, r.w, r.h, 14); g.fillStyle = sel ? col : "#18202a"; g.fill();
      if (!sel) { g.lineWidth = 4; g.strokeStyle = col; g.stroke(); }
      g.beginPath(); g.arc(r.x + 30, r.y + r.h / 2, 12, 0, Math.PI * 2); g.fillStyle = sel ? "#0b0f14" : col; g.fill();
      g.beginPath(); g.arc(r.x + 30, r.y + r.h / 2, 4, 0, Math.PI * 2); g.fillStyle = sel ? col : "#18202a"; g.fill();
      const [txt, px] = fitSized(g, r.label, r.w - 66, [tabPx, 20, 17]);
      g.font = font(px, 800); g.fillStyle = sel ? "#0b0f14" : C.text; g.textAlign = "left"; g.textBaseline = "middle";
      g.fillText(txt, r.x + 54, r.y + r.h / 2 + 2);
      if (loading != null && loading === r.id) { g.fillStyle = "#0b0f14"; g.textAlign = "right"; g.fillText("…", r.x + r.w - 12, r.y + r.h / 2); }
      if (hover && hover.type === "tab" && hover.id === r.id && !sel) { rrect(g, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 16); g.lineWidth = 3; g.strokeStyle = C.text; g.stroke(); }
    }
  }

  // ---------------------------------------------------------- the moving layer
  function kindNow(L) {
    const take = world && t > forkAt() ? world.take : base;
    const ids = L.type === "region" ? [L.actor] : L.actors;
    let best = null;
    for (const id of ids) {
      const segs = L.type === "region" ? take.regionSegs(id, L.region) : L.type === "ext" ? extSpans(take, id).map((s) => ({ ...s, kind: "working" })) : take.segsOf(id);
      for (const s of segs) if (s.a0 <= t && t < s.a1 && s.kind !== "idle" && (!best || KIND[s.kind].rank > KIND[best].rank)) best = s.kind;
    }
    return best;
  }
  function render() {
    const key = [V().w0.toFixed(4), V().w1.toFixed(4), pick && pick.id, msgSel && msgSel.bundle.key, hlLane, hlActor, world && world.ref.id, loading, hoverKey(), [...expanded].join(","), kindPage].join("|");
    if (key !== staticKey) { drawStatic(); staticKey = key; }
    const px = X(t);
    const lampsNow = lanes.map((L) => kindNow(L) || "").join("/");
    const drawKey = key + "|" + Math.round(px * 2) + "|" + lampsNow;
    if (drawKey === lastDrawKey) return;
    lastDrawKey = drawKey;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(stat, 0, 0); ctx.setTransform(sx, 0, 0, sy, 0, 0);
    const g = ctx; const bottom = lanesBottom();
    const x = Math.max(TL_X0, Math.min(TL_X1, px));
    g.fillStyle = pick || msgSel ? "#0b0f1440" : "#0b0f14a0"; g.fillRect(x, LANE_Y, TL_X1 - x + PAD, bottom - LANE_Y);
    lanes.forEach((L, i) => {
      const k = lampsNow.split("/")[i]; const h = laneH.get(L.key); const cy = laneTop.get(L.key) + h / 2, cx = LABEL_X + 16 + (L.kid ? 12 : 0);
      const r = Math.max(4, Math.min(13, h * 0.2));
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
      if (k) { const col = world && t > forkAt() && k !== "exception" ? C.world : KIND[k].color; g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 18; g.fill(); g.shadowBlur = 0; }
      else { g.fillStyle = "#26303b"; g.fill(); }
    });
    if (px >= TL_X0 - 2 && px <= TL_X1 + 2) {
      g.fillStyle = C.play; g.fillRect(px - 2.5, LANE_Y, 5, bottom - LANE_Y);
      g.beginPath(); g.moveTo(px, LANE_Y + 14); g.lineTo(px - 11, LANE_Y); g.lineTo(px + 11, LANE_Y); g.closePath(); g.fill();
      const label = fmtT(t, t < 1000 ? 1 : 100);
      g.font = font(26, 900); const tw = g.measureText(label).width + 28;
      const hx = Math.max(TL_X0 - 10, Math.min(TL_X1 - tw + 10, px - tw / 2));
      rrect(g, hx, AXIS_Y + 1, tw, 36, 10); g.fillStyle = C.play; g.fill();
      g.fillStyle = "#0b0f14"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, hx + tw / 2, AXIS_Y + 20);
    }
    api.dirty = true;
  }
  let hlActor = null;
  const hoverKey = () => (!hover ? "" : hover.type + ":" + (hover.key ?? hover.id ?? (hover.bundle && hover.bundle.key) ?? ""));

  // ---------------------------------------------------------- hit testing
  function laneAt(y) { for (const L of lanes) { const t0 = laneTop.get(L.key); if (y >= t0 && y < t0 + laneH.get(L.key)) return L; } return null; }
  function hit(p) {
    const { x, y } = p;
    if (y >= CHIP_Y && y <= CHIP_Y + CHIP_H) { for (const r of chipRects()) if (x >= r.x && x <= r.x + r.w) return r.more ? { type: "more" } : { type: "chip", key: r.k.key }; return null; }
    const px = X(t);
    if (y >= AXIS_Y - 10 && y < AXIS_Y + AXIS_H && Math.abs(x - px) < 64 && px >= TL_X0 - 10 && px <= TL_X1 + 10) return { type: "playhead" };
    if (HAS_WORLDS && y >= TAB_Y - 4) { for (const r of tabRects()) if (x >= r.x && x <= r.x + r.w) return { type: "tab", id: r.id }; return null; }
    if (y >= BAND_Y && y < LANE_Y) {
      for (const r of bracketRects()) if (x >= r.x0 - 4 && x <= r.x1 + 4 && y >= r.y - 3 && y <= r.y + r.h + 3) return { type: "bracket", b: r.b };
      return x >= TL_X0 ? { type: "timeline", t: tAtX(x) } : null;
    }
    if (y >= LANE_Y && y < lanesBottom()) {
      const L = laneAt(y); if (!L) return null;
      if (x < TL_X0 - 4) return { type: "lane", key: L.key, lane: L };
      // messages
      let best = null, bd = 16;
      const takes = world ? [[base, (b) => b.at <= forkAt() + 1e-6 && X(b.at) <= forkX() + 0.5], [world.take, (b) => b.at > forkAt() + 1e-6 && X(b.at) > forkX() - 0.5]] : [[base, () => true]];
      for (const [take, keep] of takes) for (const b of take.bundles) {
        if (b.faint || !keep(b)) continue; const bx = X(b.at); const d = Math.abs(bx - x); if (d >= bd) continue;
        const e = take.byId.get(b.id); const ys = [yOf(b.from, e), ...b.to.map((z) => yOf(z, e))].filter((v) => v != null);
        if (!ys.length) continue; const lo = Math.min(...ys) - 24, hi = Math.max(...ys) + 8; if (y < lo || y > hi) continue;
        best = b; bd = d;
      }
      if (best) return { type: "msg", bundle: best };
      const at = tAtX(x);
      if (L.type === "tracks" && isOpen(L)) {
        const th = laneH.get(L.key) / L.tracks.length; const ti = Math.min(L.tracks.length - 1, Math.floor((y - laneTop.get(L.key)) / th));
        const id = L.tracks[ti].find((a) => base.lives.get(a).some(([b, d]) => b - 0.002 * dur <= at && at <= (d === Infinity ? base.duration : d) + 0.002 * dur));
        if (id) return { type: "actor", id, lane: L, t: at };
        return { type: "timeline", t: at };
      }
      if (L.type === "tracks") return { type: "swarm", lane: L, t: at };
      if (L.type === "actor" || L.type === "region") {
        const segs = L.type === "region" ? base.regionSegs(L.actor, L.region) : L.actors.flatMap((id) => base.segsOf(id));
        const s = segs.filter((s) => s.kind !== "idle" || L.type === "region").find((s) => X(s.a0) - 4 <= x && x <= Math.max(X(s.a1), X(s.a0) + 3) + 4);
        if (s) return { type: "span", span: s, lane: L };
      }
      return { type: "timeline", t: at, lane: L };
    }
    if (y >= AXIS_Y && y < AXIS_Y + AXIS_H && x >= TL_X0) return { type: "axis", t: tAtX(x) };
    return null;
  }

  // ---------------------------------------------------------- actions
  function seek(tt) { tt = Math.max(0, Math.min(axisEnd(), tt)); t = tt; emit("seek", { t: tt }); render(); }
  const aliveAt = (id, at) => (base.lives.get(id) || []).some(([b, d]) => b <= at && at < (d === Infinity ? Infinity : d));
  function frame(a0, a1, minPad = 1.2) { const w0 = W(a0), w1 = W(a1); const pad = Math.max(0.12 * (w1 - w0), minPad); view = { w0: Math.max(0, w0 - pad), w1: w1 + pad }; framed = true; }
  const autoOpen = new Set();
  function selectBehaviour(b, { emitEvents = true } = {}) {
    pick = b; msgSel = null; hlLane = null; hlActor = null;
    // an episode inside a collapsed swarm opens it (and closes again when unpicked)
    for (const k of autoOpen) expanded.delete(k); autoOpen.clear();
    if (b) { const ids = new Set(); for (const id of b.ids) { const e = base.byId.get(id); if (!e) continue; for (const a of [e.actor, e.from, ...(e.to ? [e.to] : [])]) if (a) ids.add(a); }
      for (const L of lanes) if (L.swarm && !expanded.has(L.key) && L.actors.some((a) => ids.has(a))) { expanded.add(L.key); autoOpen.add(L.key); } }
    layout();
    if (b) {
      frame(b.a0, b.a1);
      if (emitEvents) {
        const actorIds = new Set(b.steps ? b.steps.map((s) => s.actor) : []); const messageIds = [];
        for (const id of b.ids) { const e = base.byId.get(id); if (!e) continue; if (e.type === "message") { messageIds.push(id); actorIds.add(e.from); if (e.to !== "*") actorIds.add(e.to); } else if (e.actor) actorIds.add(e.actor); }
        emit("select", { actorIds: [...actorIds], messageIds, storyId: b.steps ? b.id : null, episodeId: b.steps ? undefined : b.id });
        seek(b.a0);
      }
    } else {
      if (framed) view = world ? worldView() : null; framed = false;
      if (emitEvents) emit("select", { actorIds: [], messageIds: [], storyId: null });
    }
    render();
  }
  function selectBundle(b, { emitEvents = true } = {}) {
    pick = null;
    const take = b.take === "world" ? world.take : base; const chain = chainOf(take, b);
    const lanesSel = new Set([b.from, ...b.to].map((x) => laneOfActor.get(x)).filter(Boolean).map((L) => L.key));
    msgSel = { bundle: b, take, chain, lanes: lanesSel };
    const ats = [b.at, ...chain.back.map((e) => e.at), ...chain.fwd.map((e) => e.at)];
    frame(Math.min(...ats), Math.max(...ats), 1.5);
    if (emitEvents) emit("select", { actorIds: [...new Set([b.from, ...b.to].filter((a) => a !== "*"))], messageIds: b.ids.slice(), chainIds: chain.ids, storyId: null });
    render();
  }
  function clearSelection(emitEvents = true) {
    const had = pick || msgSel || hlLane || hlActor;
    if (framed) view = world ? worldView() : null;
    pick = null; msgSel = null; hlLane = null; hlActor = null; framed = false;
    if (had && emitEvents) emit("select", { actorIds: [], messageIds: [], storyId: null });
  }
  function loadWorld(id) {
    if (!worldCache.has(id)) {
      const ref = worldRefs.find((w) => w.id === id); if (!ref) return Promise.reject(new Error(`no world ${id}`));
      const url = new URL(`worlds/${id}.json`, dataBase);
      worldCache.set(id, (async () => {
        const trace = await (await fetch(url)).json();
        const mk = createSim || (await import(new URL("../core/sim.js", import.meta.url))).createSim;
        return { ref, take: deriveTake(mk(trace), "world") };
      })());
    }
    return worldCache.get(id);
  }
  async function selectWorld(id, { emitEvents = true } = {}) {
    if (!HAS_WORLDS) return;
    if ((world ? world.ref.id : null) === id && !loading) return;
    if (emitEvents) emit("world", { worldId: id });
    msgSel = null;
    if (id == null) { world = null; loading = null; view = null; framed = false; render(); return; }
    loading = id; render();
    const w = await loadWorld(id); if (loading !== id) return;
    loading = null; world = w;
    if (pick && emitEvents) emit("select", { actorIds: [], messageIds: [], storyId: null });
    pick = null; framed = false; view = worldView(); render();
  }
  function worldView() {
    if (!world) return null;
    const f = W(world.ref.forkAt); const end = W(axisEnd()) + 0.6;
    return { w0: Math.max(0, f - 0.22 * (end - f)), w1: end };
  }
  function zoom(factor, u = 0.5) {
    const v = V(); const full = fullView();
    const f = Math.max(0, Math.min(1, (u * DW - TL_X0) / (TL_X1 - TL_X0)));
    const c = v.w0 + f * (v.w1 - v.w0);
    let span = Math.max(0.4, Math.min(full.w1 - full.w0, (v.w1 - v.w0) / factor));
    let w0 = Math.max(0, Math.min(full.w1 - span, c - f * span));
    view = { w0, w1: w0 + span }; lastUser = clock();
    if (span >= full.w1 - full.w0 - 1e-6) view = null;
    render();
  }
  function pan(dxDesign) {
    const v = V(); const full = fullView(); const span = v.w1 - v.w0;
    const w0 = Math.max(0, Math.min(full.w1 - span, v.w0 - (dxDesign / (TL_X1 - TL_X0)) * span));
    view = { w0, w1: w0 + span }; lastUser = clock(); render();
  }
  function resetView() { view = world ? worldView() : null; framed = false; render(); }
  function toggleExpand(L) { autoOpen.delete(L.key); if (expanded.has(L.key)) expanded.delete(L.key); else expanded.add(L.key); layout(); render(); }

  function tap(h) {
    if (!h) return;
    switch (h.type) {
      case "chip": {
        const k = kinds.find((x) => x.key === h.key); if (!k) break;
        if (k.items.length === 1) { selectBehaviour(pick === k.items[0] ? null : k.items[0]); break; }
        // a kind of episode: each tap shows the next occurrence, after the last one unpicks
        const cur = k.items.indexOf(pick); const nx = cur + 1;
        selectBehaviour(nx < k.items.length ? k.items[nx] : null); break;
      }
      case "more": kindPage++; render(); break;
      case "bracket": selectBehaviour(pick === h.b ? null : h.b); break;
      case "tab": selectWorld(h.id); break;
      case "lane": {
        const L = h.lane; pick = null; msgSel = null; framed = false;
        if (L.swarm) { toggleExpand(L); const ids = L.actors.filter((id) => aliveAt(id, t)); hlLane = expanded.has(L.key) ? null : L.key; emit("select", { actorIds: ids, messageIds: [], storyId: null, laneId: L.key }); render(); break; }
        hlLane = hlLane === L.key ? null : L.key; hlActor = null;
        emit("select", { actorIds: hlLane ? L.actors.slice(0, L.type === "region" ? 1 : L.actors.length) : [], messageIds: [], storyId: null }); render(); break;
      }
      case "swarm": { const L = h.lane; hlLane = L.key; hlActor = null; pick = null; msgSel = null; emit("select", { actorIds: L.actors.filter((id) => aliveAt(id, h.t)), messageIds: [], storyId: null, laneId: L.key }); seek(h.t); break; }
      case "actor": hlActor = h.id; hlLane = null; pick = null; msgSel = null; emit("select", { actorIds: [h.id], messageIds: [], storyId: null }); seek(h.t); break;
      case "msg": if (msgSel && msgSel.bundle === h.bundle) { clearSelection(); render(); } else { selectBundle(h.bundle); seek(h.bundle.t); } break;
      case "span": hlLane = h.lane.key; hlActor = null; pick = null; msgSel = null; emit("select", { actorIds: [h.span.actor], messageIds: [], storyId: null }); seek(h.span.a0); break;
      case "timeline": case "axis": seek(h.t); break;
    }
  }

  let mode = null, downHit = null, downP = null, lastTap = null;
  function pointer(type, u, v, extra) {
    const p = { x: u * DW, y: v * DH };
    if (type === "wheel") { const dy = typeof extra === "number" ? extra : (extra && extra.dy) || 0; const dx = (extra && extra.dx) || 0; if (dy) zoom(Math.exp(-dy * 0.0015), u); if (dx) pan(-dx); return; }
    if (type === "down") { lastUser = clock(); const h = hit(p); if (h && h.type === "playhead") { mode = "scrub"; return; } mode = "press"; downHit = h; downP = p; return; }
    if (type === "move") {
      if (mode === "scrub") { lastUser = clock(); if (p.x >= TL_X0 - 40) seek(tAtX(Math.max(TL_X0, Math.min(TL_X1, p.x)))); return; }
      if (mode === "pan") { pan(p.x - downP.x); downP = p; return; }
      if (mode === "press") {
        if (Math.hypot(p.x - downP.x, p.y - downP.y) > 12) {
          if (downHit && downHit.type === "axis") { mode = "pan"; pan(p.x - downP.x); downP = p; return; }
          if (downHit && ["timeline", "span", "msg", "swarm", "actor"].includes(downHit.type)) { mode = "scrub"; seek(tAtX(Math.max(TL_X0, Math.min(TL_X1, p.x)))); return; }
        }
        return;
      }
      const h = hit(p); const hv = h && ["chip", "tab", "msg", "lane"].includes(h.type) ? h : null;
      const before = hoverKey(); hover = hv; if (hoverKey() !== before) render();
      return;
    }
    if (type === "up") {
      if (mode === "press") {
        const nowT = clock(); const inLanes = downP.y >= BAND_Y && downP.y < lanesBottom() && downP.x >= TL_X0;
        if (inLanes && lastTap && nowT - lastTap.time < 380 && Math.hypot(downP.x - lastTap.p.x, downP.y - lastTap.p.y) < 50) { lastTap = null; clearSelection(); resetView(); }
        else { tap(downHit); lastTap = inLanes ? { time: nowT, p: downP } : null; }
      }
      mode = null; downHit = null; return;
    }
    if (type === "leave") { mode = null; downHit = null; if (hover) { hover = null; render(); } }
  }

  function update(tt) {
    t = Math.max(0, tt);
    if (view && !framed && clock() - lastUser > 2500 && mode == null) {
      const s = W(t); const span = view.w1 - view.w0;
      if (s < view.w0 || s > view.w1) { const full = fullView(); const w0 = Math.max(0, Math.min(full.w1 - span, s - span * 0.1)); view = { w0, w1: w0 + span }; }
    }
    render();
  }
  function highlight({ actorId, messageId } = {}) {
    const L = actorId ? laneOfActor.get(actorId) : null;
    hlLane = L && !(L.type === "tracks" && isOpen(L)) ? L.key : null; hlActor = L && L.type === "tracks" && isOpen(L) ? actorId : null;
    if (messageId) { const b = (world && world.take.bundleOf.get(messageId)) || base.bundleOf.get(messageId); if (b && !b.faint) selectBundle(b, { emitEvents: false }); }
    else if (msgSel) msgSel = null;
    render();
  }

  const api = {
    canvas, dirty: true, update, pointer, highlight,
    on(ev, fn) { (listeners[ev] ||= []).push(fn); return () => { listeners[ev] = listeners[ev].filter((f) => f !== fn); }; },
    zoom, pan, resetView,
    selectStory: (id) => selectBehaviour(id == null ? null : behaviours.find((b) => b.id === id) || null),
    selectEpisode: (i) => selectBehaviour(i == null ? null : behaviours[i] || null),
    selectWorld: (id) => selectWorld(id),
    selectMessage: (id) => { const b = (world && world.take.bundleOf.get(id)) || base.bundleOf.get(id); if (b) selectBundle(b); },
    expand: (key, on = true) => { const L = lanes.find((l) => l.key === key); if (L && L.swarm && expanded.has(key) !== on) toggleExpand(L); },
    loadWorld,
    warp: W, unwarp: Winv,
    get duration() { return axisEnd(); },
    get state() { return { t, storyId: pick && pick.steps ? pick.id : null, episodeId: pick && !pick.steps ? pick.id : null, worldId: world ? world.ref.id : null, messageId: msgSel ? msgSel.bundle.id : null, view: view ? { ...view } : null, expanded: [...expanded] }; },
    get rows() { return lanes.map((L) => L.key); },
    get lanes() { return lanes.map((L) => ({ key: L.key, type: L.type, label: L.label, actors: L.actors.slice(), swarm: !!L.swarm, expanded: expanded.has(L.key) })); },
    get behaviours() { return behaviours.map((b) => ({ id: b.id, label: b.label, a0: b.a0, a1: b.a1, kind: b.kind || null, story: !!b.steps })); },
    get massEvents() { return { deaths: mass.deaths.slice(), births: mass.births.slice() }; },
    locate({ messageId, storyId: sid, episode, worldId, t: tt, actorId, laneId } = {}) {
      let x, y;
      if (messageId) { const b = (world && world.take.bundleOf.get(messageId)) || base.bundleOf.get(messageId); if (!b) return null; const e = base.byId.get(b.id) || null; x = X(b.at); const ys = [yOf(b.from, e), ...b.to.map((z) => yOf(z, e))].filter((v) => v != null); y = (Math.min(...ys) + Math.max(...ys)) / 2; }
      else if (sid !== undefined || episode !== undefined) { const b = sid !== undefined ? behaviours.find((q) => q.id === sid) : behaviours[episode]; const k = kinds.find((q) => q.items.includes(b)); const r = chipRects().find((q) => q.k === k); if (!r) return null; x = r.x + r.w / 2; y = r.y + r.h / 2; }
      else if (worldId !== undefined) { const r = tabRects().find((q) => q.id === worldId); if (!r) return null; x = r.x + r.w / 2; y = r.y + r.h / 2; }
      else if (laneId) { const L = lanes.find((l) => l.key === laneId); if (!L) return null; x = tt !== undefined ? X(tt) : LABEL_X + 90; y = laneTop.get(L.key) + laneH.get(L.key) / 2; }
      else if (tt !== undefined) { x = X(tt); y = actorId ? yOf(actorId) : AXIS_Y + 19; }
      else if (actorId) { x = LABEL_X + 90; y = yOf(actorId); }
      return { u: x / DW, v: y / DH };
    },
    dispose() { for (const k of Object.keys(listeners)) listeners[k] = []; },
  };
  render();
  return api;
}
