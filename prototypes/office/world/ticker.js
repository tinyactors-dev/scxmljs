// world/ticker.js: the receipt printer. One plain line per cause and what it caused, printed on a paper
// tape that rises out of a small printer on a post: the latest line at the bottom, large, the older
// ones scrolled up the tape, smaller. Built for ANY trace, from its cause links alone:
//
//   a CAUSE is a message from outside the system (an external sender, or none), a message delivered
//   later than the step that sent it (a timer firing), or an arrival nobody caused (boot);
//   its CONSEQUENCES are every event whose cause chain leads to it within the same instant: transitions
//   (the person's state path), values that changed, timers set or cancelled, mail sent on to others,
//   arrivals and departures. Mail delivered later is a cause of its own line.
//
//   "YOU: TURN ON  →  microwave: off → idle → cooking · timer 1 s started"
//   "YOU: CLOSE DOOR  →  refused: door is closed"           (a refused press: main.js tells us)
//
// A line is shown once the playhead reaches its cause; its consequences appear as the room plays them
// (so it is a function of the playhead, film- and replay-safe). Live: causes already run by the engine
// but not yet played are shown at once, waiting ("…"), so a press made while the room plays is seen.
// Selecting a line (pick) gives the people and mail involved, for the world to highlight.
//
// Owns: the lines, the tape's texture, the printer's mesh. Must never know: a system, a chart, the modes.
import * as THREE from "three";
import { mat, PLATES } from "./kit.js";

const TW = 1024, TH = 1400; // canvas px; the tape is TAPE_W x TAPE_H metres
export const TAPE_W = 0.86, TAPE_H = 1.18;
const BIG = 82, SMALL = 40, PAD = 26, FONT = "'DejaVu Sans Mono', 'Menlo', monospace";

