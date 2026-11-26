// world/ticker.js: the receipt printer. One plain line per cause and what it caused, printed on a paper
// tape that comes out of a small printer on a post: the latest line at the bottom, large, the two before it
// readable, older ones smaller, scrolled up the tape. The tape is as long as what is printed on it (it feeds
// out as lines are added, up to a length, then the oldest scroll off its top). Built for ANY trace, from its
// cause links and the charts alone:
//
//   a CAUSE is a message from outside the system (an external sender, or none), a message delivered
//   later than the step that sent it (a timer firing), or an arrival nobody caused (boot);
//   its CONSEQUENCES are every event whose cause chain leads to it within the same instant: transitions,
//   values that changed, mail sent on to others, arrivals and departures. Mail delivered later is a cause of
//   its own line. For each person a line says:
//     WHAT CHANGED   the states entered, named in their region (the child of a parallel state) or with the
//                    parent that makes them unambiguous: "engine on, idle", "door closed"
//     WHY            the guard of a taken transition ("engine off if timer >= cookTime"), and the transitions
//                    for that event, or the eventless ones of the new configuration, whose guard is false:
//                    "not cooking: door is open" (In(x) false: x's region is in another state), a comparison
//                    printed as written with its values ("not checkout: cart.length > 0 (0)")
//     WAITING FOR    the delayed sends it has pending ("time in 1 s") and, while one is, the comparisons that
//                    time will settle ("timer 0/5")
//
//   "YOU: TURN ON  →  engine on, idle · not cooking: door is open"
//   "YOU: CLOSE DOOR  →  door closed → engine cooking · timer 0/5 · time in 1 s"
//   "YOU: CLOSE DOOR  →  refused: door is closed"           (a refused press: main.js tells us)
//
// Guards are judged with the values the trace recorded (snapshots, data) and the configuration at that
// moment; a guard that reads _event or does not evaluate is not judged (nothing is said about it).
// A line is shown once the playhead reaches its cause; its consequences appear as the room plays them
// (so it is a function of the playhead, film- and replay-safe). Live: causes already run by the engine
// but not yet played are shown at once, waiting ("…"), so a press made while the room plays is seen.
// Selecting a line (pick) gives the people and mail involved, for the world to highlight.
//
// Owns: the lines, the tape's texture, the printer's mesh. Must never know: a system, a chart's meaning, the modes.
import * as THREE from "three";
import { mat, PLATES } from "./kit.js";

const TW = 1024, TH = 1180; // canvas px; the tape is TAPE_W wide and at most TAPE_H tall (metres)
export const TAPE_W = 0.78, TAPE_H = 0.9;
const MIN_H = 0.34; // the shortest tape (metres): a printer with one line on it
// font px (of TW across TAPE_W): the latest line, the two before it, the rest
const BIG = 76, MID = 50, SMALL = 34, PAD = 24, FONT = "'DejaVu Sans Mono', 'Menlo', monospace";

