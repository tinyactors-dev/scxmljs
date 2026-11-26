// board/board.js: the wall board of "The Office". One question: who sent mail to whom, and what state is each of
// them in now. It is a sequence diagram of the people in the room, laid out at a fixed, legible size, and the board
// is a window onto it, like a small browser: what does not fit scrolls.
//
//   columns   one per desk and per station that talks, as wide as their names and states need, in the order you
//             see them from the room's start view (the visitor's console first). At the foot of each column, kept
//             on screen: the state it is in now (a plate), the face of the person at that desk (or the station's
//             look) and the name, with a pointer down at the room.
//   now       a bright line above the plates, always on screen. Nothing is drawn after it.
//   rows      above it, newest at the bottom: one row per piece of mail, an arrow from the sender's column to the
//             receiver's in the capsule's colour, growing while the capsule flies in the room, and a chip with the
//             state the receiver went into. Nothing is thrown away: older rows rise out of view and scroll back.
//   scrolling wheel, a trackpad's two fingers, or dragging the history scrolls it (up: back through history;
//             sideways: across the columns), with scrollbars whose thumbs drag when there is more than fits.
//             Like a chat window it follows now (and, sideways, the newest arrow) until you scroll up; then a
//             "jump to now" button brings it back. Scrolling only looks: it never moves time.
//   scrubber  recorded runs only: a media bar across the top, the run's mail as coloured ticks and a knob at the
//             playhead. The knob moves time.
// Touch a row: the room lights the mail and its people, and goes to just before it left. Touch a face or a plate:
// the room lights that person. Touch the board anywhere else: it asks to be looked at squarely ("focus").
// Everything is drawn in a 1600 x 900 design space and scaled to the canvas.

const DW = 1600, DH = 900;
const M = 16;                        // margin
const VBAR_W = 34;                   // the vertical scrollbar's lane, on the right
const HBAR_H = 30;                   // the horizontal scrollbar's lane, at the bottom
const FACE = 104, NAME_H = 44;       // the face at the foot of a column, and the name under it
const FOOT_Y = DH - HBAR_H - NAME_H - FACE - 4; // top of the faces
const PLATE_H = 92;
const PLATE_Y = FOOT_Y - PLATE_H - 12;      // top of the state plates
const NOW_Y = PLATE_Y - 16;                 // the now line
const ROW_H = 100;
const SCRUB_H = 78;                  // the recorded run's media bar across the top
const RISE = 0.35;                   // seconds a new row takes to push the others up
const PX = { name: 32, plate: 42, chip: 34, label: 30 };
const C = { bg: "#0b0f14", col: "#111822", colB: "#0e141c", line: "#2a3542", text: "#f4efe2", dim: "#8a95a3", now: "#ffffff", then: "#ffb000", sel: "#ffe14d", plate: "#1b2430", exc: "#ff5a48", done: "#6d7888", bar: "#1d2631", thumb: "#9aa6b4" };
const EXC = /fail|error|offline|backoff|reject|timeout|abort|cancel|crash|dead|declin|^left$|^killed$/i;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const font = (px, w = 800) => `${w} ${px}px ${FONT}`;
const human = (s) => String(s || "").replace(/^__/, "").replace(/[-_.:/]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim().toUpperCase();
const shortLabel = (s) => human(String(s || "").replace(/\s*\(.*$/, "").replace(/^the\s+/i, ""));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

// the room's capsule colours (world/tubes.js: hueColor(family, 0.7, 0.55), red for errors), without three.js:
// three's setHSL takes the values in linear space and getStyle writes sRGB
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function hueColor(s, sat, light) {
  const h = (hashStr(s) % 360) / 360; const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t); return p; };
  const p = light <= 0.5 ? light * (1 + sat) : light + sat - light * sat, q = 2 * light - p;
  const srgb = (c) => Math.round(255 * (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055));
  return `rgb(${srgb(f(q, p, h + 1 / 3))},${srgb(f(q, p, h))},${srgb(f(q, p, h - 1 / 3))})`;
}
// a live run makes the board again as it grows: what was lit and where it was scrolled stay
const kept = new WeakMap();
export function family(name) { const n = String(name || ""); if (/(^|\.)error(\.|$)|^error/.test(n)) return "error"; return n.split(/[.\s:/]/)[0] || "message"; }

/**
 * createBoard({ sim, width, height, room?, live?, capsules? })
 *   room()    optional: { people, stations, playS } of the world (world/people.js, world/stations.js): the board's
 *             columns are the room's desks and stations, its faces the people's looks
 *   live      a live run: no scrubber, nothing after now
 *   capsules  office.json's capsule colours by family
 */