const fmtMs = (ms) => (ms == null ? "" : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${+(ms / 1000).toFixed(1)} s` : `${+(ms / 60000).toFixed(1)} min`);
// the states a list names that are leaves of the person's chart ("off+closed"), or its last id without a chart
function leafNamer(sim) {
  const cache = new Map();
  const atomics = (actor) => { const ch = sim.chartOf ? sim.chartOf(actor) : null; const k = ch ? actor : null; if (cache.has(k)) return cache.get(k); const set = new Set(); const walk = (n) => { if (!n) return; if (!(n.children || []).length) set.add(n.id); for (const c of n.children || []) walk(c); }; if (ch) walk(ch.root || ch); cache.set(k, set.size ? set : null); return cache.get(k); };
  return (actor, ids) => { if (!ids || !ids.length) return null; const at = atomics(actor); const ls = at ? ids.filter((i) => at.has(i)) : []; return ls.length ? ls.join("+") : ids[ids.length - 1]; };
}

/** The lines of a trace: [{key, s, cause, parts: [{s, text}], actors: Set, messages: Set, live}] sorted by s. */
export function linesOf(sim, { nameOf = (id) => id, youLabel = () => null } = {}) {
  const all = sim.eventsBetween(-1, Number.MAX_SAFE_INTEGER);
  const byId = new Map(all.map((e) => [e.id, e]));
  const kids = new Map(); for (const e of all) if (e.cause) (kids.get(e.cause) || kids.set(e.cause, []).get(e.cause)).push(e);
  const ext = (id) => !!sim.actor(id)?.external;
  const W = (e) => sim.warp(e.at ?? e.t);
  const isRoot = (e) => {
    if (e.type === "message") { const c = e.cause && byId.get(e.cause); return !c || (e.from && ext(e.from)) || c.t !== e.t || !!e.timer; }
    return e.type === "spawn" && !e.cause;
  };
  const leaf = leafNamer(sim);
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
    // per actor, in order of first appearance: its state path, its values, its timers; mail sent on
    const sec = new Map(); const order = [];
    const S = (id) => { if (!sec.has(id)) { sec.set(id, { path: [], bits: [], s: Infinity }); order.push(id); } return sec.get(id); };
    if (r.type === "spawn") { const x = S(r.actor); x.bits.push({ s: W(r), text: "arrives" }); x.s = Math.min(x.s, W(r)); }
    for (const e of seen) {
      const s = W(e);
      if (e.type === "transition" && e.actor) {
        actors.add(e.actor); const x = S(e.actor); x.s = Math.min(x.s, s);
        const f = leaf(e.actor, e.from), t = leaf(e.actor, e.to);
        if (!f && !t) { x.bits.push({ s, text: `reacts to ${e.event || "it"}` }); continue; }
        if (!x.path.length && f) x.path.push({ s, text: f });
        if (t) x.path.push({ s, text: f === t ? `${t} ↺` : t });
      } else if (e.type === "data" && e.actor) { actors.add(e.actor); const x = S(e.actor); x.bits.push({ s, text: `${e.key} = ${e.summary ?? JSON.stringify(e.value)}`.slice(0, 40) }); }
      else if (e.type === "timer" && e.actor && e.action === "set") { const x = S(e.actor); x.bits.push({ s, text: `timer ${fmtMs(e.delay)} started` }); }
      else if (e.type === "timer" && e.actor && e.action === "cancel") { const x = S(e.actor); x.bits.push({ s, text: "timer cancelled" }); }
      else if (e.type === "message" && e.from && e.to && e.to !== e.from && e.t === r.t) { messages.add(e.id); if (!ext(e.from)) S(e.from).bits.push({ s, text: `mail ${e.name} → ${nameOf(e.to)}` }); if (!ext(e.to)) actors.add(e.to); }
      else if (e.type === "spawn" && e.actor) { actors.add(e.actor); S(e.actor).bits.push({ s, text: "arrives" }); }
      else if (e.type === "end" && e.actor) { actors.add(e.actor); S(e.actor).bits.push({ s, text: "leaves" }); }
    }
    const parts = [];
    for (const id of order) {
      const x = sec.get(id); if (!x.path.length && !x.bits.length) continue;
      // collapse a path's consecutive repeats; the section is shown from its first step on
      const p = []; for (const st of x.path) if (!p.length || p[p.length - 1].text !== st.text) p.push(st);
      const items = [];
      if (p.length) items.push({ s: p[0].s, text: p.map((y) => y.text).join(" → "), steps: p });
      for (const b of x.bits) items.push(b);
      parts.push({ s: Math.min(...items.map((i) => i.s)), who: nameOf(id), items });
    }
    if (r.type === "message" && r.to && !ext(r.to) && !seen.some((e) => e.type === "transition" && e.actor === r.to)) parts.push({ s: W(r), who: nameOf(r.to), items: [{ s: W(r), text: "ignored it" }] });
    let cause;
    const you = r.type === "message" ? youLabel(r) : null;
    if (you) cause = `YOU: ${you}`;
    else if (r.type === "spawn") cause = "START";
    else if (r.timer || (r.cause && byId.get(r.cause) && byId.get(r.cause).t !== r.t)) cause = `TIMER: ${r.name}${r.to && r.to !== r.from ? ` for ${nameOf(r.to)}` : ""}`;
    else cause = `${String(nameOf(r.from || "?")).toUpperCase()}: ${r.name}`;
    // s orders the lines (the cause's own moment); show is when it appears (its mail leaves a moment before)
    out.push({ key: r.id, s: W(r), show: r.type === "message" && sim.flight ? Math.min(W(r), sim.flight(r)[0]) : W(r), cause, parts, actors, messages });
  }
  return out.sort((a, b) => a.s - b.s);
}

/** The text of a line at playhead s: what has played so far; "…" while more is to come. */
export function lineText(L, s, { live = false } = {}) {
  if (L.refused) return `${L.cause}  →  refused: ${L.refused}`;
  const done = [], more = L.parts.some((p) => p.items.some((i) => i.s > s));
  for (const p of L.parts) {
    const items = [];
    for (const it of p.items) {
      if (it.steps) { const st = it.steps.filter((x) => x.s <= s + 1e-6); if (st.length) items.push(st.map((x) => x.text).join(" → ")); }
      else if (it.s <= s + 1e-6) items.push(it.text);
    }
    if (items.length) done.push(`${p.who}: ${items.join(" · ")}`);
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
  const body = new THREE.Mesh(new THREE.BoxGeometry(TAPE_W + 0.14, 0.24, 0.3), mat("#3b3f46")); body.position.y = 1.07; body.castShadow = true; root.add(body);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(TAPE_W + 0.18, 0.04, 0.34), mat("#c9a14a")); lip.position.y = 1.2; root.add(lip);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(TAPE_W + 0.04, 0.02, 0.05), mat("#111")); slot.position.set(0, 1.215, 0.02); root.add(slot);
  const lamp = new THREE.MeshLambertMaterial({ color: "#3a5", emissive: "#3f6", emissiveIntensity: 0 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), lamp); led.position.set(TAPE_W / 2 - 0.02, 1.07, 0.155); root.add(led);
  // the tape: a canvas on a plane rising out of the slot, leaning back a little
  const c = document.createElement("canvas"); c.width = TW; c.height = TH; const g = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const tape = new THREE.Mesh(new THREE.PlaneGeometry(TAPE_W, TAPE_H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
  tape.position.set(0, 1.22 + TAPE_H / 2, 0.02); tape.rotation.x = -0.08; tape.userData.ticker = true; root.add(tape);
  tape.userData.plate = { text: "ticker", glyph: BIG / TH }; PLATES.add(tape); // log: the view sampler counts it (glyph = the latest line's)

  let lines = [], evN = -1, refusals = [], selected = null, sig = "", rects = [], lastAt = -1;
  function refresh() {
    const n = sim.trace.events.length; if (n === evN) return; evN = n;
    lines = linesOf(sim, { nameOf, youLabel });
  }
  /** a refused press: shown at once, at playhead s */
  function refuse(cause, reason, s) { refusals.push({ key: `refused-${refusals.length}`, s, cause, refused: reason, parts: [], actors: new Set(), messages: new Set() }); sig = ""; }
  function visible(s) {
    refresh();
    const ahead = live ? Infinity : s + 0.6; // live: the engine has run it, the room has yet to play it
    const xs = lines.filter((L) => (L.show ?? L.s) <= ahead).concat(refusals.filter((L) => L.s <= s + 1e-6 || live));
    return xs.sort((a, b) => a.s - b.s || (a.refused ? 1 : 0) - (b.refused ? 1 : 0));
  }
  function wrap(text, px) {
    g.font = `bold ${px}px ${FONT}`; const words = text.split(/(\s+)/); const out = []; let cur = "";
    for (const w of words) { const t = cur + w; if (g.measureText(t).width > TW - 2 * PAD && cur.trim()) { out.push(cur.trimEnd()); cur = w.trimStart(); } else cur = t; }
    if (cur.trim()) out.push(cur.trimEnd()); return out;
  }
  function draw(items, s) {
    g.fillStyle = "#f7f2e4"; g.fillRect(0, 0, TW, TH);
    // perforation marks and a faint ruled edge, so it reads as paper
    g.fillStyle = "#e3dac2"; for (let y = 8; y < TH; y += 36) { g.fillRect(4, y, 6, 14); g.fillRect(TW - 10, y, 6, 14); }
    rects = []; let y = TH - PAD;
    for (let i = items.length - 1; i >= 0 && y > 0; i--) {
      const L = items[i], latest = i === items.length - 1; const px = latest ? BIG : SMALL;
      const rows = wrap(lineText(L, s, { live: !!live }), px).slice(0, latest ? 6 : 3);
      const h = rows.length * px * 1.18 + (latest ? 22 : 14);
      const y0 = y - h;
      if (selected === L.key) { g.fillStyle = "#ffe46b"; g.fillRect(14, y0 + 2, TW - 28, h - 6); }
      g.fillStyle = L.refused ? "#b3261e" : latest ? "#1b1712" : "#4d463a";
      g.font = `bold ${px}px ${FONT}`; g.textBaseline = "top";
      rows.forEach((r, k) => g.fillText(r, PAD, y0 + 6 + k * px * 1.18));
      rects.push({ key: L.key, y0, y1: y });
      y = y0 - 2; g.fillStyle = "#cfc4a8"; g.fillRect(PAD, y, TW - 2 * PAD, 2); y -= 8;
    }
    tex.needsUpdate = true;
  }
  /** each frame (cheap: redraws only when what it shows changes) */
  function update(s, amb = 0) {
    const items = visible(s);
    const key = `${selected}|${items.length}|` + items.slice(-7).map((L) => lineText(L, s, { live: !!live })).join("|");
    if (key !== sig) { sig = key; draw(items, s); if (items.length && items[items.length - 1].key !== lastKey) { lastKey = items[items.length - 1].key; printedAt = amb; } }
    lamp.emissiveIntensity = amb - printedAt < 0.6 ? 1.2 : 0.05;
    lastAt = s;
  }
  let lastKey = null, printedAt = -9;
  /** a tap on the tape at uv: the line there (toggles), with its people and mail; null for the blank tape */
  function pick(uv) {
    const y = (1 - uv.y) * TH; const r = rects.find((q) => y >= q.y0 && y <= q.y1); if (!r) { selected = null; sig = ""; return null; }
    selected = selected === r.key ? null : r.key; sig = "";
    if (!selected) return { key: null };
    const L = [...lines, ...refusals].find((x) => x.key === r.key);
    return { key: r.key, actors: [...(L?.actors || [])], messages: [...(L?.messages || [])], text: L ? lineText(L, lastAt, { live: !!live }) : "" };
  }
  const latest = (s) => { const xs = visible(s); return xs.length ? lineText(xs[xs.length - 1], s, { live: !!live }) : null; };
  const box = () => new THREE.Box3().setFromObject(root);
  return { root, tape, update, pick, refuse, latest, box, lines: () => visible(lastAt), clearSelection: () => { selected = null; sig = ""; } };
}