const fmtMs = (ms) => (ms == null ? "" : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${+(ms / 1000).toFixed(1)} s` : `${+(ms / 60000).toFixed(1)} min`);
const fmtV = (v) => (typeof v === "number" ? String(Number.isInteger(v) ? v : +v.toFixed(2)) : v === undefined ? "?" : typeof v === "string" ? JSON.stringify(v.length > 14 ? v.slice(0, 13) + "…" : v) : Array.isArray(v) ? `[${v.length}]` : v && typeof v === "object" ? "{…}" : String(v));
const evMatch = (desc, name) => !!desc && !!name && String(desc).split(/\s+/).some((d) => d === "*" || d === name || (d.endsWith(".*") ? name.startsWith(d.slice(0, -1)) : name.startsWith(d + ".")));
// a guard as a person reads it: In('x') is x
const showCond = (c) => String(c).replace(/\s+/g, " ").replace(/\bIn\(\s*['"]([^'"]+)['"]\s*\)/g, "$1").trim();

// ---- a chart's shape: parents, regions, what is entered where ----
function chartIndex(chart) {
  const byId = new Map(), parent = new Map();
  const walk = (n, p) => { byId.set(n.id, n); parent.set(n.id, p); for (const c of n.children || []) walk(c, n); };
  if (chart && chart.root) walk(chart.root, null);
  const isTop = (n) => !n || n.id === "__root__" || !parent.get(n.id);
  // the region of a state: the nearest of it and its ancestors whose parent is a parallel state
  const regionOf = (id) => { for (let n = byId.get(id); n; n = parent.get(n.id)) { const p = parent.get(n.id); if (p && p.kind === "parallel") return n; } return null; };
  const depth = (id) => { let d = 0; for (let n = byId.get(id); n && parent.get(n.id); n = parent.get(n.id)) d++; return d; };
  return { byId, parent, regionOf, depth, isTop, kids: (n) => (n && n.children) || [] };
}

// ---- guards, judged from what the trace recorded ----
const fnCache = new Map();
function judge(cond, vals, active) {
  if (!cond || /_event/.test(cond)) return undefined;
  const names = Object.keys(vals || {}).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== "In");
  const key = names.join(",") + "|" + cond;
  let f = fnCache.get(key);
  if (f === undefined) { try { f = new Function(...names, "In", `"use strict"; return (${cond});`); } catch { f = null; } fnCache.set(key, f); }
  if (!f) return undefined;
  try { return !!f(...names.map((k) => vals[k]), (x) => active.has(x)); } catch { return undefined; }
}
function valueOf(expr, vals) {
  const e = String(expr).trim(); if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
  if (/^['"].*['"]$/.test(e)) return e.slice(1, -1);
  const names = Object.keys(vals || {}).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== "In");
  try { return new Function(...names, `"use strict"; return (${e});`)(...names.map((k) => vals[k])); } catch { return undefined; }
}
const CMP = /^([^<>=!&|?]+?)\s*(>=|<=|>|<|===|!==|==|!=)\s*([^<>=!&|?]+)$/;
// why a guard is false, in a few words: "door is open", "cart.length > 0 (0)", "timer 0/5"
function whyFalse(cond, vals, active, ix) {
  const c = String(cond).replace(/\s+/g, " ").trim();
  let m = c.match(/^(!)?\s*In\(\s*['"]([^'"]+)['"]\s*\)$/);
  if (m) {
    const x = ix.byId.get(m[2]); const p = x && ix.parent.get(x.id);
    if (!m[1]) { const now = p && ix.kids(p).find((k) => active.has(k.id)); return now && !ix.isTop(p) ? `${p.id} is ${now.id}` : `not in ${m[2]}`; }
    return p && !ix.isTop(p) ? `${p.id} is ${m[2]}` : `in ${m[2]}`;
  }
  m = c.match(CMP);
  if (m) {
    const L = valueOf(m[1], vals), R = valueOf(m[3], vals); const lhs = m[1].trim(), rhs = m[3].trim();
    if (typeof L === "number" && typeof R === "number" && /[<>]/.test(m[2])) return /^-?\d/.test(rhs) ? `${showCond(c)} (${fmtV(L)})` : `${lhs} ${fmtV(L)}/${fmtV(R)}`;
    if (L !== undefined) return `${showCond(c)} (${lhs} ${fmtV(L)})`;
  }
  return `${showCond(c)} is false`;
}
// the progress of a comparison time will settle: "timer 0/5"
function progress(cond, vals) {
  const m = String(cond).replace(/\s+/g, " ").trim().match(CMP); if (!m || !/[<>]/.test(m[2])) return null;
  const L = valueOf(m[1], vals), R = valueOf(m[3], vals); if (typeof L !== "number" || typeof R !== "number") return null;
  return { text: `${m[1].trim()} ${fmtV(L)}/${fmtV(R)}`, vars: [m[1].trim(), m[3].trim()] };
}

/** The lines of a trace: [{key, s, show, cause, parts: [{who, items: [{s, text, steps?}]}], actors: Set, messages: Set}] sorted by s. */
export function linesOf(sim, { nameOf = (id) => id, youLabel = () => null } = {}) {
  const all = sim.eventsBetween(-1, Number.MAX_SAFE_INTEGER);
  const byId = new Map(all.map((e) => [e.id, e]));
  const kids = new Map(); for (const e of all) if (e.cause) (kids.get(e.cause) || kids.set(e.cause, []).get(e.cause)).push(e);
  const ext = (id) => !!sim.actor(id)?.external;
  const W = (e) => sim.warp(e.at ?? e.t);
  const people = sim.actors.filter((a) => !a.external);
  const single = people.length <= 1; // one person in the room: the line need not name them
  const ixCache = new Map(); const ixOf = (actor) => { const ch = sim.chartOf ? sim.chartOf(actor) : null; if (!ixCache.has(ch)) ixCache.set(ch, chartIndex(ch)); return ixCache.get(ch); };
  const timers = all.filter((e) => e.type === "timer");
  const isRoot = (e) => {
    if (e.type === "message") { const c = e.cause && byId.get(e.cause); return !c || (e.from && ext(e.from)) || c.t !== e.t || !!e.timer; }
    return e.type === "spawn" && !e.cause;
  };
  // the entered states of a transition, named where they are: per region (or parent) its chain down to the leaf
  function enteredText(actor, e) {
    const ix = ixOf(actor); const to = (e.to || []).filter((id) => ix.byId.get(id)?.kind !== "history"); const from = e.from || [];
    if (!ix.byId.size) { const f = from[from.length - 1], t = to[to.length - 1]; return t ? (f === t ? `${t} ↺` : t) : f ? `left ${f}` : `reacts to ${e.event || "it"}`; }
    if (!to.length) return from.length ? `left ${from.filter((id) => !(ix.byId.get(id)?.children || []).length).join(", ") || from[0]}` : `reacts to ${e.event || "it"}`;
    const set = new Set(to);
    const leaves = to.filter((id) => !ix.kids(ix.byId.get(id)).some((k) => set.has(k.id))).sort((a, b) => ix.depth(a) - ix.depth(b));
    const out = [];
    for (const L of leaves) {
      const R = ix.regionOf(L);
      const chain = []; for (let n = ix.byId.get(L); n && n !== R && !ix.isTop(n); n = ix.parent.get(n.id)) { if (set.has(n.id)) chain.unshift(n.id); else break; }
      if (!chain.length) chain.push(L);
      // the place: its region; else the parent of the top of the chain when that is not the chart itself
      let ctx = R && !chain.includes(R.id) ? R.id : null;
      if (!ctx) { const p = ix.parent.get(chain[0]); if (p && !ix.isTop(p) && !(R && R.id === chain[0]) && !ix.isTop(ix.parent.get(p.id))) ctx = p.id; }
      const names = chain.length > 3 ? [chain[0], "…", chain[chain.length - 1]] : chain;
      const self = from.includes(L) && leaves.length === 1 && to.length === 1;
      out.push(`${ctx ? ctx + " " : ""}${names.join(", ")}${self ? " ↺" : ""}`);
    }
    return out.join(" & ");
  }
  // the chart transition a trace transition took: deepest source among the states active before, event and targets matching
  function takenOf(actor, e) {
    const ix = ixOf(actor); if (!ix.byId.size) return null;
    const before = new Set(sim.activeAt(actor, (e.at ?? e.t) - 1e-6)); for (const id of e.from || []) before.add(id);
    const to = new Set(e.to || []);
    let best = null, bd = -1;
    for (const id of before) {
      const n = ix.byId.get(id); if (!n) continue;
      for (const tr of n.transitions || []) {
        if (e.event ? !evMatch(tr.event, e.event) : !!tr.event) continue;
        const tg = tr.targets || []; if (tg.length ? !tg.every((x) => to.has(x)) : to.size) continue;
        const d = ix.depth(id); if (d > bd) { bd = d; best = { tr, src: n }; }
      }
    }
    return best;
  }
  const out = [];
  for (const r of all) {
    if (!isRoot(r)) continue;
    // the consequences: BFS over the cause links, within the root's instant (later mail is its own line)
    const seen = [], q = [...(kids.get(r.id) || [])];
    while (q.length) { const e = q.shift(); if (e.type === "message" && (e.t !== r.t || e.timer)) continue; seen.push(e); for (const k of kids.get(e.id) || []) q.push(k); }
    seen.sort((a, b) => (a.at ?? a.t) - (b.at ?? b.t));
    const actors = new Set(), messages = new Set();
    if (r.type === "message") { messages.add(r.id); if (r.to && !ext(r.to)) actors.add(r.to); if (r.from && !ext(r.from)) actors.add(r.from); }
    else if (r.actor) actors.add(r.actor);
    // per actor, in order of first appearance: its steps, then its values, mail, and what decided and what waits
    const sec = new Map(); const order = [];
    const main = r.type === "message" ? (r.to && !ext(r.to) ? r.to : r.from) : r.actor;
    const S = (id) => { if (!sec.has(id)) { sec.set(id, { path: [], bits: [], s: Infinity, last: -Infinity, lastAt: -Infinity, entered: new Set(), dataBits: [] }); order.push(id); } return sec.get(id); };
    const touch = (x, e) => { const s = W(e); x.s = Math.min(x.s, s); x.last = Math.max(x.last, s); x.lastAt = Math.max(x.lastAt, e.at ?? e.t); };
    if (r.type === "spawn") { const x = S(r.actor); x.bits.push({ s: W(r), text: "arrives" }); touch(x, r); }
    for (const e of seen) {
      const s = W(e);
      if (e.type === "transition" && e.actor) {
        actors.add(e.actor); const x = S(e.actor); touch(x, e);
        let text = enteredText(e.actor, e); const plain = text;
        const tk = takenOf(e.actor, e);
        // a guard that decided it, unless it only says what this line just did (In(x) with x entered here)
        if (tk && tk.tr.cond) { const ins = [...String(tk.tr.cond).matchAll(/In\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]); if (!(ins.length && ins.every((id) => x.entered.has(id)) && /^[\s!]*In\(/.test(tk.tr.cond) && !/&&|\|\|/.test(tk.tr.cond))) text += ` if ${showCond(tk.tr.cond)}`; }
        for (const id of e.to || []) x.entered.add(id);
        x.path.push({ s, text, plain });
      } else if (e.type === "data" && e.actor) { actors.add(e.actor); const x = S(e.actor); touch(x, e); x.dataBits.push({ s, key: e.key, text: `${e.key} = ${String(e.summary ?? JSON.stringify(e.value)).replace(/:\s*[\[{].*$/, "")}`.slice(0, 48) }); }
      else if (e.type === "timer" && e.actor && e.action === "cancel") { const x = S(e.actor); touch(x, e); const set = e.timer && byId.get(e.timer); x.bits.push({ s, text: `${(set && timerName(ixOf(e.actor), sim, e.actor, set)) || "timer"} cancelled` }); }
      else if (e.type === "message" && e.from && e.to && e.to !== e.from && e.t === r.t) { messages.add(e.id); if (!ext(e.from)) { const x = S(e.from); touch(x, e); const to = nameOf(e.to); const prev = x.bits.find((b) => b.mailTo === to); if (prev) { prev.names.push(e.name); prev.text = `mail ${prev.names.join(', ')} → ${to}`; } else x.bits.push({ s, text: `mail ${e.name} → ${to}`, mailTo: to, names: [e.name] }); } if (!ext(e.to)) actors.add(e.to); }
      else if (e.type === "spawn" && e.actor) { actors.add(e.actor); const x = S(e.actor); touch(x, e); x.bits.push({ s, text: "arrives" }); }
      else if (e.type === "end" && e.actor) { actors.add(e.actor); const x = S(e.actor); touch(x, e); x.bits.push({ s, text: "leaves" }); }
    }
    // the receiver of the cause: an event it took no transition for, or took with other transitions' guards false
    const recv = r.type === "message" && r.to && !ext(r.to) ? r.to : null;
    if (recv) {
      const ix = ixOf(recv); const at = r.at ?? r.t; const before = new Set(sim.activeAt(recv, at - 1e-6)); const vals = sim.valuesAt(recv, at - 1e-6);
      const tookIt = seen.some((e) => e.type === "transition" && e.actor === recv && e.event === r.name);
      const nots = [];
      if (ix.byId.size && before.size) for (const id of before) for (const tr of ix.byId.get(id)?.transitions || []) {
        if (!tr.cond || !evMatch(tr.event, r.name)) continue;
        const tg = (tr.targets || [])[0]; if (tg && seen.some((e) => e.type === "transition" && e.actor === recv && (e.to || []).includes(tg))) continue;
        if (judge(tr.cond, vals, before) === false) nots.push(`not ${tg || "taken"}: ${whyFalse(tr.cond, vals, before, ix)}`);
      }
      const x = S(recv); x.s = Math.min(x.s, W(r)); x.last = Math.max(x.last, W(r)); x.lastAt = Math.max(x.lastAt, at);
      if (!tookIt && !seen.some((e) => e.type === "transition" && e.actor === recv)) x.bits.unshift({ s: W(r), text: nots.length ? "ignored it" : "ignored it: nothing takes it now" });
      for (const t of nots.slice(0, 2)) x.bits.push({ s: W(r), text: t });
    }
    // after the line: the eventless transitions the new configuration does not take, and what it waits for
    for (const id of order) {
      const x = sec.get(id); const ix = ixOf(id); if (!ix.byId.size || !Number.isFinite(x.lastAt)) continue;
      const at = x.lastAt + 1e-6; const act = new Set(sim.activeAt(id, at)); if (!act.size) continue; const vals = sim.valuesAt(id, at);
      const pending = timers.filter((tm) => tm.actor === id && tm.action === "set" && (tm.at ?? tm.t) <= at && !timers.some((o) => o.timer === tm.id && o.action !== "set" && (o.at ?? o.t) <= at));
      const nots = [], waits = [], shownVars = new Set();
      for (const sid of act) for (const tr of ix.byId.get(sid)?.transitions || []) {
        if (tr.event || !tr.cond) continue; const tg = (tr.targets || [])[0]; if (tg && act.has(tg)) continue;
        if (judge(tr.cond, vals, act) !== false) continue;
        const pr = progress(tr.cond, vals);
        // while a delayed send is pending the person waits for time (and the comparisons it settles); with nothing
        // pending they wait on a condition: say which, and why it is false
        if (pr) { if (pending.length) { waits.push(pr.text); pr.vars.forEach((v) => shownVars.add(v)); } }
        else if (!pending.length) nots.push(`not ${tg || "taken"}: ${whyFalse(tr.cond, vals, act, ix)}`);
      }
      for (const tm of pending) { const name = timerName(ix, sim, id, tm) || "timer"; const due = tm.due != null ? tm.due - (tm.at ?? tm.t) : tm.delay; waits.push(`${name} in ${fmtMs(due ?? tm.delay)}`); }
      if (id === main) { // its values: the last of each, at most three, and how many more changed
        const last = new Map(); for (const d of x.dataBits) if (!shownVars.has(d.key)) { last.delete(d.key); last.set(d.key, d); }
        const ds = [...last.values()]; for (const d of ds.slice(0, 3)) x.bits.push({ s: d.s, text: d.text });
        if (ds.length > 3) x.bits.push({ s: ds[3].s, text: `+${ds.length - 3} more values` });
      }
      for (const t of [...new Set(nots)].slice(0, 2)) x.bits.push({ s: x.last, text: t });
      for (const t of [...new Set(waits)].slice(0, 3)) x.bits.push({ s: x.last, text: t });
    }
    // the person the cause came to is told in full; the others it reached briefly (their states, whom they wrote to)
    const parts = [];
    for (const id of order) {
      const x = sec.get(id); if (!x.path.length && !x.bits.length) continue;
      const items = []; const full = id === main;
      if (x.path.length) { const steps = full ? x.path : x.path.map((y) => ({ s: y.s, text: y.plain })); items.push({ s: steps[0].s, text: steps.map((y) => y.text).join(" → "), steps }); }
      if (full) for (const b of x.bits) items.push(b);
      else { const mail = x.bits.filter((b) => b.mailTo); for (const b of x.bits) if (!b.mailTo) items.push(b); if (mail.length) items.push({ s: Math.min(...mail.map((b) => b.s)), text: `mail → ${[...new Set(mail.map((b) => b.mailTo))].join(", ")}` }); }
      parts.push({ s: Math.min(...items.map((i) => i.s)), who: single ? null : nameOf(id), items });
    }
    let cause;
    const you = r.type === "message" ? youLabel(r) : null;
    if (you) cause = `YOU: ${you}`;
    else if (r.type === "spawn") cause = "START";
    else if (r.timer || (r.cause && byId.get(r.cause) && byId.get(r.cause).t !== r.t)) cause = `TIMER: ${r.name}${r.to && r.to !== r.from && !single ? ` for ${nameOf(r.to)}` : ""}`;
    else cause = `${String(nameOf(r.from || "?")).toUpperCase()}: ${r.name}`;
    // s orders the lines (the cause's own moment); show is when it appears (its mail leaves a moment before)
    out.push({ key: r.id, s: W(r), show: r.type === "message" && sim.flight ? Math.min(W(r), sim.flight(r)[0]) : W(r), cause, parts, actors, messages });
  }
  return out.sort((a, b) => a.s - b.s);
}
// the event a pending delayed send will deliver: the delayed <send> in the onentry of the state its cause entered (or of an active one)
function timerName(ix, sim, actor, tm) {
  const c = tm.cause && sim.event ? sim.event(tm.cause) : null;
  const ids = c && c.type === "transition" ? [...(c.to || [])].reverse() : sim.activeAt(actor, (tm.at ?? tm.t) + 1e-6).slice().reverse();
  const find = (list) => { for (const a of list || []) { if (a.type === "send" && (a.delay || a.delayexpr) && a.event) return a.event; for (const k of ["then", "else", "body"]) { const r = find(a[k]); if (r) return r; } } return null; };
  for (const id of ids) { const n = ix.byId.get(id); const r = n && find(n.onentry); if (r) return r; }
  if (c && c.type === "transition") { const n = ix.byId.get((c.from || [])[0]); for (const tr of n?.transitions || []) { const r = find(tr.actions); if (r) return r; } }
  return null;
}

/** The text of a line at playhead s: what has played so far; "…" while more is to come. */
export function lineText(L, s, { live = false } = {}) {
  if (L.refused) return `${L.cause}  →  refused: ${L.refused}`;
  const done = [], more = L.parts.some((p) => p.items.some((i) => i.s > s + 1e-6));
  for (const p of L.parts) {
    const items = [];
    for (const it of p.items) {
      if (it.steps) { const st = it.steps.filter((x) => x.s <= s + 1e-6); if (st.length) items.push(st.map((x) => x.text).join(" → ")); }
      else if (it.s <= s + 1e-6) items.push(it.text);
    }
    if (items.length) done.push(`${p.who ? p.who + ": " : ""}${items.join(" · ")}`);
  }
  const tail = more || (live && !done.length && L.parts.length) ? " …" : "";
  return `${L.cause}  →  ${done.length ? done.join("  ·  ") : ""}${tail}`.replace(/→ {2}…$/, "→ …").replace(/→ {2}$/, "→ (nothing)");
}

export function buildTicker(scene, { sim, nameOf, youLabel, live = null, at }) {
  const root = new THREE.Group(); root.name = "ticker"; scene.add(root);
  root.position.set(at.x, 0, at.z); root.rotation.y = at.ry || 0;
  // the printer: an iron box on a post, a slot on top, a brass plate
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.95, 0.14), mat("#2a1f1a")); post.position.y = 0.475; post.castShadow = true; root.add(post);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.4), mat("#2a1f1a")); foot.position.y = 0.025; root.add(foot);
  const top = new THREE.Group(); root.add(top); // the printer on its post (raised by setLift)
  const body = new THREE.Mesh(new THREE.BoxGeometry(TAPE_W + 0.14, 0.24, 0.3), mat("#3b3f46")); body.position.y = 1.07; body.castShadow = true; top.add(body);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(TAPE_W + 0.18, 0.04, 0.34), mat("#c9a14a")); lip.position.y = 1.2; top.add(lip);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(TAPE_W + 0.04, 0.02, 0.05), mat("#111")); slot.position.set(0, 1.215, 0.02); top.add(slot);
  const lamp = new THREE.MeshLambertMaterial({ color: "#3a5", emissive: "#3f6", emissiveIntensity: 0 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), lamp); led.position.set(TAPE_W / 2 - 0.02, 1.07, 0.155); top.add(led);
  // the tape: a canvas on a plane rising out of the slot, leaning back a little; only the printed part of the
  // canvas (its bottom) is shown, on a plane as tall as that part
  const c = document.createElement("canvas"); c.width = TW; c.height = TH; const g = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const tapeG = new THREE.Group(); tapeG.position.set(0, 1.22, 0.02); tapeG.rotation.x = -0.08; top.add(tapeG);
  /** a taller post: the printer stands behind something its tape must clear */
  const setLift = (h) => { top.position.y = h; post.scale.y = (0.95 + h) / 0.95; post.position.y = (0.95 + h) / 2; };
  const tape = new THREE.Mesh(new THREE.PlaneGeometry(TAPE_W, 1), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
  tape.userData.ticker = true; tapeG.add(tape);
  let shownPx = TH; // canvas px (from the bottom) the tape shows
  const setLength = (px) => { shownPx = Math.max(Math.round((MIN_H / TAPE_H) * TH), Math.min(TH, px)); const h = (shownPx / TH) * TAPE_H; tape.scale.y = h; tape.position.y = h / 2; tex.repeat.set(1, shownPx / TH); tex.offset.set(0, 0); tape.userData.plate = { text: "ticker", glyph: BIG / shownPx }; };
  setLength(TH);
  PLATES.add(tape); // log: the view sampler counts it (glyph = the latest line's)

  const born = new Map(); // live: line key -> the order it first appeared in
  let lines = [], evN = -1, refusals = [], selected = null, sig = "", rects = [], lastAt = -1;
  function refresh() {
    const n = sim.trace.events.length; if (n === evN) return; if (n < evN) born.clear(); /* started over */ evN = n;
    lines = linesOf(sim, { nameOf, youLabel });
  }
  /** a refused press: shown at once, at playhead s */
  function refuse(cause, reason, s) { refusals.push({ key: `refused-${refusals.length}`, s, cause, refused: reason, parts: [], actors: new Set(), messages: new Set() }); sig = ""; }
  function visible(s) {
    refresh();
    const ahead = live ? Infinity : s + 0.6; // live: the engine has run it, the room has yet to play it
    const xs = lines.filter((L) => (L.show ?? L.s) <= ahead).concat(refusals.filter((L) => L.s <= s + 1e-6 || live));
    // live: in the order the visitor saw them happen (a refusal, then the press after it), whatever their playback seconds
    if (live) { for (const L of xs) if (!born.has(L.key)) born.set(L.key, born.size); return xs.sort((a, b) => born.get(a.key) - born.get(b.key) || a.s - b.s); }
    return xs.sort((a, b) => a.s - b.s || (a.refused ? 1 : 0) - (b.refused ? 1 : 0));
  }
  // words onto rows of the tape's width; a word wider than a row is broken (nothing is ever cut off)
  function wrap(text, px) {
    g.font = `bold ${px}px ${FONT}`; const max = TW - 2 * PAD; const words = text.split(/(\s+)/); const out = []; let cur = "";
    for (let w of words) {
      const t = cur + w;
      if (g.measureText(t).width <= max || !cur.trim()) { cur = t; }
      else { out.push(cur.trimEnd()); cur = w.trimStart(); }
      while (g.measureText(cur).width > max && cur.length > 1) { let k = cur.length - 1; while (k > 1 && g.measureText(cur.slice(0, k)).width > max) k--; out.push(cur.slice(0, k)); cur = cur.slice(k); }
    }
    if (cur.trim()) out.push(cur.trimEnd()); return out;
  }
  function draw(items, s) {
    // lay out from the latest line up: its size by its age; a line that does not fit whole is not printed
    const blocks = []; let used = PAD;
    for (let i = items.length - 1; i >= 0; i--) {
      const L = items[i], age = items.length - 1 - i; let px = age === 0 ? BIG : age <= 2 ? MID : SMALL;
      const text = lineText(L, s, { live: !!live }); let rows = wrap(text, px);
      const hOf = () => rows.length * px * 1.16 + (age === 0 ? 20 : 12) + 10;
      // a long latest line gets a smaller type until it fits whole (never cut); an older one that does not fit is not printed
      if (age === 0) while (used + hOf() > TH - 8 && px > 22) { px -= 4; rows = wrap(text, px); }
      const h = hOf();
      if (used + h > TH - 8) break;
      blocks.push({ L, rows, px, h, age }); used += h;
    }
    setLength(used + 6);
    g.fillStyle = "#f7f2e4"; g.fillRect(0, 0, TW, TH);
    // perforation marks and a faint ruled edge, so it reads as paper
    g.fillStyle = "#e3dac2"; for (let y = TH - 8; y > 0; y -= 36) { g.fillRect(4, y - 14, 6, 14); g.fillRect(TW - 10, y - 14, 6, 14); }
    rects = []; let y = TH - PAD;
    for (const b of blocks) {
      const y0 = y - b.h + 10;
      if (selected === b.L.key) { g.fillStyle = "#ffe46b"; g.fillRect(14, y0 - 2, TW - 28, b.h - 8); }
      g.fillStyle = b.L.refused ? "#b3261e" : b.age === 0 ? "#1b1712" : b.age <= 2 ? "#3a342a" : "#5d5546";
      g.font = `bold ${b.px}px ${FONT}`; g.textBaseline = "top";
      b.rows.forEach((r, k) => g.fillText(r, PAD, y0 + 4 + k * b.px * 1.16));
      rects.push({ key: b.L.key, y0: y0 - 4, y1: y });
      y = y0 - 6; g.fillStyle = "#cfc4a8"; g.fillRect(PAD, y, TW - 2 * PAD, 2); y -= 4;
    }
    tex.needsUpdate = true;
  }
  /** each frame (cheap: redraws only when what it shows changes) */
  function update(s, amb = 0) {
    const items = visible(s);
    const key = `${selected}|${items.length}|` + items.slice(-9).map((L) => lineText(L, s, { live: !!live })).join("|");
    if (key !== sig) { sig = key; draw(items, s); if (items.length && items[items.length - 1].key !== lastKey) { lastKey = items[items.length - 1].key; printedAt = amb; } }
    lamp.emissiveIntensity = amb - printedAt < 0.6 ? 1.2 : 0.05;
    lastAt = s;
  }
  let lastKey = null, printedAt = -9;
  /** a tap on the tape at uv: the line there (toggles), with its people and mail; null for the blank tape */
  function pick(uv) {
    const y = TH - uv.y * shownPx; const r = rects.find((q) => y >= q.y0 && y <= q.y1); if (!r) { selected = null; sig = ""; return null; }
    selected = selected === r.key ? null : r.key; sig = "";
    if (!selected) return { key: null };
    const L = [...lines, ...refusals].find((x) => x.key === r.key);
    return { key: r.key, actors: [...(L?.actors || [])], messages: [...(L?.messages || [])], text: L ? lineText(L, lastAt, { live: !!live }) : "" };
  }
  const latest = (s) => { const xs = visible(s); return xs.length ? lineText(xs[xs.length - 1], s, { live: !!live }) : null; };
  const box = () => new THREE.Box3().setFromObject(root);
  /** the box of the printer with its tape grown by `grow` metres (at most to full length): what a view of it leaves room for */
  const fullBox = (grow = TAPE_H) => { root.updateMatrixWorld(true); const b = box(); const top = tapeG.localToWorld(new THREE.Vector3(0, Math.min(TAPE_H, tape.scale.y + grow), 0)); return b.expandByPoint(top); };
  /** the font size of the lines, as a share of the shown tape's height: [latest, the two before, older] */
  const fontShare = () => [BIG / shownPx, MID / shownPx, SMALL / shownPx];
  return { root, tape, update, pick, refuse, latest, box, fullBox, fontShare, setLift, lines: () => visible(lastAt), clearSelection: () => { selected = null; sig = ""; } };
}