export function createBoard({ sim, width = DW, height = DH, room = null, live = false, capsules = {} }) {
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const g = canvas.getContext("2d");
  const listeners = {}; const emit = (ev, p) => (listeners[ev] || []).forEach((f) => f(p));
  const capColor = (name) => { const f = family(name); return capsules[f] || (f === "error" ? "#ff4b4b" : hueColor(f, 0.7, 0.55)); };
  const R = room ? room() : null;

  // ---------------------------------------------------------------- the charts: parents and finals, for leaf names
  const chartInfo = new Map();
  const infoOf = (actorId) => {
    const a = sim.actor(actorId); const key = a && a.chart; if (!key) return null;
    if (chartInfo.has(key)) return chartInfo.get(key);
    const ch = sim.chartOf(actorId); const I = { parent: new Map(), kind: new Map(), root: ch && ch.root ? ch.root.id : null };
    if (ch && ch.root) { const walk = (n, p) => { I.parent.set(n.id, p); I.kind.set(n.id, n.kind); (n.children || []).forEach((c) => walk(c, n.id)); }; walk(ch.root, null); }
    chartInfo.set(key, I); return I;
  };
  // the most specific states of a set (its leaves), at most two, in chart order
  const leaves = (actorId, states) => {
    const I = infoOf(actorId); if (!states || !states.length) return [];
    const set = new Set(states); if (!I) return states.slice(-1);
    const parents = new Set(); for (const s of set) { const p = I.parent.get(s); if (p != null) parents.add(p); }
    return [...set].filter((s) => !parents.has(s) && s !== I.root).slice(0, 2);
  };
  const kindOf = (actorId, states) => { const I = infoOf(actorId); if (states.some((s) => EXC.test(s))) return "exc"; if (I && states.length && states.every((s) => I.kind.get(s) === "final")) return "done"; return "ok"; };

  // ---------------------------------------------------------------- columns: the room's desks and stations
  const msgs = sim.messagesBetween(-Infinity, Infinity).filter((m) => m.from != null);
  const talks = new Set(); for (const m of msgs) { talks.add(m.from); for (const r of sim.recipients(m)) talks.add(r); }
  const cols = []; const colOf = new Map(); // actor id -> column
  const RIGHT = [0.897, -0.442]; // the room's start view looks along (-0.36, -0.73) in x, z: its right is this
  if (R && R.people) {
    for (const s of R.people.seats.values()) {
      const ids = s.occ.map((o) => o.id); if (!ids.length) continue;
      const S = s.seat || {}; const col = { key: `seat:${s.key}`, kind: "person", ids, look: (id) => (s.look ? s.look(id) : null), x: S.x ?? 0, z: S.z ?? 0, occ: s.occ };
      cols.push(col); for (const id of ids) colOf.set(id, col);
    }
  }
  if (R && R.stations) {
    for (const st of R.stations.list) {
      if (st.kind === "log" || !talks.has(st.id)) continue;
      const p = st.group.position; const col = { key: `station:${st.id}`, kind: "station", station: st.kind, ids: [st.id], x: p.x, z: p.z };
      cols.push(col); colOf.set(st.id, col);
    }
  }
  // no room (or someone the room does not place): one column per actor that talks or changes state
  for (const a of sim.actors) {
    if (colOf.has(a.id)) continue;
    if (a.external ? !talks.has(a.id) : !talks.has(a.id) && !sim.transitionsBetween(-Infinity, Infinity).some((t) => t.actor === a.id)) continue;
    if (a.external && /log/i.test(`${a.kind || ""}`)) continue;
    const col = { key: `actor:${a.id}`, kind: a.external ? "station" : "person", station: a.kind || "service", ids: [a.id], x: cols.length * 3, z: 0, look: () => null };
    cols.push(col); colOf.set(a.id, col);
  }
  // the people at the keyboards first (they start what happens: read left to right), then as the room shows them
  const isUser = (c) => (c.kind === "station" && c.station === "user" ? 0 : 1);
  cols.sort((a, b) => isUser(a) - isUser(b) || a.x * RIGHT[0] + a.z * RIGHT[1] - (b.x * RIGHT[0] + b.z * RIGHT[1]));
  // who sits at a desk at playhead s (seats are shared over time), else the last one before
  const occupant = (col, s) => {
    if (col.kind !== "person") return { id: col.ids[0], present: true };
    let best = null; for (const o of col.occ || []) { if (s >= o.bornS && s < o.endS) return { id: o.id, present: true }; if (o.bornS <= s) best = o; }
    return best ? { id: best.id, present: false } : { id: col.ids[0], present: false };
  };

  // ---------------------------------------------------------------- rows: each piece of mail, and state changes no mail caused
  const evs = sim.eventsBetween(-Infinity, Infinity); const byId = new Map(evs.map((e) => [e.id, e]));
  const steps = []; const stepOfMsg = new Map();
  for (const m of msgs) {
    if (m.to && /log/i.test(sim.actor(m.to)?.kind || "")) continue;
    const to = sim.recipients(m); const [s0, s1] = sim.flight(m);
    const st = { kind: "mail", id: m.id, m, s0, s1, from: m.from, to, chips: new Map(), color: capColor(m.name), label: human(m.name) };
    steps.push(st); stepOfMsg.set(m.id, st);
  }
  const rootMsg = (e) => { let c = e.cause; for (let k = 0; c && k < 50; k++) { if (stepOfMsg.has(c)) return stepOfMsg.get(c); const x = byId.get(c); if (!x) return null; c = x.type === "message" ? x.via || x.cause : x.cause; } return null; };
  const sentBy = new Map(); for (const st of steps) for (const c of [st.m.cause, st.m.via]) if (c) (sentBy.get(c) || sentBy.set(c, []).get(c)).push(st);
  const loose = new Map(); // a state change no mail caused: one row per cause
  for (const tr of sim.transitionsBetween(-Infinity, Infinity)) {
    if (!tr.to || !tr.to.length) continue; // targetless: no change of state
    let names = leaves(tr.actor, sim.activeAt(tr.actor, tr.at + 1e-6)); if (!names.length) names = leaves(tr.actor, tr.to); if (!names.length) continue;
    const chip = { actor: tr.actor, at: tr.at, s: sim.warp(tr.at), names, kind: kindOf(tr.actor, names), first: !tr.from || !tr.from.length };
    const st = rootMsg(tr);
    if (st && st.to.includes(tr.actor) && st.chips.size < 8) { st.chips.set(tr.actor, chip); continue; }
    // a state someone went into by themselves and sent mail from (arriving and asking): the start of that mail's arrow
    const out = (sentBy.get(tr.id) || []).find((m) => m.from === tr.actor && !m.fromChip && !m.to.includes(tr.actor));
    if (out) { out.fromChip = chip; continue; }
    const key = tr.cause || tr.id; let row = loose.get(key);
    if (!row) { row = { kind: "state", id: `state:${tr.id}`, s0: chip.s, s1: chip.s, from: null, to: [], chips: new Map() }; loose.set(key, row); steps.push(row); }
    row.chips.set(tr.actor, chip); row.s0 = Math.min(row.s0, chip.s);
  }
  steps.sort((a, b) => a.s0 - b.s0);
  const lastS = steps.length ? steps[steps.length - 1].s0 : 0;
  const playDur = sim.playDuration || sim.warp(sim.duration) + 2;

  // ---------------------------------------------------------------- text
  function rrect(x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
  const widthOf = (text, px) => { g.font = font(px); return g.measureText(text).width; };
  // text in at most two lines (`parts` kept apart when given), at the largest size from px down to min that fits
  function fitLines(parts, maxW, px, min, max = 2) {
    for (let s = px; s >= min; s -= 2) {
      g.font = font(s); const lines = []; let fits = true;
      if (parts.length > 1) { for (const p of parts) { lines.push(p); if (g.measureText(p).width > maxW) fits = false; } }
      else { let cur = ""; for (const w of parts[0].split(" ")) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } } lines.push(cur); fits = lines.every((l) => g.measureText(l).width <= maxW); }
      if (fits && lines.length <= max) return { lines, px: s };
    }
    return { lines: parts.length > 1 ? parts : [parts[0]], px: min };
  }
  function drawLines(fit, cx, cy) { g.font = font(fit.px); const lh = fit.px * 1.08; fit.lines.forEach((l, i) => g.fillText(l, cx, cy + (i - (fit.lines.length - 1) / 2) * lh)); }
  function nameOf(col, id) { const a = sim.actor(id); if (col.kind === "station" && col.station === "user" && live) return "YOU"; return shortLabel(a && a.label ? a.label : id); }
  const chipText = (chip) => chip.names.map(human).join(" · ");

  // ---------------------------------------------------------------- columns: as wide as their names and states need
  {
    const states = new Map(); // column -> the widest state text it shows (a chip or a plate)
    for (const st of steps) for (const [id, chip] of st.chips) { const c = colOf.get(id); if (c) states.set(c, Math.max(states.get(c) || 0, widthOf(chipText(chip), PX.plate))); }
    for (const st of steps) if (st.fromChip) { const c = colOf.get(st.from); if (c) states.set(c, Math.max(states.get(c) || 0, widthOf(chipText(st.fromChip), PX.plate))); }
    let x = 0;
    for (const c of cols) {
      const name = Math.max(...c.ids.map((id) => widthOf(nameOf(c, id), PX.name)));
      c.w = c.kind === "station" ? clamp(name + 40, 210, 460) : clamp(Math.max(name + 40, (states.get(c) || 0) + 48), 270, 560);
      c.x0 = x; c.cx = x + c.w / 2; x += c.w;
    }
    cols.forEach((c, i) => (c.i = i));
  }
  // the viewport, and a diagram narrower than it stretched to fill it (a small system gets wide columns, not an empty board)
  const VX0 = M, VX1 = DW - M - VBAR_W, VW = VX1 - VX0;
  { const w = cols.reduce((n, c) => n + c.w, 0); if (w && w < VW) { let x = 0; for (const c of cols) { c.w *= VW / w; c.x0 = x; c.cx = x + c.w / 2; x += c.w; } } }
  const contentW = cols.reduce((n, c) => n + c.w, 0);

  // ---------------------------------------------------------------- the viewport
  const HIST_TOP = live ? M : SCRUB_H + 10, HIST_H = NOW_Y - 10 - HIST_TOP; // where the history shows
  const k0 = kept.get(sim) || {};
  let lit = k0.lit || { actorId: null, messageId: null };
  let pinned = k0.pinned ?? true;          // following now (the bottom)
  let scrollTop = k0.scrollTop ?? 0;       // when not pinned: content y at the top of the view
  let scrollX = k0.scrollX ?? 0, targetX = null, followed = k0.followed ?? null;
  const keep = () => kept.set(sim, { lit, pinned, scrollTop, scrollX, followed });
  const maxX = () => Math.max(0, contentW - VW);
  const offX = () => (contentW < VW ? (VW - contentW) / 2 : 0);
  const sx = (x) => VX0 + offX() + x - scrollX;            // content x -> board x
  const showCols = (list) => { // the least scrolling that shows these columns (the first of them when they cannot all show)
    if (!list.length || contentW <= VW) return;
    const a = Math.min(...list.map((c) => c.x0)), b = Math.max(...list.map((c) => c.x0 + c.w));
    let t = scrollX; if (b - a > VW) t = list[list.length - 1].cx - VW / 2; else if (a < scrollX + 20) t = a - 20; else if (b > scrollX + VW - 20) t = b - VW + 20;
    targetX = clamp(t, 0, maxX());
  };

  // ---------------------------------------------------------------- state
  let hover = null, drag = null, P = 0, lastKey = "", rowsDrawn = [], layout = { contentH: 0, viewTop: 0 };
  const playNow = (t) => { const r = room ? room() : null; return r && Number.isFinite(r.playS) ? r.playS : sim.warp(t); };
  // the rows up to now, each with its place in the content (a new one grows in over RISE seconds)
  function place() {
    const out = []; let acc = 0;
    for (const st of steps) { if (st.s0 > P + 1e-6) break; const pres = ease((P - st.s0) / RISE); out.push({ st, top: acc, pres }); acc += pres * ROW_H; }
    const contentH = acc, low = Math.min(0, contentH - HIST_H), high = contentH - HIST_H;
    if (!pinned && scrollTop >= high - 1) pinned = true;
    const viewTop = pinned ? high : clamp(scrollTop, low, high);
    if (!pinned) scrollTop = viewTop;
    layout = { contentH, viewTop, rows: out };
    return layout;
  }

  // ---------------------------------------------------------------- drawing
  function drawFace(cx, top, S, look, dim) {
    g.save(); g.globalAlpha = dim ? 0.35 : 1;
    const L = look || { shirt: "#7d8794", skin: "#d9a47e", hair: "#3a3a3a", hairStyle: "short" };
    // shoulders, then the block head (as the avatars in the room), its hair, hat, eyes
    g.fillStyle = L.shirt || "#7d8794"; rrect(cx - S * 0.78, top + S * 0.92, S * 1.56, S * 0.44, S * 0.16); g.fill();
    if (L.accessory === "tie") { g.fillStyle = "#b8322c"; g.beginPath(); g.moveTo(cx - S * 0.07, top + S * 0.92); g.lineTo(cx + S * 0.07, top + S * 0.92); g.lineTo(cx, top + S * 1.35); g.fill(); }
    g.fillStyle = L.skin || "#d9a47e"; g.fillRect(cx - S / 2, top, S, S);
    if (L.hairStyle !== "bald") {
      g.fillStyle = L.hair || "#3a3a3a"; g.fillRect(cx - S / 2 - S * 0.04, top - S * 0.06, S * 1.08, S * 0.24);
      const side = L.hairStyle === "long" ? S * 0.85 : S * 0.38; g.fillRect(cx - S / 2 - S * 0.06, top, S * 0.1, side); g.fillRect(cx + S / 2 - S * 0.04, top, S * 0.1, side);
    }
    if (L.hat === "beanie") { g.fillStyle = L.hatColor || "#c04"; rrect(cx - S * 0.56, top - S * 0.2, S * 1.12, S * 0.36, S * 0.16); g.fill(); }
    else if (L.hat === "cap") { g.fillStyle = L.hatColor || "#c04"; g.fillRect(cx - S * 0.54, top - S * 0.14, S * 1.08, S * 0.26); g.fillRect(cx - S * 0.54, top + S * 0.08, S * 1.3, S * 0.08); }
    if (L.accessory === "headphones" || L.accessory === "headset") { g.fillStyle = "#222"; g.fillRect(cx - S * 0.62, top + S * 0.3, S * 0.14, S * 0.34); g.fillRect(cx + S * 0.48, top + S * 0.3, S * 0.14, S * 0.34); }
    g.fillStyle = "#1d1a18"; const ey = top + S * 0.46, es = S * 0.11; g.fillRect(cx - S * 0.24 - es / 2, ey, es, es); g.fillRect(cx + S * 0.24 - es / 2, ey, es, es);
    if (L.face && L.face.glasses) { g.strokeStyle = "#1d1a18"; g.lineWidth = S * 0.035; g.strokeRect(cx - S * 0.36, ey - S * 0.07, S * 0.24, S * 0.24); g.strokeRect(cx + S * 0.12, ey - S * 0.07, S * 0.24, S * 0.24); }
    g.fillRect(cx - S * 0.12, top + S * 0.74, S * 0.24, S * 0.045);
    g.restore();
  }
  function drawStation(cx, top, S, kind) {
    if (kind === "user") { // the console the visitor presses (live), the hatch the people at the keyboards hand work through
      g.fillStyle = "#4a3523"; rrect(cx - S * 0.7, top + S * 0.05, S * 1.4, S * 1.25, S * 0.1); g.fill();
      g.fillStyle = "#c9a85a"; g.fillRect(cx - S * 0.55, top + S * 0.12, S * 1.1, S * 0.16);
      for (const [dx, dy, c] of [[-0.3, 0.55, "#2a2a2a"], [0.3, 0.55, "#2f9e4f"], [-0.3, 0.98, "#2a2a2a"], [0.3, 0.98, "#2f9e4f"]]) { g.fillStyle = "#c9a85a"; g.beginPath(); g.arc(cx + dx * S, top + dy * S, S * 0.17, 0, 7); g.fill(); g.fillStyle = c; g.beginPath(); g.arc(cx + dx * S, top + dy * S, S * 0.12, 0, 7); g.fill(); }
    } else if (kind === "timer") {
      g.fillStyle = "#6b4426"; g.beginPath(); g.arc(cx, top + S * 0.65, S * 0.62, 0, 7); g.fill(); g.fillStyle = "#f3ead6"; g.beginPath(); g.arc(cx, top + S * 0.65, S * 0.5, 0, 7); g.fill();
      g.strokeStyle = "#222"; g.lineWidth = S * 0.06; g.beginPath(); g.moveTo(cx, top + S * 0.65); g.lineTo(cx, top + S * 0.3); g.moveTo(cx, top + S * 0.65); g.lineTo(cx + S * 0.26, top + S * 0.72); g.stroke();
    } else { // a machine on the wall: the purple box with a brass dial
      g.fillStyle = "#4b3d5c"; rrect(cx - S * 0.62, top, S * 1.24, S * 1.3, S * 0.1); g.fill();
      g.fillStyle = "#c9a240"; g.beginPath(); g.arc(cx, top + S * 0.68, S * 0.38, 0, 7); g.fill(); g.fillStyle = "#3a2f47"; g.beginPath(); g.arc(cx, top + S * 0.68, S * 0.26, 0, 7); g.fill();
      g.fillStyle = "#1d1a18"; g.fillRect(cx - S * 0.12, top - S * 0.16, S * 0.24, S * 0.18);
    }
  }
  function arrowHead(x, y, dir, size, color) { g.fillStyle = color; g.beginPath(); g.moveTo(x, y); g.lineTo(x - dir * size, y - size * 0.62); g.lineTo(x - dir * size, y + size * 0.62); g.closePath(); g.fill(); }
  // a chip: the state someone went into, as wide as its name (two lines when the column is narrower)
  const chipFit = (chip, col) => fitLines([chipText(chip)], col.w - 26, PX.chip, 24);
  function chipW(chip, col) { const f = chipFit(chip, col); g.font = font(f.px); return Math.min(col.w - 12, Math.max(80, ...f.lines.map((l) => g.measureText(l).width)) + 34); }
  function chipAt(col, y, chip, hot) {
    const f = chipFit(chip, col), w = chipW(chip, col), h = f.lines.length > 1 ? 72 : 52, x = sx(col.cx) - w / 2;
    g.fillStyle = chip.kind === "exc" ? C.exc : chip.kind === "done" ? C.done : "#f4efe2"; rrect(x, y - h / 2, w, h, 10); g.fill();
    if (chip.first) { g.strokeStyle = "#7dff9a"; g.lineWidth = 5; rrect(x, y - h / 2, w, h, 10); g.stroke(); } // arrived: a green rim
    if (hot) { g.strokeStyle = C.sel; g.lineWidth = 6; rrect(x - 4, y - h / 2 - 4, w + 8, h + 8, 12); g.stroke(); }
    g.fillStyle = chip.kind === "ok" ? "#10161d" : "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; drawLines(f, sx(col.cx), y + 1);
  }
  function drawRow(st, y, hot) {
    const shown = new Map(); for (const [id, chip] of st.chips) { const c = colOf.get(id); if (c && chip.s <= P + 1e-6) shown.set(c, chip); }
    if (st.kind === "mail") {
      const a = colOf.get(st.from); const to = [...new Set(st.to.map((r) => colOf.get(r)).filter(Boolean))];
      const fc = a && st.fromChip ? st.fromChip : null;
      const fdir = to.length && to[0] !== a && a && to[0].cx < a.cx ? -1 : 1;
      const x0 = a ? sx(a.cx) + (fc ? fdir * (chipW(fc, a) / 2 + 2) : 0) : VX0 + 10;
      if (fc) shown.set(a, fc);
      const k = st.s1 > st.s0 ? clamp01((P - st.s0) / (st.s1 - st.s0)) : 1; // the capsule's progress in the room
      const lw = hot ? 12 : 9; g.lineCap = "round";
      let lx = null, lalign = "center", lspan = 0, lend = null;
      for (const b of to) {
        g.strokeStyle = st.color; g.lineWidth = lw;
        const half = shown.has(b) ? chipW(shown.get(b), b) / 2 : 0, bx = sx(b.cx);
        if (b === a) { // to itself: a loop out of the right side and back
          const r = 24, ox = bx + Math.max(half, 14) + 6, ex = ox + 48;
          g.beginPath(); g.moveTo(ox, y - r); g.lineTo(ex, y - r); g.arc(ex, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * k); if (k >= 1) g.lineTo(ox + 26, y + r); g.stroke();
          if (k >= 1) arrowHead(ox, y + r, -1, 24, st.color);
          if (lx == null) { lx = ex + r + 14; lalign = "left"; }
          continue;
        }
        const dir = bx > x0 ? 1 : -1; const xh = bx - dir * (half + 4); const xe = xh - dir * 26; const xk = x0 + (xe - x0) * k;
        g.beginPath(); g.moveTo(x0, y); g.lineTo(xk, y); g.stroke();
        if (k < 1) { g.fillStyle = st.color; rrect(xk - 26, y - 15, 52, 30, 15); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 3; g.stroke(); } // the capsule, in flight
        else arrowHead(xh, y, dir, 32, st.color);
        const sp = Math.abs(xe - x0); if (sp > lspan) { lspan = sp; lx = (x0 + xe) / 2; lalign = "center"; lend = [x0, xe]; }
      }
      if (!to.length) { g.strokeStyle = st.color; g.lineWidth = lw; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 70, y); g.stroke(); lx = x0 + 80; lalign = "left"; }
      g.lineCap = "butt";
      if (a && !fc && !(to.length === 1 && to[0] === a)) { g.fillStyle = st.color; g.beginPath(); g.arc(x0, y, 11, 0, 7); g.fill(); }
      for (const [c, chip] of shown) chipAt(c, y, chip, hot);
      // the mail's name, whole, over its arrow (on a dark backing where it runs past the arrow's ends)
      if (lx != null) {
        let label = st.label;
        g.font = font(PX.label); g.textAlign = lalign; g.textBaseline = lalign === "left" ? "middle" : "bottom";
        if (lend && Math.min(...lend) > VX1 - 40) label = `${label}  ▶`; else if (lend && Math.max(...lend) < VX0 + 40) label = `◀  ${label}`; // all of it off to one side
        const tw = g.measureText(label).width, ty = lalign === "left" ? y : y - 12;
        if (lend) { // over the part of the arrow on screen; a name longer than that ends at the arrowhead and runs back
          let lo = Math.max(Math.min(...lend), VX0 + 8), hi = Math.min(Math.max(...lend), VX1 - 8); if (hi < lo + tw) { if (lo > VX1 - 60) lo = VX1 - 8 - tw; if (hi < VX0 + 60) hi = VX0 + 8 + tw; }
          lx = clamp((lo + hi) / 2, lo + tw / 2, hi - tw / 2);
          if (tw > hi - lo) lx = lend[1] > lend[0] ? Math.min(hi, lend[1]) - tw / 2 : Math.max(lo, lend[1]) + tw / 2;
          lx = clamp(lx, VX0 + 8 + tw / 2, VX1 - 8 - tw / 2);
        }
        if (lalign === "center" && tw > lspan - 20) { g.fillStyle = "rgba(11,15,20,0.82)"; rrect(lx - tw / 2 - 8, ty - PX.label - 2, tw + 16, PX.label + 6, 6); g.fill(); }
        g.fillStyle = hot ? C.sel : C.text; g.fillText(label, lx, ty);
      }
      return;
    }
    for (const [c, chip] of shown) chipAt(c, y, chip, hot);
  }
  // the scrollbars' geometry: track and thumb, or null when everything fits
  function vbar() {
    const { contentH, viewTop } = layout; if (contentH <= HIST_H + 1) return null;
    const y0 = HIST_TOP, y1 = NOW_Y - 10, tl = y1 - y0, th = Math.max(70, tl * HIST_H / contentH);
    const f = clamp01(viewTop / (contentH - HIST_H)); return { x: DW - M - VBAR_W / 2, y0, y1, th, ty: y0 + (tl - th) * f };
  }
  function hbar() {
    if (contentW <= VW + 1) return null; const x0 = VX0, x1 = VX1, tl = x1 - x0, tw = Math.max(90, tl * VW / contentW);
    return { y: DH - HBAR_H / 2 - 2, x0, x1, tw, tx: x0 + (tl - tw) * clamp01(scrollX / maxX()) };
  }
  const JUMP = { x: VX1 - 210, y: NOW_Y - 70, w: 196, h: 52 };
  const SCR = { x0: VX0 + 20, x1: VX1 - 20, y: SCRUB_H / 2 + 4 }; // the media bar
  const scrubX = (s) => SCR.x0 + (SCR.x1 - SCR.x0) * clamp01(s / playDur);

  function draw() {
    g.setTransform(canvas.width / DW, 0, 0, canvas.height / DH, 0, 0);
    g.fillStyle = C.bg; g.fillRect(0, 0, DW, DH);
    const L = place();
    const litCol = lit.actorId ? colOf.get(lit.actorId) : null;
    const hoverStep = hover && hover.type === "row" ? hover.step : null;
    const hotStep = hoverStep || (lit.messageId ? stepOfMsg.get(lit.messageId) : null);
    const hotCols = new Set(); if (hotStep) { if (hotStep.from) hotCols.add(colOf.get(hotStep.from)); for (const r of hotStep.to) hotCols.add(colOf.get(r)); for (const a of hotStep.chips.keys()) hotCols.add(colOf.get(a)); }
    if (litCol) hotCols.add(litCol); if (hover && hover.type === "col") hotCols.add(hover.col);
    // columns (clipped to the viewport): a stripe each, a dashed lifeline
    g.save(); g.beginPath(); g.rect(VX0, 0, VW, DH); g.clip();
    for (const c of cols) {
      const x = sx(c.x0); if (x > VX1 || x + c.w < VX0) continue;
      g.fillStyle = c.i % 2 ? C.col : C.colB; g.fillRect(x, HIST_TOP - 6, c.w, DH - HBAR_H - HIST_TOP + 6);
      if (hotCols.has(c)) { g.fillStyle = "rgba(255,225,77,0.10)"; g.fillRect(x, HIST_TOP - 6, c.w, DH - HBAR_H - HIST_TOP + 6); }
      g.strokeStyle = C.line; g.lineWidth = 3; g.setLineDash([10, 12]); g.beginPath(); g.moveTo(sx(c.cx), HIST_TOP); g.lineTo(sx(c.cx), NOW_Y); g.stroke(); g.setLineDash([]);
    }
    // the history, clipped to its window
    g.save(); g.beginPath(); g.rect(VX0, HIST_TOP - 6, VW, NOW_Y - HIST_TOP); g.clip();
    rowsDrawn = [];
    for (const r of L.rows) {
      const y = HIST_TOP + r.top + 0.5 * r.pres * ROW_H - L.viewTop;
      if (y < HIST_TOP - ROW_H || y > NOW_Y + ROW_H) continue;
      g.save(); g.globalAlpha = 0.35 + 0.65 * r.pres; drawRow(r.st, y, r.st === hotStep); g.restore();
      rowsDrawn.push({ st: r.st, y });
    }
    g.restore();
    // the foot of each column, always on screen: the state now, the face, the name, a pointer at the room
    for (const c of cols) {
      const x = sx(c.x0); if (x > VX1 || x + c.w < VX0) continue;
      const o = occupant(c, P), hot = hotCols.has(c), cx = sx(c.cx), w = c.w - 12;
      if (c.kind === "person") {
        const names = o.present ? leaves(o.id, sim.activeAt(o.id, sim.unwarp(P))) : [];
        const k = names.length ? kindOf(o.id, names) : "none";
        g.fillStyle = k === "exc" ? C.exc : k === "done" ? C.done : names.length ? C.plate : "#0d1218"; rrect(x + 6, PLATE_Y, w, PLATE_H, 12); g.fill();
        if (names.length) {
          g.fillStyle = C.text; g.textAlign = "center"; g.textBaseline = "middle";
          const one = names.map(human).join(" · ");
          drawLines(widthOf(one, PX.plate) <= w - 20 ? { lines: [one], px: PX.plate } : fitLines(names.length > 1 ? names.map(human) : [one], w - 16, 36, 24), cx, PLATE_Y + PLATE_H / 2 + 2);
        }
      }
      if (hot) { g.strokeStyle = C.sel; g.lineWidth = 6; rrect(x + 4, PLATE_Y - 2, w + 4, PLATE_H + 4, 13); g.stroke(); }
      const S = 64, top = FOOT_Y + (FACE - S * 1.36) / 2 + 4;
      if (c.kind === "person") drawFace(cx, top, S, c.look ? c.look(o.id) : null, !o.present); else drawStation(cx, top, S, c.station);
      if (hot) { g.strokeStyle = C.sel; g.lineWidth = 6; rrect(x + 10, FOOT_Y - 4, c.w - 20, FACE + NAME_H + 2, 14); g.stroke(); }
      const nm = nameOf(c, o.id); let px = PX.name; while (px > 22 && widthOf(nm, px) > c.w - 10) px -= 2;
      g.fillStyle = o.present ? C.text : C.dim; g.font = font(px); g.textAlign = "center"; g.textBaseline = "top"; g.fillText(nm, cx, FOOT_Y + FACE);
    }
    g.restore();
    // now: the line above the plates (amber "THEN" while a live run is looked at in the past)
    const past = live && P < lastS - 1e-3;
    g.fillStyle = past ? C.then : C.now; g.fillRect(VX0, NOW_Y - 3, VW, 6);
    g.font = font(28, 900); g.textAlign = "left"; g.textBaseline = "bottom"; const tag = past ? "THEN" : "NOW"; const tw = g.measureText(tag).width + 20;
    rrect(VX0, NOW_Y - 36, tw, 36, 6); g.fill(); g.fillStyle = C.bg; g.fillText(tag, VX0 + 10, NOW_Y - 3);
    // more to the sides: a soft edge where columns continue
    if (contentW > VW) { if (scrollX > 1) edge(VX0, 1); if (scrollX < maxX() - 1) edge(VX1, -1); }
    // the scrollbars, and "jump to now" when scrolled up
    const vb = vbar(), hb = hbar(), hv = hover && hover.type;
    if (vb) { g.fillStyle = C.bar; rrect(vb.x - 9, vb.y0, 18, vb.y1 - vb.y0, 9); g.fill(); g.fillStyle = drag && drag.type === "vbar" || hv === "vbar" ? C.sel : C.thumb; rrect(vb.x - 9, vb.ty, 18, vb.th, 9); g.fill(); }
    if (hb) { g.fillStyle = C.bar; rrect(hb.x0, hb.y - 9, hb.x1 - hb.x0, 18, 9); g.fill(); g.fillStyle = drag && drag.type === "hbar" || hv === "hbar" ? C.sel : C.thumb; rrect(hb.tx, hb.y - 9, hb.tw, 18, 9); g.fill(); }
    if (!pinned) {
      g.fillStyle = hv === "jump" ? C.sel : C.now; rrect(JUMP.x, JUMP.y, JUMP.w, JUMP.h, 26); g.fill();
      g.fillStyle = C.bg; g.font = font(28, 900); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("▼  NOW", JUMP.x + JUMP.w / 2, JUMP.y + JUMP.h / 2 + 1);
    }
    if (!live) drawScrub();
  }
  function edge(x, dir) { const gr = g.createLinearGradient(x, 0, x + dir * 60, 0); gr.addColorStop(0, "rgba(11,15,20,0.9)"); gr.addColorStop(1, "rgba(11,15,20,0)"); g.fillStyle = gr; g.fillRect(dir > 0 ? x : x - 60, HIST_TOP - 6, 60, DH - HBAR_H - HIST_TOP + 6); }
  // the media bar: the whole run left to right, its mail as coloured ticks, the knob at the playhead
  function drawScrub() {
    const hot = (hover && hover.type === "scrub") || (drag && drag.type === "scrub");
    g.fillStyle = "#151c25"; g.fillRect(0, 0, DW, SCRUB_H);
    g.fillStyle = C.bar; rrect(SCR.x0 - 10, SCR.y - 12, SCR.x1 - SCR.x0 + 20, 24, 12); g.fill();
    for (const st of steps) if (st.kind === "mail") { g.fillStyle = st.color; g.fillRect(scrubX(st.s0) - 1.5, SCR.y - 9, 3, 18); }
    const x = scrubX(P);
    g.fillStyle = "rgba(255,255,255,0.22)"; rrect(SCR.x0 - 10, SCR.y - 12, x - SCR.x0 + 10, 24, 12); g.fill();
    g.fillStyle = hot ? C.sel : C.now; rrect(x - 26, SCR.y - 30, 52, 60, 12); g.fill(); // the knob, with grip lines
    g.strokeStyle = "#2a3542"; g.lineWidth = 4; for (const d of [-10, 0, 10]) { g.beginPath(); g.moveTo(x + d, SCR.y - 16); g.lineTo(x + d, SCR.y + 16); g.stroke(); }
  }

  // ---------------------------------------------------------------- input
  function hit(u, v) {
    const x = u * DW, y = v * DH;
    if (!live && y < SCRUB_H) return { type: "scrub" };
    if (!pinned && x >= JUMP.x && x <= JUMP.x + JUMP.w && y >= JUMP.y && y <= JUMP.y + JUMP.h) return { type: "jump" };
    const vb = vbar(); if (vb && x > VX1 && y >= vb.y0 - 10 && y <= vb.y1 + 10) return { type: "vbar", vb };
    const hb = hbar(); if (hb && y > DH - HBAR_H - 6) return { type: "hbar", hb };
    if (x < VX0 || x > VX1) return { type: "empty" };
    if (y >= NOW_Y - 4) { const cx = x - VX0 - offX() + scrollX; const c = cols.find((k) => cx >= k.x0 && cx < k.x0 + k.w); return c && y < DH - HBAR_H ? { type: "col", col: c } : { type: "empty" }; }
    let best = null; for (const r of rowsDrawn) { const d = Math.abs(r.y - y); if (d < ROW_H / 2 && (!best || d < best.d)) best = { d, st: r.st }; }
    return best ? { type: "row", step: best.st } : { type: "empty" };
  }
  const hkey = (h) => (h ? h.type + (h.step ? h.step.id : h.col ? h.col.key : "") : "");
  function setHover(h) {
    if (hkey(h) === hkey(hover)) return; hover = h; lastKey = "";
    const ids = h && h.type === "row" ? [...new Set([...h.step.chips.keys(), ...h.step.to, h.step.from].filter(Boolean))] : h && h.type === "col" ? [occupant(h.col, P).id] : [];
    emit("hover", { actorIds: ids, messageIds: h && h.type === "row" && h.step.kind === "mail" ? [h.step.m.id] : [] });
  }
  const seekTo = (s) => emit("seek", { t: sim.unwarp(Math.max(0, s)) });
  const scrubAt = (u) => seekTo(clamp01((u * DW - SCR.x0) / (SCR.x1 - SCR.x0)) * playDur);
  const scrollBy = (dx, dy) => { // dy > 0: toward now
    if (dx) { scrollX = clamp(scrollX + dx, 0, maxX()); targetX = null; }
    if (dy) { const { viewTop } = layout; pinned = false; scrollTop = viewTop + dy; place(); }
    lastKey = ""; keep();
  };
  function pointer(type, u, v, extra = {}) {
    const x = u * DW, y = v * DH;
    if (type === "leave") { setHover(null); return; }
    if (type === "wheel") {
      const dy = extra.dy || 0, dx = extra.dx || 0;
      const vertical = layout.contentH > HIST_H + 1 && y < NOW_Y && !(extra.shift);
      if (vertical) scrollBy(dx, dy); else scrollBy(dx + dy, 0); // over the faces, or when it all fits upright: sideways
      return;
    }
    const h = hit(u, v);
    if (type === "down") {
      drag = { type: "maybe", h, x, y, sx: scrollX, top: layout.viewTop, moved: false };
      if (h.type === "scrub") { drag.type = "scrub"; scrubAt(u); }
      else if (h.type === "vbar") { const b = h.vb; drag.type = "vbar"; if (y < b.ty || y > b.ty + b.th) { pinned = false; scrollTop = (y - b.y0 - b.th / 2) / (b.y1 - b.y0 - b.th) * (layout.contentH - HIST_H); place(); } drag.top = layout.viewTop; }
      else if (h.type === "hbar") { const b = h.hb; drag.type = "hbar"; if (x < b.tx || x > b.tx + b.tw) scrollX = clamp((x - b.x0 - b.tw / 2) / (b.x1 - b.x0 - b.tw) * maxX(), 0, maxX()); targetX = null; drag.sx = scrollX; }
      lastKey = ""; keep(); return;
    }
    if (type === "move") {
      if (!drag) { setHover(h); return; }
      const dx = x - drag.x, dy = y - drag.y;
      if (drag.type === "scrub") { scrubAt(u); return; }
      if (drag.type === "vbar") { const b = vbar(); if (b) { pinned = false; scrollTop = drag.top + dy * (layout.contentH - HIST_H) / (b.y1 - b.y0 - b.th); place(); } lastKey = ""; keep(); return; }
      if (drag.type === "hbar") { const b = hbar(); if (b) { scrollX = clamp(drag.sx + dx * maxX() / (b.x1 - b.x0 - b.tw), 0, maxX()); targetX = null; } lastKey = ""; keep(); return; }
      if (drag.type === "maybe" && Math.hypot(dx, dy) > 10 && drag.h.type !== "jump") drag.type = "pan";
      if (drag.type === "pan") { // the content follows the finger
        scrollX = clamp(drag.sx - dx, 0, maxX()); targetX = null;
        if (Math.abs(dy) > 2 && layout.contentH > HIST_H + 1) { pinned = false; scrollTop = drag.top - dy; place(); }
        lastKey = ""; keep();
      }
      return;
    }
    if (type === "up") {
      const d = drag; drag = null; lastKey = "";
      if (!d || d.type !== "maybe") { keep(); return; }
      const t = d.h;
      if (t.type === "jump") { pinned = true; followed = null; }
      else if (t.type === "row") {
        const st = t.step; const ids = [...new Set([st.from, ...st.to, ...st.chips.keys()].filter(Boolean))];
        lit = { actorId: null, messageId: st.kind === "mail" ? st.m.id : null };
        emit("select", { actorIds: ids, messageIds: st.kind === "mail" ? [st.m.id] : [], storyId: null });
        seekTo(st.s0 - 0.05); // the room goes to just before it: the capsule flies again
      } else if (t.type === "col") {
        const o = occupant(t.col, P); lit = { actorId: o.id, messageId: null }; emit("select", { actorIds: [o.id], messageIds: [], storyId: null });
      } else if (t.type === "empty") emit("focus", {}); // the board itself: look at it squarely
      keep();
    }
  }

  const api = {
    canvas, dirty: true,
    get state() { return { playS: P, pinned, scrollX, viewTop: layout.viewTop, contentH: layout.contentH, contentW, viewW: VW, viewH: HIST_H }; },
    get columns() { return cols.map((c) => ({ key: c.key, kind: c.kind, ids: c.ids.slice(), u: sx(c.cx) / DW, w: c.w })); },
    get rows() { return rowsDrawn.map((r) => ({ id: r.st.id, kind: r.st.kind, from: r.st.from, to: r.st.to.slice(), v: r.y / DH })); },
    update(t) {
      P = playNow(t);
      // following: sideways to the newest arrow while pinned to now
      const newest = (() => { let n = null; for (const st of steps) { if (st.s0 > P + 1e-6) break; n = st; } return n; })();
      if (pinned && newest && newest.id !== followed) { followed = newest.id; showCols([newest.from, ...newest.to, ...newest.chips.keys()].map((id) => colOf.get(id)).filter(Boolean)); keep(); }
      if (targetX != null) { const d = targetX - scrollX; scrollX = Math.abs(d) < 2 ? targetX : scrollX + d * 0.35; if (scrollX === targetX) targetX = null; keep(); }
      const anim = targetX != null || steps.some((st) => P >= st.s0 && P < Math.max(st.s1, st.s0 + RISE));
      const key = `${Math.round(P * (anim ? 60 : 4))}|${hkey(hover)}|${lit.actorId}|${lit.messageId}|${drag && drag.type}|${pinned}|${Math.round(scrollX)}|${Math.round(scrollTop)}`;
      if (key === lastKey) return; lastKey = key; draw(); api.dirty = true;
    },
    pointer,
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return api; },
    highlight({ actorId = null, messageId = null } = {}) {
      lit = { actorId, messageId }; lastKey = "";
      if (actorId && colOf.get(actorId)) showCols([colOf.get(actorId)]); // someone selected in the room: their column comes into view
      if (messageId && stepOfMsg.get(messageId)) { const st = stepOfMsg.get(messageId); showCols([st.from, ...st.to].map((id) => colOf.get(id)).filter(Boolean)); }
      keep();
    },
    scroll(dx, dy) { scrollBy(dx, dy); }, follow() { pinned = true; lastKey = ""; keep(); },
    // film.js: where on the board an actor (its column, at the now line) is
    locate({ actorId } = {}) { const c = actorId ? colOf.get(actorId) : null; return { u: c ? sx(c.cx) / DW : 0.5, v: NOW_Y / DH }; },
    resetView() {},
    warp: (t) => sim.warp(t), duration: sim.duration,
    dispose() {},
  };
  draw();
  return api;
}
