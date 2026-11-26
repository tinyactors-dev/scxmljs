// head/head.js: what you see inside a person's head. Their statechart, built as machines, for ANY chart.
//
// Grammar (README.md has the full table and the reasons):
//   parallel state  -> a bench: one machine per region (wrapped into rows / tiers when there are many)
//   compound state  -> a machine: a housing on a plinth, with a brass DOOR at the front. In its parent the housing
//                      stands in the row where a pad would be: one state, one thing. Tracks to it end at its door.
//                      Closed: a solid box whose beam carries its name and, in a dark window, its running part.
//                      Opened (detail): glass walls, the parts inside; it GROWS as it opens (the parent makes room).
//   atomic state    -> a station: a pad with an engraved plate and its own lamp (lit = running).
//   initial state   -> the entry ramp: a brass arrow from the door to that pad. A marble that enters rolls along it.
//   final           -> a drain; history -> a notched pad (H, or H* for deep) and a ghost marble remembering
//   transition      -> a track (brass = main line, red = exceptional): an arch with an arrowhead and the event
//                      engraved at its crown; the two directions between two parts are a high and a low arch.
//                      The machine's own transition to a part runs from its door; re-entry -> a loop over the pad;
//                      a state that reacts without moving (targetless) -> a bell beside its pad
//   delayed <send>  -> a clock on a post beside the station that set it; the hand sweeps while it runs
//   <invoke>        -> a speaking tube rising from the pad, ending in a horn: lit while the child lives
//   event arriving  -> a mail capsule comes in at the inlet (top back), flies to the funnel of the machine that
//                      takes it and drops in; only machines that take mail have a funnel
//   variable        -> a gauge on the back rail of the machine that reads it (tube of balls, dial, lever, lamp)
// `room` is an optional room (an attic under the skull's dome) for WORLD to mount; `affordances()` lists the
// events that would move the actor now (for click-driven use); `{interactive: true}` adds push-buttons for them.
// Everything is a pure function of (t, detail, focus): with t fixed, update() changes nothing (the stage
// re-normalisation eases with dt towards a fixed target and then stays). This file imports nothing.

const K0 = 0.5;           // scale of a closed machine inside a machine
const K1 = 0.86;          // ... of an open one (it grows as it opens; the parent makes room)
const GROW_PARTS = 16;    // a parent with more parts than this keeps its machines at K0 (big charts use the stage)
const PAD_W = 1.3;        // slot width of a station
const PAD_ZONE = 1.1;     // depth taken by a pad and its plate
const MARGIN = 0.42;
const ROW_GAP = 0.45;
const SHELF = 0.32;       // exceptional rows stand on a shelf
const PLINTH = 0.3;
const CAP_LEAD = 0.26;    // playback s: capsule in the funnel before the marble starts
const CAP_FLY = 0.55;     // playback s a capsule flies from the inlet
const TRAVEL = 0.38;      // playback s a marble spends on a track
const GLOW = 1.8;         // playback s a taken track keeps glowing
const LAG_SOFT = 0.35, LAG_HARD = 1.6;
const MARBLE_R = 0.14;
const PAD_TOP = 0.12;
const OPEN_LEVELS = 3;
const FAN = 10;           // a part with more tracks than this becomes a hub with a bus
const BIG_STATIONS = 80;  // beyond this many states, only the active path opens by itself, and nothing grows
const PLATE_H = 0.2;      // station plate height (machine units)
const EVENT_H = 0.16;     // event plate height (a line)
const MIN_PLATE = 0.23;   // no plate of an open machine is shorter than this in head units (legible at the entry camera)
const ROOM_FLOOR = -4.6;  // the room's floor (head units)
const INLET = [0, 4.3, -4.6];
// where WORLD's camera is when it enters a head (main.js: enterHead), in head units: dir (0, 0.3, 1), 0.6 / 0.042
const ENTRY = { dist: 0.6 / 0.042, el: Math.atan2(0.3, 1), fov: 42, aspect: 1.45, fillW: 0.9, fillH: 0.72 };

const HUES = [0x4fa39a, 0xd9a93f, 0xd46f62, 0x8a80c6, 0x5f97d4, 0x8db85c, 0xc77bb0, 0x6fb3c9, 0xc98f5a];
const EXC_NAME = /fail|error|offline|backoff|reject|timeout|abort|cancel|^left$|^locked$|^stopped$|crash|dead|broken/i;
const EXC_EVENT_NAME = /(^|\.)(error|fail|failed|timeout|interrupt|cancel|abort|offline|leave|rejected|forget|bye|kill|crash)(\.|$)/i;
const SUCCESS_COND = /\bok\b|success|succeeded/i;
const ERR_COND = /\berror\b|\bfail|\bok\s*===?\s*false|!\s*[\w.]*\bok\b/i;

export function createHead({ THREE, sim, actorId, options = {} }) {
  const V3 = THREE.Vector3;
  const INTERACTIVE = !!options.interactive;
  const warp = typeof sim.warp === "function" ? (t) => sim.warp(t) : (t) => t / 1000;
  const group = new THREE.Group(); group.name = `head:${actorId}`;
  const root = new THREE.Group(); group.add(root);
  const chart = sim.chartOf ? sim.chartOf(actorId) : null;

  // ---------- resources ----------
  const owned = { geos: new Set(), mats: new Set(), texs: new Set(), inst: [] };
  const G = (g) => (owned.geos.add(g), g);
  const M = (m) => (owned.mats.add(m), m);
  const std = (color, o = {}) => M(new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o }));
  function boxesGeometry(list) { // one geometry of several boxes [sx, sy, sz, x, y, z]
    const pos = [], nor = [], idx = []; let base = 0;
    for (const [sx, sy, sz, x, y, z] of list) {
      const b = new THREE.BoxGeometry(sx, sy, sz); b.translate(x, y, z);
      pos.push(...b.attributes.position.array); nor.push(...b.attributes.normal.array); for (const i of b.index.array) idx.push(i + base); base += b.attributes.position.count; b.dispose();
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx); return G(g);
  }
  function mergeGeometries(list) { // indexed geometries: positions and normals
    const pos = [], nor = [], idx = []; let base = 0;
    for (const b of list) { pos.push(...b.attributes.position.array); nor.push(...b.attributes.normal.array); const ix = b.index ? b.index.array : [...Array(b.attributes.position.count).keys()]; for (const i of ix) idx.push(i + base); base += b.attributes.position.count; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx); return g;
  }
  const geo = {
    pad: G(new THREE.CylinderGeometry(0.3, 0.34, PAD_TOP, 20)),
    lamp: G(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 20)),
    marble: G(new THREE.SphereGeometry(MARBLE_R, 20, 14)),
    funnel: G(new THREE.CylinderGeometry(0.24, 0.06, 0.3, 18, 1, true)),
    horn: G(new THREE.CylinderGeometry(0.2, 0.05, 0.3, 14, 1, true)),
    rod: G(new THREE.CylinderGeometry(0.03, 0.03, 1, 8)),
    box: G(new THREE.BoxGeometry(1, 1, 1)),
    ring: G(new THREE.TorusGeometry(0.27, 0.045, 8, 24)),
    hole: G(new THREE.CircleGeometry(0.2, 20)),
    capsule: G(new THREE.CapsuleGeometry(0.1, 0.22, 4, 10)),
    cone: G(new THREE.ConeGeometry(0.085, 0.22, 10)),
    bell: G(new THREE.CylinderGeometry(0.035, 0.11, 0.14, 12, 1, true)),
    ball: G(new THREE.SphereGeometry(0.085, 12, 8)),
    tube: G(new THREE.CylinderGeometry(0.22, 0.22, 1, 18, 1, true)),
    disc: G(new THREE.CircleGeometry(0.4, 32)),
    pulse: G(new THREE.SphereGeometry(0.08, 10, 8)),
    plane: G(new THREE.PlaneGeometry(1, 1)),
    dialBody: G(new THREE.CylinderGeometry(0.5, 0.5, 0.22, 28)),
    // a door: two jambs and a lintel, 0.5 wide, 0.55 tall, standing on y = 0, its face at z = 0
    door: boxesGeometry([[0.06, 0.42, 0.07, -0.2, 0.21, 0], [0.06, 0.42, 0.07, 0.2, 0.21, 0], [0.46, 0.07, 0.07, 0, 0.42, 0]]),
    arrow: (() => { const s = new THREE.Shape(); s.moveTo(-0.13, 0); s.lineTo(0.13, 0); s.lineTo(0, 0.22); s.closePath(); const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); return G(g); })(), // points to -z
  };
  const mat = {
    iron: std(0x3b404c, { roughness: 0.85, metalness: 0.25 }),
    board: std(0x7a5a3e, { roughness: 0.85 }),
    plinth: std(0x2c3039, { roughness: 0.7, metalness: 0.3 }),
    brass: std(0xc9a44c, { roughness: 0.35, metalness: 0.7 }),
    padIM: std(0xffffff, { roughness: 0.55, metalness: 0.4 }),
    drain: std(0x15171c, { roughness: 0.9 }),
    red: std(0xc0463a, { roughness: 0.5, metalness: 0.3 }),
    glass: M(new THREE.MeshStandardMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0, depthWrite: false })),
    capsule: std(0xf6ecd2, { roughness: 0.45, emissive: 0xffd88a, emissiveIntensity: 0.55 }),
    pulse: M(new THREE.MeshBasicMaterial({ color: 0xffd27a })),
    shelf: std(0x4a3528, { roughness: 0.9 }),
    floor: std(0x5b6170, { roughness: 0.8, metalness: 0.2 }),
    funnel: std(0xc9a44c, { roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide }),
    ramp: std(0xd8b45a, { roughness: 0.35, metalness: 0.6, emissive: 0x6a4a10, emissiveIntensity: 0.25, side: THREE.DoubleSide }),
    lampIM: M(new THREE.MeshBasicMaterial({ color: 0xffffff })),
    ghost: M(new THREE.MeshStandardMaterial({ color: 0xbfe6ff, emissive: 0x6fbfff, emissiveIntensity: 0.5, transparent: true, opacity: 0.5, roughness: 0.2, depthWrite: false })),
    none: M(new THREE.MeshBasicMaterial({ visible: false })),
    clockWedge: M(new THREE.MeshBasicMaterial({ color: 0xffa32a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })),
    wood: std(0x8a6442, { roughness: 0.8 }),
    woodDark: std(0x5a3f2a, { roughness: 0.85 }),
    button: std(0xb89040, { roughness: 0.3, metalness: 0.75, emissive: 0xffb84a, emissiveIntensity: 0 }),
  };
  const COL = { padOff: new THREE.Color(0x6a7180), drain: new THREE.Color(0x15171c), lampOff: new THREE.Color(0x2c3038), lampOn: new THREE.Color(0xffcf5a).multiplyScalar(1.6), lampExc: new THREE.Color(0xff5a3c).multiplyScalar(1.6), lampFinal: new THREE.Color(0x7dffb0).multiplyScalar(1.3) };

  // ---------- engraved plates (text only on things) ----------
  const plateCache = new Map(); const plateMeshes = new Set();
  const STYLES = { plate: ["#262a31", "#b89443", "#f4e7c4"], window: ["#14161a", "#5a5f68", "#ffcf6a"], button: ["#c9a44c", "#7a5a1a", "#1d1a14"], event: ["#2d2a24", "#8c7440", "#efe0b8"] };
  function plateTexture(text, style = "plate") {
    const key = style + "|" + text;
    if (plateCache.has(key)) return plateCache.get(key);
    const [bg, rim, ink] = STYLES[style];
    const c = document.createElement("canvas"); const ctx = c.getContext("2d");
    const font = "600 56px ui-monospace, Menlo, Consolas, monospace";
    const lines = wrapText(text, style);
    ctx.font = font; const tw = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)));
    c.width = Math.min(2048, tw + 52); c.height = 84 + 66 * (lines.length - 1);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = rim; ctx.lineWidth = 6; ctx.strokeRect(3, 3, c.width - 6, c.height - 6);
    ctx.font = font; ctx.fillStyle = ink; ctx.textBaseline = "middle"; lines.forEach((l, i) => ctx.fillText(l, 26, 42 + 66 * i + 3));
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; owned.texs.add(tex);
    const r = { tex, aspect: c.width / c.height, lines: lines.length, mat: M(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.2, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: style === "window" ? 0.9 : 0.18, polygonOffset: true, polygonOffsetFactor: -2 })) };
    plateCache.set(key, r); return r;
  }
  // long names go on two lines, broken after a dot, dash or space near the middle (state and event plates)
  function wrapText(text, style) {
    if (text.length <= 13 || (style !== "plate" && style !== "event")) return [text];
    let best = -1; for (let i = 1; i < text.length - 1; i++) if (/[.\-_ /]/.test(text[i]) && (best < 0 || Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2))) best = i;
    if (best < 3 || best > text.length - 3) return [text];
    const cut = text[best] === " " ? [text.slice(0, best), text.slice(best + 1)] : [text.slice(0, best + 1), text.slice(best + 1)];
    return cut;
  }
  // a plate: h is its height in its parent's units, maxW its widest; m (a machine) scales it up when the machine is small
  function plate(text, h, maxW = Infinity, info = {}) {
    const { aspect, mat: pm, lines } = plateTexture(text, info.style);
    const mesh = new THREE.Mesh(geo.plane, pm);
    mesh.userData.plate = { text, h: h * (1 + 0.78 * (lines - 1)), maxW, aspect, kind: info.kind || "state", m: info.m || null, comp: info.comp !== false };
    sizePlate(mesh, 1); plateMeshes.add(mesh); return mesh;
  }
  function sizePlate(mesh, comp) {
    const p = mesh.userData.plate; let h = p.h * (p.comp ? (p.kind === "event" ? Math.min(comp, 1.4) : comp) : 1); let w = h * p.aspect;
    if (w > p.maxW) { h *= p.maxW / w; w = p.maxW; }
    mesh.scale.set(w, h, 1); p.w = w; p.hh = h; return w;
  }

  // ---------- chart helpers ----------
  const parentOf = new Map(), nodeById = new Map();
  function index(n, p) { nodeById.set(n.id, n); if (p) parentOf.set(n.id, p); for (const c of n.children || []) index(c, n); }
  const kids = (n) => (n && n.children) || [];
  const has = (n) => kids(n).some((c) => c.kind !== "history");
  function childContaining(node, id) { let x = nodeById.get(id); while (x && parentOf.get(x.id) !== node) x = parentOf.get(x.id); return x || null; }
  function walk(n, f) { f(n); for (const c of kids(n)) walk(c, f); }
  function isDesc(n, anc) { for (let x = n; x; x = parentOf.get(x.id)) if (x === anc) return true; return false; }
  function matches(desc, name) {
    if (!desc || !name) return false;
    return desc.split(/\s+/).some((d) => d === "*" || d === name || (d.endsWith(".*") ? name.startsWith(d.slice(0, -1)) : name.startsWith(d + ".")));
  }
  const initialOf = (node) => { const i = node.initial && node.initial[0]; const c = i && childContaining(node, i); return (c && c.id) || (kids(node).find((c) => c.kind !== "history") || kids(node)[0]).id; };
  const timerEvents = new Set();
  function scanActions(list) { for (const a of list || []) { if (a.type === "send" && (a.delay || a.delayexpr) && a.event) timerEvents.add(a.event); if (a.then) scanActions(a.then); if (a.else) scanActions(a.else); if (a.body) scanActions(a.body); } }
  function transClass(tr, src) {
    const evs = (tr.event || "").split(/\s+/).filter(Boolean);
    if (evs.some((e) => e === "error" || e.startsWith("error."))) return "error";
    if (tr.cond && ERR_COND.test(tr.cond)) return "error";
    if (!tr.cond && evs.length && (src.transitions || []).some((o) => o !== tr && o.event === tr.event && o.cond && SUCCESS_COND.test(o.cond) && !ERR_COND.test(o.cond))) return "error";
    if (evs.length && evs.every((e) => timerEvents.has(e)) && (src.transitions || []).some((o) => o !== tr && o.event && !o.event.split(/\s+/).every((e) => timerEvents.has(e)))) return "timeout";
    return "normal";
  }
  // what a track says: its events, else its guard (an eventless transition), else "auto"
  function shortCond(c) { c = String(c).replace(/\s+/g, " ").replace(/['"]/g, "").trim(); return c.length > 18 ? c.slice(0, 17) + "…" : c; }

  const actorRec = sim.actor ? sim.actor(actorId) : null;
  const rootLabel = (actorRec && actorRec.chart) || (chart && chart.source ? chart.source.replace(/^.*\//, "").replace(/\.scxml$/, "") : "chart");

  // ---------- model ----------
  const machines = [];          // housed records (machine, solo), parents before children
  const recs = [];              // every record, benches too, parents before children
  const machById = new Map();   // state id -> record
  const stations = new Map();   // state id -> station (a pad, or a compound's door in its parent)
  const pickables = [];
  let maxLevel = 1;

  function siblingEdges(node) {
    const out = [];
    const add = (a, b, tr, x, global) => out.push({ a, b, ev: tr.event || "", cond: tr.cond || "", cls: transClass(tr, x), global, src: x.id });
    for (const tr of node.transitions || []) for (const tg of tr.targets || []) { const cb = childContaining(node, tg); if (cb) add("*", cb.id, tr, node, true); }
    for (const c of kids(node)) walk(c, (x) => {
      for (const tr of x.transitions || []) for (const tg of tr.targets || []) {
        const cb = childContaining(node, tg); if (!cb) continue;
        if (cb !== c) add(c.id, cb.id, tr, x, false); else if (tg === c.id) add(c.id, c.id, tr, x, false);
      }
    });
    return out;
  }
  function classify(node, raw) {
    const init = initialOf(node);
    const isHist = (id) => { const n = nodeById.get(id); return n && n.kind === "history"; };
    const main = new Set([init]); const q = [init];
    while (q.length) { const a = q.shift(); for (const e of raw) if (e.cls === "normal" && (e.a === a || e.global) && !main.has(e.b) && !isHist(e.b)) { main.add(e.b); q.push(e.b); } }
    const reached = new Set(raw.map((e) => e.b));
    const exc = new Set();
    for (const c of kids(node)) { if (main.has(c.id) || c.kind === "history") continue; if (reached.has(c.id) || EXC_NAME.test(c.id)) exc.add(c.id); }
    const order = [init]; const seen = new Set(order); const q2 = [init];
    while (q2.length) { const a = q2.shift(); for (const e of raw) if (!e.global && e.cls === "normal" && e.a === a && !seen.has(e.b) && !exc.has(e.b) && !isHist(e.b)) { seen.add(e.b); order.push(e.b); q2.push(e.b); } }
    for (const e of raw) if (e.global && !seen.has(e.b) && !exc.has(e.b) && !isHist(e.b)) { seen.add(e.b); order.push(e.b); }
    for (const c of kids(node)) if (!seen.has(c.id) && !exc.has(c.id) && c.kind !== "history") { seen.add(c.id); order.push(c.id); }
    const rank = new Map(order.map((id, i) => [id, i]));
    const merged = new Map();
    for (const e of raw) {
      const back = e.a !== "*" && e.a !== e.b && rank.has(e.a) && rank.has(e.b) && rank.get(e.b) < rank.get(e.a);
      const isExc = e.cls !== "normal" || exc.has(e.a) || exc.has(e.b) || (back && e.ev.split(/\s+/).some((x) => EXC_EVENT_NAME.test(x)));
      const key = `${e.a}|${e.b}|${isExc ? 1 : 0}`;
      let m = merged.get(key); if (!m) { m = { a: e.a, b: e.b, key, exc: isExc, global: e.global, events: [], conds: [], srcs: new Set(), classes: new Set() }; merged.set(key, m); }
      if (e.ev) m.events.push(e.ev); else m.conds.push(e.cond); m.srcs.add(e.src); m.classes.add(e.cls);
    }
    const hist = kids(node).filter((c) => c.kind === "history");
    return { main: order.map((id) => nodeById.get(id)), back: kids(node).filter((c) => exc.has(c.id)), hist, edges: [...merged.values()], exc };
  }
  function edgeLabel(e) {
    const evs = [...new Set(e.events.flatMap((x) => x.split(/\s+/)).filter(Boolean))];
    const c = e.conds.find(Boolean); const g = e.conds.length ? (c ? `[${shortCond(c)}]` : "auto") : "";
    if (evs.length) return (evs.length > 2 ? `${evs.slice(0, 2).join(" ")} +${evs.length - 2}` : evs.join(" ")) + (g ? ` / ${g}` : "");
    return g || "auto";
  }

  function newRecord(kind, node, level, hue, parent) {
    const m = { kind, node, id: node.id, level, hue, parent, children: [], pads: new Map(), padList: [], trackByKey: new Map(), tracks: [], arcs: new Map(), moves: [], moveStarts: [], hopperKicks: [], open: 1, k: 1, plates: [] };
    m.group = new THREE.Group(); m.chrome = new THREE.Group(); m.interior = new THREE.Group(); m.own = new THREE.Group();
    m.group.add(m.chrome); m.group.add(m.interior); m.interior.add(m.own);
    maxLevel = Math.max(maxLevel, level); recs.push(m);
    return m;
  }
  function shade(hex, level, i = 0) { const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl); c.setHSL((hsl.h + 0.035 * level + 0.02 * i) % 1, Math.max(0.25, hsl.s - 0.06 * level), Math.min(0.78, hsl.l + 0.07 * level)); return c.getHex(); }
  function wrapRows(slots, targetW, wOf) {
    const rows = []; let cur = [], w = 0;
    for (const s of slots) { const sw = wOf(s); if (cur.length && w + sw > targetW) { rows.push(cur); cur = []; w = 0; } cur.push(s); w += sw; }
    if (cur.length) rows.push(cur); return rows;
  }

  // ---------- layout (re-run whenever a machine inside another grows) ----------
  const slotW = (s) => (s.sub ? s.sub.size.w * s.sub.k + 0.5 : PAD_W);
  const slotD = (s) => (s.sub ? s.sub.size.d * s.sub.k + 0.3 : PAD_ZONE);
  const slotH = (s) => (s.sub ? s.sub.size.h * s.sub.k : 0);
  const rowW = (r) => r.reduce((a, s) => a + slotW(s), 0);
  const rowD = (r) => Math.max(PAD_ZONE, ...r.map(slotD));
  function layoutMachine(m) {
    if (m.kind === "solo") {
      const w = PAD_W + 2 * MARGIN, d = PAD_ZONE + 2 * MARGIN, H = 1.5;
      Object.assign(m, { size: { w, d, h: H + 0.9 }, H });
      m.padList[0].pos.set(0, 0, d / 2 - MARGIN - 0.48); m.doorX = null; return;
    }
    const rows = m.rowsSpec;
    const innerW = Math.max(1.6, ...rows.map((x) => rowW(x.r)));
    const w = innerW + 2 * MARGIN, d = rows.reduce((a, x) => a + rowD(x.r), 0) + ROW_GAP * (rows.length - 1) + 2 * MARGIN;
    const innerH = Math.max(1.5, ...rows.map((x) => Math.max(0, ...x.r.map(slotH)) + 0.35 + (x.shelf ? SHELF : 0)));
    const H = innerH + 0.35;
    let zf = d / 2 - MARGIN; m.shelfBoxes = [];
    for (const { r, shelf } of rows) {
      const y = shelf ? SHELF : 0, rd = rowD(r);
      if (shelf) m.shelfBoxes.push({ w: rowW(r) + 0.2, d: rd, z: zf - rd / 2 });
      let x = -rowW(r) / 2;
      for (const s of r) {
        const sw = slotW(s), cx = x + sw / 2, st = m.pads.get(s.c.id);
        if (s.sub) {
          const front = zf - 0.15, k = s.sub.k;
          s.sub.group.scale.setScalar(k); s.sub.group.position.set(cx, y, front - (s.sub.size.d * k) / 2);
          st.pos.set(cx + (s.sub.doorX ?? 0) * k, y, front); st.door = true; st.subK = k;
        } else st.pos.set(cx, y, zf - 0.48);
        x += sw;
      }
      zf -= rd + ROW_GAP;
    }
    Object.assign(m, { size: { w, d, h: H + 0.9 }, H });
    // the door: on the front wall, left of the initial part, so the entry ramp passes beside its plate
    const ini = m.pads.get(m.initialId);
    m.doorX = ini ? Math.max(-w / 2 + MARGIN, ini.pos.x - (ini.door ? 0 : 0.66)) : 0;
  }
  function layoutBench(b) {
    const GAP = 0.6, subs = b.children;
    const rw = (r) => r.reduce((s, x) => s + x.size.w * x.k, 0) + GAP * Math.max(0, r.length - 1);
    let z = 0, y = 0, W = 0; const steps = [];
    b.rowsSpec.forEach((row, ri) => {
      const rd = Math.max(...row.map((s) => s.size.d * s.k));
      let x = -rw(row) / 2;
      for (const s of row) { s.group.scale.setScalar(s.k); s.group.position.set(x + (s.size.w * s.k) / 2, y + PLINTH, z - rd / 2); x += s.size.w * s.k + GAP; }
      if (ri > 0 && y > 0) steps.push({ z, rd, y });
      W = Math.max(W, rw(row));
      z -= rd + 0.6; y += b.top ? 1.0 : 0.3;
    });
    const D = -z - 0.6;
    b.boardSpec = { W, D, steps };
    b.interior.position.z = D / 2; b.chrome.position.z = D / 2;
    b.size = { w: W + 0.8, d: D + 0.8, h: Math.max(...subs.map((s) => (s.size.h * s.k) + s.group.position.y)) };
    // a bench in a machine is entered at its first region's door
    const f = subs[0]; b.doorX = f && f.doorX != null ? f.group.position.x + f.doorX * f.k : 0;
  }
  function layoutAll() { for (let i = recs.length - 1; i >= 0; i--) { const r = recs[i]; if (r.kind === "bench") layoutBench(r); else layoutMachine(r); } }

  function buildMachine(node, level, hue, parent) {
    const m = newRecord("machine", node, level, hue, parent); machines.push(m); machById.set(node.id, m);
    const raw = siblingEdges(node); const cl = classify(node, raw);
    m.edges = cl.edges; m.exc = cl.exc; m.initialId = initialOf(node);
    let ci = 0;
    const slot = (c) => {
      if (has(c)) {
        const sub = c.kind === "parallel" ? buildBench(c, level + 1, shade(hue, 1, ci++), m) : buildMachine(c, level + 1, shade(hue, 1, ci++), m);
        sub.k = K0; m.children.push(sub); sub.padOf = c.id; m.interior.add(sub.group);
        return { c, sub };
      }
      return { c };
    };
    const mainS = cl.main.map(slot), backS = [...cl.back, ...cl.hist].map(slot);
    const seqOf = new Map([...cl.main, ...cl.back, ...cl.hist].map((c, i) => [c.id, i]));
    const all = [...mainS, ...backS];
    const area = all.reduce((s, x) => s + slotW(x) * slotD(x), 0);
    const targetW = mainS.length <= 6 ? Infinity : Math.max(4.2, ...all.map(slotW), Math.sqrt(area) * 1.5);
    const mainRows = wrapRows(mainS, targetW, slotW).map((r, i) => (i % 2 ? r.slice().reverse() : r));
    const backRows = backS.length ? wrapRows(backS, targetW, slotW) : [];
    m.rowsSpec = [...mainRows.map((r) => ({ r, shelf: false })), ...backRows.map((r) => ({ r, shelf: true }))];
    for (const s of all) addStation(m, s.c, { initial: s.c.id === m.initialId, exc: cl.exc.has(s.c.id), sub: s.sub }).seq = seqOf.get(s.c.id);
    m.parts = all.length; m.label = node.id === "__root__" ? rootLabel : node.id;
    m.lampOrder = [...cl.main, ...cl.back];
    if (cl.hist.length) { m.histPad = m.pads.get(cl.hist[0].id); m.histDeep = cl.hist.some((h) => h.type === "deep" || h.history === "deep"); }
    layoutMachine(m);
    return m;
  }
  function buildSolo(node, level, hue, parent) {
    const m = newRecord("solo", node, level, hue, parent); machines.push(m); machById.set(node.id, m);
    m.exc = new Set(); m.edges = []; m.parts = 1; m.label = node.id; m.lampOrder = [node]; m.shelfBoxes = [];
    addStation(m, node, {});
    if ((node.transitions || []).some((tr) => (tr.targets || []).includes(node.id))) m.edges = [{ a: node.id, b: node.id, key: `${node.id}|${node.id}|0`, exc: false, events: (node.transitions || []).filter((tr) => (tr.targets || []).includes(node.id)).map((tr) => tr.event || "").filter(Boolean), conds: [], srcs: new Set([node.id]) }];
    layoutMachine(m);
    return m;
  }
  function buildBench(node, level, hue, parent, top = false) {
    const b = newRecord("bench", node, level, hue, parent); machById.set(node.id, b); b.top = top;
    const subs = kids(node).filter((c) => c.kind !== "history").map((c, i) => {
      const h = top ? HUES[i % HUES.length] : shade(hue, 0, i + 1);
      const s = has(c) ? (c.kind === "parallel" ? buildBench(c, level, h, b) : buildMachine(c, level, h, b)) : buildSolo(c, level, h, b);
      s.k = 1; b.interior.add(s.group); return s;
    });
    b.children = subs;
    const GAP = 0.6;
    const rw = (r) => r.reduce((s, x) => s + x.size.w, 0) + GAP * Math.max(0, r.length - 1);
    const area = subs.reduce((s, x) => s + x.size.w * x.size.d, 0);
    let rows;
    if (top && subs.length >= 3 && subs.length <= 6 && rw(subs) > 3.2 * Math.max(...subs.map((s) => s.size.d))) {
      const big = subs.reduce((a, s) => (s.size.w * s.size.d > a.size.w * a.size.d ? s : a));
      let front = [big], backR = subs.filter((s) => s !== big);
      while (backR.length > 1 && rw(backR) > rw(front) * 1.25) { const s = backR.reduce((a, x) => (x.size.w < a.size.w ? x : a)); backR = backR.filter((x) => x !== s); front.push(s); front.sort((a, c) => subs.indexOf(a) - subs.indexOf(c)); }
      rows = [front, backR];
    } else {
      const target = subs.length <= 3 ? Infinity : Math.max(...subs.map((s) => s.size.w), Math.sqrt(area) * (top ? 1.6 : 2.2));
      rows = []; let cur = [];
      for (const s of subs) { if (cur.length && rw([...cur, s]) > target) { rows.push(cur); cur = []; } cur.push(s); }
      if (cur.length) rows.push(cur);
    }
    b.rowsSpec = rows;
    layoutBench(b);
    return b;
  }
  function addStation(m, node, flags) { // its place comes from the layout; its meshes when its machine first opens
    const st = { m, node, pos: new V3(), kicks: [], index: m.padList.length, exc: !!flags.exc, initial: !!flags.initial, final: node.kind === "final", hist: node.kind === "history", sub: flags.sub || null, door: !!flags.sub };
    stations.set(node.id, st); m.pads.set(node.id, st); m.padList.push(st); return st;
  }

  // ---------- housings ----------
  function scaleOf(m) { let k = 1; for (let x = m; x; x = x.parent) k *= x.k; return k * xf.s; } // head units per machine unit
  // a housing in two steps: "lite" (a closed box: plinth, walls with their top, the beam with name and window) when its
  // parent first opens; "full" (floor, frame, lid, door, funnel) when it starts to open itself
  function housing(m) {
    const color = new THREE.Color(m.hue); const C = m.chrome;
    m.baseColor = color.clone();
    m.plinth = new THREE.Mesh(geo.box, mat.plinth); C.add(m.plinth); m.plinth.userData.pick = { kind: "state", id: m.id }; pickables.push(m.plinth);
    m.wallMat = M(new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, transparent: true, opacity: 1 }));
    m.lidMat = M(new THREE.MeshStandardMaterial({ color: color.clone(), roughness: 0.55, metalness: 0.15, transparent: true, opacity: 1 }));
    m.edgeMat = M(new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), roughness: 0.5, metalness: 0.3, emissive: 0xffc35a, emissiveIntensity: 0 }));
    m.walls = new THREE.Mesh(geo.box, [m.wallMat, m.wallMat, m.lidMat, mat.none, m.wallMat, m.wallMat]); C.add(m.walls);
    m.walls.userData.pick = { kind: "state", id: m.id }; pickables.push(m.walls);
    m.beamG = new THREE.Group(); C.add(m.beamG);
    m.beam = new THREE.Mesh(geo.box, m.edgeMat); m.beamG.add(m.beam); m.beam.userData.pick = { kind: "state", id: m.id }; pickables.push(m.beam);
    m.namePlate = plate(m.label, 1, Infinity, { kind: "machine", m, comp: false }); m.beamG.add(m.namePlate);
    if (m.level === 1 && actorRec && actorRec.incarnation > 1) { m.incPlate = plate(`#${actorRec.incarnation}`, 1, Infinity, { kind: "machine", m, comp: false }); m.beamG.add(m.incPlate); }
    if (m.kind === "machine") { m.window = new THREE.Mesh(geo.plane, mat.none); m.window.visible = false; m.beamG.add(m.window); m.windowText = null; }
    if (m.receives) addFunnel(m);
    m.hopper = new THREE.Object3D(); C.add(m.hopper);
    if (m.doorX != null && !big) addDoor(m);
    fitChrome(m);
  }
  function addFunnel(m) { // a funnel on a short chute into the roof: mail arrives here
    m.chute = new THREE.Mesh(geo.rod, mat.brass); m.chute.scale.set(2.2, 0.4, 2.2); m.chrome.add(m.chute);
    m.funnel = new THREE.Mesh(geo.funnel, mat.funnel); m.chrome.add(m.funnel);
  }
  function addDoor(m) { // the door: lit while the marble is in here (a big chart's closed machines have none)
    if (m.doorMesh) return; const C = m.chrome;
    {
      m.doorMat = M(new THREE.MeshStandardMaterial({ color: 0xc9a44c, roughness: 0.35, metalness: 0.7, emissive: 0xffc35a, emissiveIntensity: 0 }));
      m.doorMesh = new THREE.Mesh(geo.door, m.doorMat); C.add(m.doorMesh); m.doorMesh.userData.pick = { kind: "state", id: m.id }; pickables.push(m.doorMesh);
    }
    fitChrome(m);
  }
  function housingFull(m) {
    if (m.full) return; m.full = true;
    const C = m.chrome;
    m.walls.material = [m.wallMat, m.wallMat, mat.none, mat.none, m.wallMat, m.wallMat];
    m.floorMesh = new THREE.Mesh(geo.box, mat.floor); C.add(m.floorMesh);
    m.frame = new THREE.Mesh(geo.plane, m.edgeMat); C.add(m.frame); // four posts and three rails, one geometry
    m.lid = new THREE.Mesh(geo.box, [mat.none, mat.none, m.lidMat, mat.none, mat.none, mat.none]); C.add(m.lid);
    m.lid.userData.pick = { kind: "state", id: m.id }; pickables.push(m.lid);
    if (m.doorX != null) addDoor(m);
    fitChrome(m);
  }
  function fitChrome(m) { // everything of the housing from its current size
    const { w, d } = m.size, H = m.H;
    const BEAM = Math.min(0.5, 0.22 + 0.03 * w); m.BEAM = BEAM;
    m.plinth.scale.set(w, PLINTH, d); m.plinth.position.y = -PLINTH / 2;
    m.walls.scale.set(w, H, d); m.walls.position.y = H / 2;
    m.beamY = [H - BEAM / 2 + 0.045, m.level === 1 ? -BEAM / 2 - 0.02 : H - BEAM / 2 + 0.045]; // open: a region's beam hangs on its plinth's face; a nested machine's stays up, over its parent's floor
    m.beamG.position.set(0, m.beamG.position.y || m.beamY[0], d / 2 - 0.02);
    m.beam.scale.set(w, BEAM, 0.12);
    const pw = sizePlateH(m.namePlate, BEAM * 0.66, w * 0.5); m.namePlate.position.set(-w / 2 + 0.12 + pw / 2, 0, 0.065);
    if (m.incPlate) { const tw = sizePlateH(m.incPlate, BEAM * 0.66, w * 0.2); m.incPlate.position.set(-w / 2 + 0.22 + pw + tw / 2, 0, 0.065); }
    if (m.window && m.window.userData.plate) { const ww = sizePlateH(m.window, BEAM * 0.66, w * 0.42); m.window.position.set(w / 2 - 0.12 - ww / 2, 0, 0.065); }
    const hx = -w / 2 + 0.38, hz = -d / 2 + 0.38;
    if (m.funnel) { m.chute.position.set(hx, H + 0.2, hz); m.funnel.position.set(hx, H + 0.52, hz); }
    m.hopper.position.set(hx, H + 0.6, hz);
    if (m.full) {
      m.floorMesh.scale.set(w - 0.12, 0.02, d - 0.12);
      const key = `${w.toFixed(3)},${d.toFixed(3)},${H.toFixed(3)}`;
      if (m.frameKey !== key) {
        m.frameKey = key; if (m.frame.geometry !== geo.plane) { m.frame.geometry.dispose(); owned.geos.delete(m.frame.geometry); }
        const list = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [0.09, H, 0.09, sx * (w / 2 - 0.02), H / 2, sz * (d / 2 - 0.02)]);
        for (const [sx, sz] of [[0, -1], [-1, 0], [1, 0]]) list.push([sx ? 0.09 : w, 0.09, sx ? d : 0.09, sx * (w / 2 - 0.02), H, sz * (d / 2 - 0.02)]);
        m.frame.geometry = boxesGeometry(list);
      }
      m.lid.scale.set(w, 0.02, d); m.lid.position.set(0, H + 0.03, 0);
    }
    if (m.doorMesh) m.doorMesh.position.set(m.doorX, 0, d / 2 + 0.01);
    for (const g of m.gaugeList || []) placeGauge(m, g);
  }
  function sizePlateH(mesh, h, maxW) { const p = mesh.userData.plate; p.h = h; p.maxW = maxW; return sizePlate(mesh, 1); }

  // ---------- stations ----------
  function stationMeshes(st) {
    const { m, node } = st;
    const g = new THREE.Group(); g.position.copy(st.pos); m.own.add(g); st.group = g;
    if (st.final) {
      const ring = new THREE.Mesh(geo.ring, mat.brass); ring.rotation.x = Math.PI / 2; ring.position.y = PAD_TOP + 0.01; g.add(ring);
      const hole = new THREE.Mesh(geo.hole, mat.drain); hole.rotation.x = -Math.PI / 2; hole.position.y = PAD_TOP + 0.012; g.add(hole);
    }
    if (st.hist) {
      const notch = new THREE.Mesh(geo.box, mat.brass); notch.scale.set(0.12, 0.22, 0.34); notch.position.set(0.34, 0.11, 0); g.add(notch);
      const deep = node.type === "deep" || node.history === "deep" || node.deep === true;
      const hp = plate(deep ? "H*" : "H", 0.16, Infinity, { m, comp: false, kind: "mark" }); hp.position.set(0, PAD_TOP + 0.02, 0); hp.rotation.x = -Math.PI / 2; g.add(hp);
    }
    const side = st.door ? -0.45 : 0.4; // things beside a door go to its left (the housing is behind it)
    if ((node.transitions || []).some((tr) => !(tr.targets || []).length && tr.event)) { // a bell: it reacts without moving
      const br = new THREE.Mesh(geo.rod, mat.brass); br.scale.set(0.7, 0.5, 0.7); br.position.set(side, 0.25, -0.18); g.add(br);
      st.bell = new THREE.Mesh(geo.bell, mat.funnel); st.bell.position.set(side, 0.45, -0.18); g.add(st.bell);
    }
    if ((node.invokes || []).length) { // a speaking tube: up from the pad and out over the housing, ending in a horn
      const top = (m.H || 1.5) + 0.9;
      const curve = new THREE.CatmullRomCurve3([new V3(-0.28, 0.06, 0.12), new V3(-0.42, 0.5, 0.05), new V3(-0.42, top - 0.3, -0.1), new V3(-0.2, top, -0.25)]);
      st.tubeMat = std(0x3f8f6a, { roughness: 0.4, metalness: 0.5, emissive: 0x5dffb0, emissiveIntensity: 0 });
      const tube = new THREE.Mesh(G(new THREE.TubeGeometry(curve, 20, 0.045, 6, false)), st.tubeMat); g.add(tube);
      const horn = new THREE.Mesh(geo.horn, st.tubeMat); horn.position.copy(curve.getPoint(1)); horn.rotation.z = Math.PI / 2 + 0.4; horn.rotation.y = 0.6; g.add(horn);
      tube.userData.pick = { kind: "state", id: node.id }; pickables.push(tube);
      st.outlet = new THREE.Object3D(); st.outlet.position.copy(curve.getPoint(1)).add(new V3(0.15, 0.08, -0.05)); g.add(st.outlet);
    }
    if (!st.door) { // the name, on the floor in front of the pad, tilted up to the viewer
      const p = plate(node.id, PLATE_H, st.initial ? 0.98 : 1.16, { m }); p.position.set(st.initial ? 0.07 : 0, 0.03 + 0.37 * p.userData.plate.hh, 0.47); p.rotation.x = -0.75; g.add(p); st.plate = p;
    }
    if (st.timers) addClock(st, g);
  }
  function addClock(st, g) { // a clock on a post beside the station: its face to the viewer; the hand and an amber wedge sweep from set to due
    const node = st.node; {
      const cx = st.door ? -0.55 : 0.5, cz = st.door ? 0.12 : 0.05;
      const post = new THREE.Mesh(geo.rod, mat.brass); post.scale.set(0.9, 0.42, 0.9); post.position.set(cx, 0.21, cz); g.add(post);
      st.clock = new THREE.Group(); st.clock.position.set(cx, 0.6, cz); st.clock.rotation.x = -0.25; g.add(st.clock);
      const body = new THREE.Mesh(geo.dialBody, mat.brass); body.rotation.x = Math.PI / 2; body.scale.set(0.42, 0.45, 0.42); body.position.z = -0.05; st.clock.add(body);
      st.clockFace = M(new THREE.MeshStandardMaterial({ map: clockTexture(st), roughness: 0.6, emissive: 0xfff2c8, emissiveIntensity: 0.15 }));
      const face = new THREE.Mesh(geo.disc, st.clockFace); face.scale.setScalar(0.49); st.clock.add(face);
      st.hand = new THREE.Group(); st.hand.position.z = 0.012; st.clock.add(st.hand);
      const hand = new THREE.Mesh(geo.box, mat.red); hand.scale.set(0.022, 0.15, 0.01); hand.position.y = 0.075; st.hand.add(hand);
      st.clockWedge = new THREE.Mesh(G(new THREE.CircleGeometry(0.16, 24, Math.PI / 2, 0.001)), mat.clockWedge); st.clockWedge.position.z = 0.008; st.clock.add(st.clockWedge);
      body.userData.pick = { kind: "state", id: node.id }; pickables.push(body);
    }
  }
  function clockTexture(st) { // a readable face: twelve ticks, and the delay it counts
    const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d");
    x.fillStyle = "#f2ead2"; x.beginPath(); x.arc(128, 128, 126, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "#2b2622"; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; x.lineWidth = i % 3 ? 5 : 10; x.beginPath(); x.moveTo(128 + Math.sin(a) * 96, 128 - Math.cos(a) * 96); x.lineTo(128 + Math.sin(a) * 120, 128 - Math.cos(a) * 120); x.stroke(); }
    const d = Math.max(...st.timers.map((t) => t.delay)); const txt = d >= 60000 ? `${Math.round(d / 60000)}m` : d >= 1000 ? `${+(d / 1000).toFixed(1)}s` : `${Math.round(d)}ms`;
    x.fillStyle = "#2b2622"; x.font = "700 54px ui-monospace, Menlo, monospace"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(txt, 128, 182);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; owned.texs.add(tex); return tex;
  }
  function finishStations(m) { // pad bases and their lamps: two InstancedMeshes per machine (compounds have their door instead)
    const list = m.padList.filter((st) => !st.door); m.padsIM = list; if (!list.length) return;
    m.bases = new THREE.InstancedMesh(geo.pad, mat.padIM, list.length); m.lampIM = new THREE.InstancedMesh(geo.lamp, mat.lampIM, list.length);
    list.forEach((st, i) => { st.inst = i; m.bases.setColorAt(i, st.final ? COL.drain : COL.padOff); m.lampIM.setColorAt(i, COL.lampOff); });
    placePads(m);
    m.own.add(m.bases); m.own.add(m.lampIM); owned.inst.push(m.bases, m.lampIM);
    m.bases.userData.pickIds = list.map((s) => s.node.id); m.bases.userData.pick = { kind: "state" }; pickables.push(m.bases);
    m.lampLit = null;
  }
  const _o = new THREE.Object3D();
  function placePads(m) {
    if (!m.bases) return;
    m.padsIM.forEach((st, i) => {
      _o.scale.setScalar(1); _o.position.copy(st.pos).add(new V3(0, PAD_TOP / 2, 0)); _o.updateMatrix(); m.bases.setMatrixAt(i, _o.matrix);
      _o.position.copy(st.pos).add(new V3(0, PAD_TOP + 0.01, 0)); _o.scale.setScalar(st.final ? 0.001 : 1); _o.updateMatrix(); m.lampIM.setMatrixAt(i, _o.matrix);
    });
    m.bases.instanceMatrix.needsUpdate = true; m.lampIM.instanceMatrix.needsUpdate = true;
    m.bases.computeBoundingSphere(); m.lampIM.computeBoundingSphere();
  }

  // ---------- tracks ----------
  function anchor(m, id) { const st = m.pads.get(id); return st.pos.clone().add(new V3(0, st.door ? 0.06 : PAD_TOP + 0.04, 0)); }
  function doorPoint(m) { return new V3(m.doorX ?? 0, 0.05, m.size.d / 2 - 0.12); }
  // the start of a track that leaves a compound from one part inside it: that part's pad, in m's units
  function innerStart(m, e) {
    if (e.a === "*" || e.srcs.size !== 1) return null; const src = [...e.srcs][0]; const sub = m.pads.get(e.a)?.sub;
    if (!sub || src === e.a || sub.kind !== "machine" || !sub.pads.has(src) || sub.pads.get(src).door) return null;
    const p = sub.pads.get(src).pos; const k = sub.k;
    return { p: new V3(sub.group.position.x + p.x * k, sub.group.position.y + (p.y + PAD_TOP + 0.04) * k, sub.group.position.z + p.z * k), up: sub.H * k + 0.35 };
  }
  const LANES = [{ h: 1.3, z: -0.1 }, { h: 0.5, z: 0.2 }, { h: 1.75, z: -0.28 }, { h: 0.3, z: 0.34 }];
  function trackCurve(tr) {
    const m = tr.m, e = tr.edge;
    if (tr.kind === "loop") { const p = m.pads.get(e.a).pos.clone().add(new V3(0, PAD_TOP + 0.04, tr.exc ? -0.12 : 0)); const pts = [[0, 0, 0], [0.18, 0.1, 0.05], [0.3, 0.38, 0.05], [0.14, 0.66, 0.02], [-0.14, 0.66, -0.02], [-0.3, 0.38, -0.05], [-0.18, 0.1, -0.05], [0, 0, 0]].map(([x, y, z]) => p.clone().add(new V3(x, y, z))); return new THREE.CatmullRomCurve3(pts, false, "centripetal"); }
    const p3 = anchor(m, e.b);
    if (tr.kind === "door") { const p0 = doorPoint(m); const h = 0.45 + 0.1 * p0.distanceTo(p3); return new THREE.CubicBezierCurve3(p0, p0.clone().add(new V3(0, h, -0.15)), p3.clone().add(new V3(0, h, 0.15)), p3); }
    const lane = LANES[Math.min(LANES.length - 1, tr.lane)];
    const inner = innerStart(m, e);
    const p0 = inner ? inner.p : anchor(m, e.a);
    const v = p3.clone().sub(p0); const dist = Math.hypot(v.x, v.z);
    const h = Math.min(1.7, (0.32 + 0.2 * dist)) * lane.h;
    const off = new V3(0, 0, lane.z);
    if (inner) { const top = Math.max(inner.up, p3.y + h); return new THREE.CubicBezierCurve3(p0, p0.clone().add(new V3(0, top - p0.y + 0.3, 0)), p3.clone().add(new V3(0, top - p3.y, 0)).add(off), p3); }
    return new THREE.CubicBezierCurve3(p0, p0.clone().addScaledVector(v, 0.18).add(off).add(new V3(0, h * 1.33, 0)), p0.clone().addScaledVector(v, 0.82).add(off).add(new V3(0, h * 1.33, 0)), p3);
  }
  function addTrack(m, edge, kind, lane = 0) {
    const exc = edge.exc;
    const baseCol = new THREE.Color(exc ? 0xc0463a : 0xc9a44c);
    const tm = M(new THREE.MeshStandardMaterial({ color: baseCol.clone(), emissive: exc ? 0xff4a30 : 0xffb84a, emissiveIntensity: 0, roughness: 0.38, metalness: 0.6 }));
    const mesh = new THREE.Mesh(geo.plane, tm); m.own.add(mesh);
    const tr = { m, key: edge.key, edge, kind, lane, mesh, mat: tm, baseCol, exc, chute: kind === "door", firstTaken: Infinity, buttons: [] };
    mesh.userData.pick = { kind: "transition", id: `${m.id}:${edge.a}->${edge.b}` }; pickables.push(mesh);
    tr.plate = plate(edgeLabel(edge), EVENT_H, 1.4, { m, kind: "event", style: "event" }); m.own.add(tr.plate);
    if (INTERACTIVE) addButtons(tr);
    m.trackByKey.set(edge.key, tr); m.tracks.push(tr);
    placeTrack(tr); return tr;
  }
  function placeTrack(tr) {
    const curve = trackCurve(tr); tr.curve = curve;
    // the rail and its arrowhead are one geometry (one mesh a track)
    const tube = new THREE.TubeGeometry(curve, tr.kind === "loop" ? 24 : 30, tr.exc ? 0.03 : 0.042, 6, false);
    const u = tr.kind === "loop" ? 0.62 : 0.9; const head = geo.cone.clone();
    head.applyMatrix4(new THREE.Matrix4().compose(curve.getPointAt(u), new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), curve.getTangentAt(u).normalize()), new V3(1, 1, 1)));
    const g = G(mergeGeometries([tube, head])); tube.dispose(); head.dispose();
    if (tr.mesh.geometry !== geo.plane) { tr.mesh.geometry.dispose(); owned.geos.delete(tr.mesh.geometry); }
    tr.mesh.geometry = g;
    placeTrackPlate(tr);
  }
  function placeTrackPlate(tr) { // the event at the crown, facing the viewer: above a high arch, under a low one
    const curve = tr.curve;
    const crown = tr.kind === "loop" ? curve.getPointAt(0.5).add(new V3(0, 0.16, 0)) : curve.getPointAt(0.5);
    const span = tr.kind === "loop" ? 1.1 : Math.max(0.6, Math.hypot(curve.getPointAt(1).x - curve.getPointAt(0).x, curve.getPointAt(1).z - curve.getPointAt(0).z) * 0.78);
    const below = tr.kind === "arc" && tr.lane % 2 === 1;
    const p = tr.plate.userData.plate; p.maxW = below ? Math.max(1.0, span * 0.9) : Math.min(1.6, Math.max(1.0, span));
    sizePlate(tr.plate, plateComp(tr.m));
    tr.plate.position.copy(crown).add(new V3(0, p.hh / 2 + 0.06, below ? 0.04 : 0.02)); // always over its own crown: a low arch's plate sits between the two arches
    for (const b of tr.buttons) placeButton(tr, b);
  }
  // a hub (a part with more than FAN tracks) gets a bus: one raised brass rail over its partners, with a drop to each
  function buildBuses(m) {
    const deg = new Map();
    for (const e of m.edges) if (!e.global && e.a !== e.b) { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
    const hubs = [...deg.entries()].filter(([, n]) => n > FAN).map(([id]) => id).filter((id) => m.pads.has(id));
    const handled = new Set();
    for (const hub of hubs) {
      const mine = m.edges.filter((e) => !e.global && e.a !== e.b && (e.a === hub || e.b === hub) && !handled.has(e) && !(hubs.includes(e.a) && hubs.includes(e.b) && e.a !== hub));
      if (!mine.length) continue;
      const others = [...new Set(mine.map((e) => (e.a === hub ? e.b : e.a)))].filter((id) => m.pads.has(id)).sort((a, b) => (m.pads.get(a).seq ?? m.pads.get(a).index) - (m.pads.get(b).seq ?? m.pads.get(b).index));
      const HB = Math.max(1.0, m.H * 0.82);
      const hp = m.pads.get(hub).pos;
      const pts = [new V3(hp.x, HB, hp.z - 0.3), ...others.map((id) => { const q = m.pads.get(id).pos; return new V3(q.x, HB, q.z - 0.3); })];
      const path = new THREE.CurvePath(); for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
      const exc = mine.every((e) => e.exc);
      const baseCol = new THREE.Color(exc ? 0xc0463a : 0xc9a44c);
      const bm = M(new THREE.MeshStandardMaterial({ color: baseCol.clone(), emissive: exc ? 0xff4a30 : 0xffb84a, emissiveIntensity: 0, roughness: 0.38, metalness: 0.6 }));
      const mesh = new THREE.Mesh(G(new THREE.TubeGeometry(path, Math.min(600, pts.length * 6), 0.05, 6, false)), bm); m.own.add(mesh);
      const drops = new THREE.InstancedMesh(geo.rod, bm, pts.length);
      pts.forEach((q, i) => { const top = i === 0 ? hp : m.pads.get(others[i - 1]).pos; const h = HB - (top.y + 0.45); _o.position.set(q.x, top.y + 0.45 + h / 2, q.z); _o.scale.set(1.3, h, 1.3); _o.updateMatrix(); drops.setMatrixAt(i, _o.matrix); });
      drops.instanceMatrix.needsUpdate = true; m.own.add(drops); owned.inst.push(drops);
      const bus = { m, hub, others, pts, mat: bm, baseCol, mesh, exc, firstTaken: Infinity, curves: new Map(), isBus: true, chute: false };
      mesh.userData.pick = { kind: "transition", id: `${m.id}:${hub}->*` }; pickables.push(mesh);
      (m.buses ||= []).push(bus);
      for (const e of mine) { handled.add(e); m.trackByKey.set(e.key, { bus, edge: e, other: e.a === hub ? e.b : e.a, out: e.a === hub, exc: e.exc, chute: false, viaBus: true, buttons: [] }); }
    }
    return handled;
  }
  function busCurve(tr) {
    const bus = tr.bus, key = `${tr.other}|${tr.out}`;
    if (bus.curves.has(key)) return bus.curves.get(key);
    const i = bus.others.indexOf(tr.other); const pts = bus.pts.slice(0, i + 2);
    let all = [anchor(bus.m, bus.hub), ...pts, anchor(bus.m, tr.other)]; if (!tr.out) all = all.reverse();
    const path = new THREE.CurvePath(); for (let k = 1; k < all.length; k++) path.add(new THREE.LineCurve3(all[k - 1], all[k]));
    bus.curves.set(key, path); return path;
  }
  function buildTracks(m) {
    const onBus = buildBuses(m); m.hasBus = onBus.size > 0;
    // lanes: the tracks between the same two parts, forward (left to right, else front to back) first
    const pairs = new Map();
    for (const e of m.edges) {
      if (onBus.has(e)) continue;
      if (e.global) { if (m.pads.has(e.b)) addTrack(m, e, "door"); continue; }
      if (!m.pads.has(e.a) || !m.pads.has(e.b)) continue;
      if (e.a === e.b) { addTrack(m, e, "loop"); continue; }
      const key = [e.a, e.b].sort().join("|"); (pairs.get(key) || pairs.set(key, []).get(key)).push(e);
    }
    for (const list of pairs.values()) {
      const fwd = (e) => { const a = m.pads.get(e.a), b = m.pads.get(e.b); return Math.abs(a.pos.z - b.pos.z) > 0.7 ? a.pos.z > b.pos.z : a.pos.x < b.pos.x; };
      list.sort((x, y) => (fwd(y) - fwd(x)) || (x.exc - y.exc));
      list.forEach((e, i) => addTrack(m, e, "arc", list.length === 1 ? 0 : i));
    }
  }
  function trackFor(m, from, to, ev) {
    if (!from || !to) return to ? m.trackByKey.get(`*|${to}|0`) || m.trackByKey.get(`*|${to}|1`) || null : null;
    const cands = [m.trackByKey.get(`${from}|${to}|0`), m.trackByKey.get(`${from}|${to}|1`)].filter(Boolean);
    if (ev) { const hit = cands.find((t) => t.edge.events && t.edge.events.some((d) => matches(d, ev))); if (hit) return hit; }
    if (cands.length) return ev ? cands[0] : cands.find((t) => t.edge.events && t.edge.events.length === 0 && !t.exc) || cands[0];
    if (from !== to) return m.trackByKey.get(`*|${to}|0`) || m.trackByKey.get(`*|${to}|1`) || null;
    return null;
  }
  // the way a marble goes: a track; else from the door (entering), to the door (leaving), or a plain arch
  function rampPath(m, toId) { // door -> along the floor beside the plates -> the part
    const d = doorPoint(m), q = anchor(m, toId); const corner = new V3(d.x, q.y, q.z);
    const path = new THREE.CurvePath(); if (d.distanceTo(corner) > 1e-3) path.add(new THREE.LineCurve3(d, corner)); if (corner.distanceTo(q) > 1e-3) path.add(new THREE.LineCurve3(corner, q));
    if (!path.curves.length) path.add(new THREE.LineCurve3(d, q.clone().add(new V3(0, 0.001, 0))));
    return path;
  }
  function moveCurve(m, mv) {
    if (mv.track && mv.track.viaBus) return busCurve(mv.track);
    if (mv.track && !mv.track.chute && mv.from && mv.to) return mv.track.curve;
    const key = `${mv.from}|${mv.to}`;
    if (m.arcs.has(key)) return m.arcs.get(key);
    let c;
    if (mv.from && mv.to) c = mv.from === mv.to ? trackCurve({ m, edge: { a: mv.from }, kind: "loop" }) : trackCurve({ m, edge: { a: mv.from, b: mv.to, srcs: new Set() }, kind: "arc", lane: 0 });
    else if (mv.to) c = mv.track && mv.track.chute ? mv.track.curve : rampPath(m, mv.to);
    else { const p = rampPath(m, mv.from); c = { getPointAt: (u) => p.getPointAt(1 - u), getTangentAt: (u) => p.getTangentAt(1 - u).negate() }; }
    m.arcs.set(key, c); return c;
  }
  function entryRamp(m) { // the initial marker: a brass strip from the door to the initial part, ending in an arrow
    if (m.kind !== "machine" || m.doorX == null) return;
    if (m.ramp) { m.ramp.removeFromParent(); m.ramp.geometry.dispose(); owned.geos.delete(m.ramp.geometry); }
    const d = doorPoint(m), q = anchor(m, m.initialId); const ini = m.pads.get(m.initialId);
    const end = ini.door ? q.clone() : q.clone().add(new V3(-0.36, 0, 0)); end.y = 0.012;
    const corner = new V3(d.x, 0.012, end.z); const a = new V3(d.x, 0.012, d.z + 0.1);
    const parts = [];
    const strip = (p, q2) => { const len = p.distanceTo(q2); if (len < 0.02) return; const b = new THREE.BoxGeometry(0.11, 0.012, len + 0.11); const o = new THREE.Object3D(); o.position.copy(p).lerp(q2, 0.5); o.lookAt(q2.x, o.position.y, q2.z); o.updateMatrix(); b.applyMatrix4(o.matrix); parts.push(b); };
    strip(a, corner); strip(corner, end);
    const ar = geo.arrow.clone(); const dir = end.clone().sub(corner); if (dir.lengthSq() < 1e-4) dir.copy(end).sub(a);
    ar.applyMatrix4(new THREE.Matrix4().compose(end.clone().add(new V3(0, 0.004, 0)), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), Math.atan2(-dir.x, -dir.z)), new V3(1, 1, 1))); parts.push(ar);
    m.ramp = new THREE.Mesh(G(mergeGeometries(parts)), mat.ramp); for (const x of parts) x.dispose(); m.own.add(m.ramp);
  }

  // event plates must not cover each other or a station's plate, seen from the front: each one that would is lifted
  function declutter(m) {
    const rect = (p) => { const u = p.userData.plate; return { x: p.position.x, y: p.position.y, z: p.position.z, w: u.w, h: u.hh }; };
    const hit = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 0.04 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + 0.03 && Math.abs(a.z - b.z) < 1.2;
    const fixed = m.padList.filter((st) => st.plate).map((st) => { const r = rect(st.plate); r.x += st.pos.x; r.y += st.pos.y + 0.12; r.z += st.pos.z; r.h += 0.1; return r; });
    const list = m.tracks.filter((t) => t.plate).sort((a, b) => a.plate.position.y - b.plate.position.y);
    for (const t of list) {
      let r = rect(t.plate);
      for (let k = 0; k < 12; k++) { const o = fixed.find((f) => hit(r, f)); if (!o) break; r.y = o.y + (o.h + r.h) / 2 + 0.05; }
      t.plate.position.y = r.y; fixed.push(r);
    }
  }

  // ---------- push-buttons (interactive): one per event at the start of its track ----------
  function addButtons(tr) {
    const evs = [...new Set(tr.edge.events.flatMap((x) => x.split(/\s+/)).filter((x) => x && !x.includes("*") && !/^done\.|^error\./.test(x)))];
    evs.slice(0, 3).forEach((ev, i) => {
      const b = new THREE.Group(); const body = new THREE.Mesh(geo.box, mat.button); b.add(body);
      const pl = plate(ev, 0.12, 1.0, { m: tr.m, kind: "button", style: "button" }); pl.position.z = 0.032; b.add(pl);
      body.userData.pick = pl.userData.pick = { kind: "event", event: ev, track: tr }; pickables.push(body, pl);
      b.visible = false; tr.m.own.add(b); tr.buttons.push({ g: b, body, pl, ev, i });
    });
  }
  function placeButton(tr, b) {
    sizePlate(b.pl, plateComp(tr.m)); const p = b.pl.userData.plate; b.body.scale.set(p.w + 0.06, p.hh + 0.06, 0.05);
    const at = tr.kind === "loop" ? tr.curve.getPointAt(0.2) : tr.curve.getPointAt(0.12);
    b.g.position.copy(at).add(new V3(0, 0.14 + b.i * (p.hh + 0.1), 0.18));
  }

  // ---------- build ----------
  let top = null;
  if (chart && chart.root) {
    index(chart.root, null);
    walk(chart.root, (n) => { scanActions(n.onentry); scanActions(n.onexit); for (const tr of n.transitions || []) scanActions(tr.actions); });
    let tn = chart.root;
    if (tn.id === "__root__" && kids(tn).length === 1 && has(kids(tn)[0])) tn = kids(tn)[0];
    if (tn.kind === "parallel") top = buildBench(tn, 1, HUES[0], null, true);
    else if (has(tn)) top = buildMachine(tn, 1, HUES[0], null);
    else top = buildSolo(tn, 1, HUES[0], null);
    root.add(top.group);
  }
  const regions = top ? (top.kind === "bench" ? top.children : [top]) : [];
  const compound = machines.filter((m) => m.kind === "machine");
  const big = stations.size > BIG_STATIONS;
  for (const r of recs) r.grows = !big && r.parent && r.parent.kind === "machine" && r.parent.parts <= GROW_PARTS;

  // ---------- data: lives, moves, capsules, kicks ----------
  // computed from the run; refresh() computes it again as a live run grows (the machines stay, their marbles keep
  // moving from where they are)
  const atOf = (e) => (e.at != null ? e.at : e.t);
  let lives, livesS, capsules, capS;
  function computeData() {
    const END = (sim.duration || 1e9) + 10;
    const evs = (sim.eventsBetween ? sim.eventsBetween(-1, END) : ((sim.trace && sim.trace.events) || [])).filter((e) => e.actor === actorId || (e.type === "message" && e.to === actorId));
    const allMsgs = evs.filter((e) => e.type === "message");
    const arrive = (msg) => (sim.flight ? sim.flight(msg)[1] : warp(atOf(msg)));
    lives = sim.lifetimes ? sim.lifetimes(actorId) : null;
    if (!lives || !lives.length) { const a = sim.actor ? sim.actor(actorId) : null; lives = [[a && a.bornAt != null ? a.bornAt : 0, a && a.diedAt != null ? a.diedAt : Infinity]]; }
    livesS = lives.map(([a, b]) => [warp(a), b === Infinity || b > END ? Infinity : warp(b)]);
    capsules = []; const usedMsg = new Set(); const pendingKicks = [];
    const cur = new Map(compound.map((m) => [m, null]));
    const groups = []; let gEvent = null;
    let currentEvent = null;
    const push = (m, mv) => { m.moves.push(mv); cur.set(m, mv.to); if (gEvent !== currentEvent) { groups.push([]); gEvent = currentEvent; } groups[groups.length - 1].push({ m, mv }); };
    for (const e of evs) {
      const at = atOf(e); currentEvent = e;
      if (e.type === "transition") {
        const from = e.from || [], to = e.to || [];
        const msg = e.event ? allMsgs.find((x) => !usedMsg.has(x.id) && x.name === e.event && Math.abs(atOf(x) - at) < 1e-6) : null;
        if (!from.length && !to.length) { pendingKicks.push({ at, name: e.event, msg }); if (msg) usedMsg.add(msg.id); continue; }
        if (msg) usedMsg.add(msg.id);
        const base = msg ? arrive(msg) + CAP_LEAD : warp(at) + 0.04;
        let outer = null, outerBoth = null;
        for (const m of compound) {
          const ex = kids(m.node).find((c) => from.includes(c.id)); const en = kids(m.node).find((c) => to.includes(c.id) && c.kind !== "history");
          if (!ex && !en) continue;
          push(m, { base, from: ex ? ex.id : null, to: en ? en.id : null, ev: e.event || "" });
          if (!outer || m.level < outer.level) outer = m;
          if (ex && en && (!outerBoth || m.level < outerBoth.level)) outerBoth = m;
        }
        if (msg) capsules.push({ s0: arrive(msg), m: outerBoth || outer || regions[0] });
      } else if (e.type === "config") {
        const act = new Set(e.active || []);
        for (const m of compound) { const c = kids(m.node).find((x) => act.has(x.id)); const want = c ? c.id : null; if (want !== cur.get(m)) push(m, { base: warp(at) + 0.04, from: cur.get(m), to: want, ev: "" }); }
      } else if (e.type === "end") {
        if (e.reason !== "disposed" && e.reason !== "killed") for (const m of compound) if (cur.get(m)) push(m, { base: warp(at), from: cur.get(m), to: null, ev: "", death: true });
      }
    }
    if (!evs.some((e) => e.type === "transition" || e.type === "config") && sim.activeAt) {
      const act = new Set(sim.activeAt(actorId, lives[0][0]));
      currentEvent = "birth"; for (const m of compound) { const c = kids(m.node).find((x) => act.has(x.id)); if (c) push(m, { base: livesS[0][0] + 0.04, from: null, to: c.id, ev: "" }); }
    }
    for (const msg of allMsgs) if (!usedMsg.has(msg.id)) pendingKicks.push({ at: atOf(msg), name: msg.name, msg });
    for (const k of pendingKicks) {
      const act = sim.activeAt ? sim.activeAt(actorId, k.at - 1e-7) : [];
      let best = null, bestDepth = -1;
      for (const id of act) { const n = nodeById.get(id); if (!n || !(n.transitions || []).some((tr) => matches(tr.event, k.name))) continue; let dd = 0; for (let x = n; parentOf.get(x.id); x = parentOf.get(x.id)) dd++; if (dd > bestDepth) { best = n; bestDepth = dd; } }
      const s0 = k.msg ? arrive(k.msg) : warp(k.at); const sk = s0 + (k.msg ? CAP_LEAD : 0.04);
      if (!best) { if (k.msg) capsules.push({ s0, m: regions[0], lost: true }); continue; }
      const st = stations.get(best.id), sm = machById.get(best.id);
      if (st && (!sm || sm.kind === "solo")) { st.kicks.push(sk); if (k.msg) capsules.push({ s0, m: st.m }); continue; }
      let mm = sm; while (mm && mm.kind === "bench") mm = mm.parent;
      if (!mm) mm = regions[0];
      if (mm) { mm.hopperKicks.push(sk); if (k.msg) capsules.push({ s0, m: mm }); }
    }
    // who takes mail gets a funnel: the machines that receive, and the region (level 1) above each, which takes it while they are shut
    for (const c of capsules) { let m = c.m; while (m && m.kind === "bench") m = m.parent || null; c.m = m; if (!m) continue; m.receives = true; let r = m; while (r.parent && !(r.parent.kind === "bench" && !r.parent.parent)) r = r.parent; if (r.kind !== "bench") r.receives = true; }
    // timers: a delayed send set by a state runs the clock on that station until it fires or is cancelled
    {
      const all = (sim.trace && sim.trace.events) || [];
      const sets = all.filter((e) => e.type === "timer" && e.actor === actorId && e.action === "set");
      if (sets.length) {
        const endBy = new Map();
        for (const e of all) { if (e.type === "message" && e.timer && e.to === actorId) endBy.set(e.timer, Math.min(endBy.get(e.timer) ?? Infinity, e.t)); if (e.type === "timer" && e.action === "cancel" && e.timer) endBy.set(e.timer, Math.min(endBy.get(e.timer) ?? Infinity, e.t)); }
        const byId = new Map(all.map((e) => [e.id, e]));
        const depthOf = (id) => { let dd = 0; for (let x = nodeById.get(id); x && parentOf.get(x.id); x = parentOf.get(x.id)) dd++; return dd; };
        for (const e of sets) {
          const c = e.cause && byId.get(e.cause);
          let ids = c && c.type === "transition" && (c.to || []).length ? c.to : (sim.activeAt ? sim.activeAt(actorId, e.t) : []);
          ids = ids.filter((id) => stations.has(id)).sort((a, b) => depthOf(b) - depthOf(a));
          if (!ids.length) continue;
          const st = stations.get(ids[0]);
          (st.timers ||= []).push({ t0: e.t, t1: Math.min(endBy.get(e.id) ?? Infinity, e.due ?? e.t + (e.delay || 0)), delay: e.delay || Math.max(1, (e.due || e.t + 1) - e.t) });
        }
      }
    }
    capsules.sort((a, b) => a.s0 - b.s0);
    for (const st of stations.values()) st.kicks.sort((a, b) => a - b);
    for (const m of machines) m.hopperKicks.sort((a, b) => a - b);
    // schedule: the moves of one trace event go outside in when entering (the parent's marble reaches the door, then
    // the inner marble rolls in) and inside out when leaving; a machine's moves never overlap; bursts shorten and blur
    const endOf = new Map(compound.map((m) => [m, -Infinity])), countOf = new Map();
    for (const g of groups) {
      const base = Math.min(...g.map((x) => x.mv.base));
      let t0 = Math.max(base, ...g.map((x) => endOf.get(x.m)));
      const lag = t0 - base;
      const phase = ({ m, mv }) => (mv.death ? 0 : mv.from && !mv.to ? 100 - m.level : mv.from && mv.to ? 200 : 300 + m.level);
      const order = [...new Set(g.map(phase))].sort((a, b) => a - b);
      for (const ph of order) {
        let next = t0;
        for (const x of g) {
          if (phase(x) !== ph) continue; const { m, mv } = x;
          mv.start = Math.max(t0, endOf.get(m));
          const k = countOf.get(m) || 0; countOf.set(m, k + 1);
          if (!mv.from && mv.to && !mv.death && m.histPad && mv.to !== initialOf(m.node) && k > 0) mv.viaHist = true;
          let dur = mv.from && mv.to ? TRAVEL : mv.viaHist ? 0.7 : 0.32;
          if (mv.death) dur = 0.9;
          else if (lag > LAG_HARD) { dur = 0.03; mv.fast = true; }
          else if (lag > LAG_SOFT) { dur *= Math.max(0.15, 1 - (lag - LAG_SOFT) / (LAG_HARD - LAG_SOFT)); mv.fast = dur < 0.2; }
          mv.end = mv.start + dur; endOf.set(m, mv.end); next = Math.max(next, mv.end);
          mv.track = null;
        }
        t0 = next;
      }
    }
    for (const m of compound) { m.moves.sort((a, b) => a.start - b.start); m.moveStarts = m.moves.map((x) => x.start); }
    capS = capsules.map((c) => c.s0);
    for (const m of compound) if (m.histPad) { const mark = (x) => { for (const c of x.children) { if (c.kind === "machine") c.remembers = true; mark(c); } }; m.remembers = true; if (m.histDeep) mark(m); }
    const allActors = sim.actors || sim.actorsList || [];
    const childrenOf = allActors.filter((a) => a.parent === actorId);
    for (const st of stations.values()) if ((st.node.invokes || []).length) { st.invokes = st.node.invokes;
      st.childIds = childrenOf.filter((a) => st.invokes.some((iv) => (iv.id && a.id.includes(iv.id)) || (iv.src && a.chart && iv.src.replace(/^.*\//, "").replace(/\.scxml$/, "") === a.chart))).map((a) => a.id);
      if (!st.childIds.length) st.childIds = childrenOf.map((a) => a.id);
    }

  }
  computeData();
  /** a live run grew: the moves, mail, kicks and timers again, on the same machines. false when the new run needs
   *  parts the head was built without (a first timer on a built station, a first funnel): then build it again */
  function refresh() {
    const recv = machines.map((m) => !!m.receives);
    for (const m of machines) { m.moves = []; m.moveStarts = []; m.hopperKicks = []; }
    for (const st of stations.values()) { st.kicks = []; if (st.timers) st.timers = []; }
    computeData();
    // parts the new run needs that were not built: a first funnel, a first clock (added in place)
    for (const m of machines) if (m.receives && !m.funnel && m.chromeBuilt) { addFunnel(m); fitChrome(m); }
    for (const st of stations.values()) if (st.group && st.timers && st.timers.length && !st.clock) addClock(st, st.group);
    void recv;
    for (const m of machines) if (m.interiorBuilt) for (const mv of m.moves) { mv.track = trackFor(m, mv.from, mv.to, mv.ev); const t = mv.track && mv.track.viaBus ? mv.track.bus : mv.track; if (t) t.firstTaken = Math.min(t.firstTaken, mv.start); }
    return true;
  }

  // ---------- lazy building ----------
  function ensureChrome(r) {
    if (!r || r.chromeBuilt) return; r.chromeBuilt = true;
    if (r.kind === "bench") {
      r.board = new THREE.Mesh(geo.box, mat.board); if (!r.top) r.chrome.add(r.board); // the top bench stands on the room's table
      r.steps = r.boardSpec.steps.map(() => { const s = new THREE.Mesh(geo.box, mat.board); r.chrome.add(s); return s; });
      fitBench(r);
      for (const c of r.children) ensureChrome(c);
      return;
    }
    housing(r); if (r.level === 1) housingFull(r);
  }
  function fitBench(b) {
    const { W, D, steps } = b.boardSpec;
    b.board.scale.set(W + 0.8, 0.2, D + 0.8); b.board.position.set(0, -0.1, -D / 2);
    steps.forEach((p, i) => { const s = b.steps[i]; if (!s) return; s.scale.set(W + 0.8, p.y, p.rd + 0.7); s.position.set(0, p.y / 2, p.z - p.rd / 2); });
  }
  function ensureInterior(m) {
    if (m.interiorBuilt) return; ensureChrome(m); housingFull(m); m.interiorBuilt = true;
    m.shelfMeshes = m.shelfBoxes.map(() => { const x = new THREE.Mesh(geo.box, mat.shelf); m.own.add(x); return x; }); placeShelves(m);
    for (const st of m.padList) stationMeshes(st);
    finishStations(m);
    if (m.kind === "solo") { for (const e of m.edges) addTrack(m, e, "loop"); }
    else { buildTracks(m); declutter(m); entryRamp(m); }
    for (const mv of m.moves) { mv.track = trackFor(m, mv.from, mv.to, mv.ev); const t = mv.track && mv.track.viaBus ? mv.track.bus : mv.track; if (t) t.firstTaken = Math.min(t.firstTaken, mv.start); }
    m.marble = new THREE.Mesh(geo.marble, M(new THREE.MeshStandardMaterial({ color: 0xeef8ff, emissive: 0x8fd4ff, emissiveIntensity: 0.75, roughness: 0.15, metalness: 0.3 })));
    m.marble.visible = false; m.own.add(m.marble);
    if (m.remembers) { m.ghost = new THREE.Mesh(geo.marble, mat.ghost); m.ghost.visible = false; m.own.add(m.ghost); }
    for (const c of m.children) ensureChrome(c);
    resizePlates(m);
  }
  function placeShelves(m) { (m.shelfMeshes || []).forEach((x, i) => { const sh = m.shelfBoxes[i]; if (!sh) { x.visible = false; return; } x.scale.set(sh.w, SHELF, sh.d); x.position.set(0, SHELF / 2 - 0.001, sh.z); }); }
  // after a re-layout: everything that hangs on positions
  function applyLayout(r) {
    if (!r.chromeBuilt) return;
    if (r.kind === "bench") { fitBench(r); return; }
    fitChrome(r);
    if (!r.interiorBuilt) return;
    for (const st of r.padList) if (st.group) st.group.position.copy(st.pos);
    placePads(r); placeShelves(r);
    for (const tr of r.tracks) placeTrack(tr);
    declutter(r); entryRamp(r); r.arcs.clear();
  }
  // plates never fall below MIN_PLATE head units while their machine is small (as wide as their place allows)
  function plateComp(m) { if (!m) return 1; const s = scaleOf(m) * PLATE_H; return Math.min(1.9, Math.max(1, MIN_PLATE / s)); }
  function resizePlates(m) {
    if (!m.interiorBuilt) return; const c = plateComp(m); if (Math.abs((m.plateC || 0) - c) < 0.01) return; m.plateC = c;
    for (const st of m.padList) if (st.plate) { sizePlate(st.plate, c); st.plate.position.y = 0.03 + 0.37 * st.plate.userData.plate.hh; }
    for (const tr of m.tracks) placeTrackPlate(tr);
    if (m.kind === "machine") declutter(m);
  }

  // ---------- gauges (the datamodel that matters): on the back rail of the machine that reads them ----------
  const gauges = []; const pipeMeshes = [];
  const evOf = (id) => (sim.event ? sim.event(id) : null);
  if (chart && chart.datamodel && chart.datamodel.length && regions.length) {
    const snaps = ((sim.trace && sim.trace.events) || []).filter((e) => e.type === "snapshot" && e.actor === actorId);
    const datas = ((sim.trace && sim.trace.events) || []).filter((e) => e.type === "data" && e.actor === actorId);
    const anyRead = chart.datamodel.some((dv) => dv.readBy && dv.readBy.length);
    const cands = [];
    for (const dv of chart.datamodel) {
      if (anyRead && !(dv.readBy && dv.readBy.length)) continue;
      const changes = []; let prev;
      for (const sn of snaps) { if (!sn.values || !(dv.id in sn.values)) continue; const j = JSON.stringify(sn.values[dv.id]); if (prev !== undefined && j !== prev) { const e = evOf(sn.id); changes.push({ s: warp(e ? atOf(e) : sn.t) }); } prev = j; }
      if (!snaps.length) for (const de of datas) if (de.key === dv.id) { const e = evOf(de.id); changes.push({ s: warp(e ? atOf(e) : de.t) }); }
      if (!changes.length) continue;
      cands.push({ dv, changes, score: changes.length + 1.5 * ((dv.readBy || []).length) });
    }
    cands.sort((a, b) => b.score - a.score);
    const chosen = cands.slice(0, options.maxGauges ?? 4);
    const regOf = (sid) => regions.find((r) => { let ok = false; walk(r.node, (x2) => { if (x2.id === sid) ok = true; }); return ok; });
    const roofOf = (r) => { let x = r; while (x && x.kind === "bench") x = x.children[0]; return x; };
    for (const c of chosen) {
      const reads = new Map();
      for (const sid of c.dv.readBy || []) { const r = roofOf(regOf(sid)); if (r) reads.set(r, (reads.get(r) || 0) + 1); }
      const prim = [...reads.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || roofOf(regions[0]);
      if (!prim) continue;
      ensureChrome(prim);
      const list = (prim.gaugeList ||= []); const slot = list.length;
      if ((slot + 1) * 0.95 > prim.size.w - 0.6) continue; // no room on that rail
      const g = makeGauge(c.dv, prim); g.slot = slot; list.push(g); placeGauge(prim, g);
      g.changes = c.changes; g.pipes = []; g.prim = prim;
      g.others = new Set(); for (const sid of [...(c.dv.readBy || []), ...(c.dv.writtenBy || [])]) { const r = roofOf(regOf(sid)); if (r && r !== prim) g.others.add(r); }
      g.writers = new Set((c.dv.writtenBy || []).map((sid) => roofOf(regOf(sid))));
      gauges.push(g);
    }
  }
  function makeGauge(dv, m) {
    const g = { id: dv.id, type: dv.type, group: new THREE.Group(), last: undefined };
    g.group.scale.setScalar(0.62); m.chrome.add(g.group);
    const pl = plate(dv.id, 0.24, 1.35, { kind: "gauge", m, comp: false }); pl.position.set(0, -0.02, 0.33); g.group.add(pl); g.plate = pl;
    const kind = dv.type === "array" || dv.type === "object" ? "tube" : dv.type === "number" ? "dial" : dv.type === "boolean" ? "lever" : "lamp";
    g.kind = kind;
    if (kind === "tube") {
      const glass = new THREE.Mesh(geo.tube, mat.glass); glass.scale.set(1, 1.5, 1); glass.position.y = 0.85; g.group.add(glass);
      const cap = new THREE.Mesh(geo.box, mat.brass); cap.scale.set(0.52, 0.08, 0.52); cap.position.y = 1.64; g.group.add(cap);
      const base = new THREE.Mesh(geo.box, mat.brass); base.scale.set(0.52, 0.1, 0.52); base.position.y = 0.06; g.group.add(base);
      const bm = M(new THREE.MeshStandardMaterial({ color: dv.type === "object" ? 0x7fc4ff : 0xffb36b, roughness: 0.3, emissive: 0x000000 }));
      g.balls = new THREE.InstancedMesh(geo.ball, bm, 16); g.balls.count = 0; g.group.add(g.balls); g.ballMat = bm; owned.inst.push(g.balls);
      glass.userData.pick = { kind: "variable", id: dv.id }; pickables.push(glass);
    } else if (kind === "dial") { // a round pressure gauge on a brass neck, its face to the viewer
      const neck = new THREE.Mesh(geo.rod, mat.brass); neck.scale.set(2, 0.3, 2); neck.position.y = 0.15; g.group.add(neck);
      const body = new THREE.Mesh(geo.dialBody, mat.brass); body.rotation.x = Math.PI / 2; body.position.y = 0.72; g.group.add(body);
      g.faceCanvas = document.createElement("canvas"); g.faceCanvas.width = g.faceCanvas.height = 256;
      g.faceTex = new THREE.CanvasTexture(g.faceCanvas); g.faceTex.colorSpace = THREE.SRGBColorSpace; owned.texs.add(g.faceTex);
      const face = new THREE.Mesh(geo.disc, M(new THREE.MeshStandardMaterial({ map: g.faceTex, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.1, emissiveMap: g.faceTex })));
      face.scale.setScalar(1.15); face.position.set(0, 0.72, 0.115); g.group.add(face); g.faceMat = face.material;
      g.needleG = new THREE.Group(); g.needleG.position.set(0, 0.72, 0.13); g.group.add(g.needleG);
      const needle = new THREE.Mesh(geo.box, mat.red); needle.scale.set(0.035, 0.34, 0.02); needle.position.y = 0.15; g.needleG.add(needle);
      body.userData.pick = { kind: "variable", id: dv.id }; pickables.push(body);
      g.max = 1;
    } else {
      const body = new THREE.Mesh(geo.box, mat.iron); body.scale.set(0.6, 0.5, 0.4); body.position.y = 0.25; g.group.add(body);
      g.lampMat = std(0x23262d, { emissive: 0x7dff9a, emissiveIntensity: 0 });
      const l = new THREE.Mesh(geo.marble, g.lampMat); l.position.set(0, 0.62, 0); g.group.add(l);
      if (kind === "lever") { g.lever = new THREE.Group(); g.lever.position.set(0, 0.45, 0.15); const arm = new THREE.Mesh(geo.box, mat.brass); arm.scale.set(0.06, 0.45, 0.06); arm.position.y = 0.22; g.lever.add(arm); g.group.add(g.lever); }
      body.userData.pick = { kind: "variable", id: dv.id }; pickables.push(body);
    }
    return g;
  }
  function placeGauge(m, g) { g.group.position.set(m.size.w / 2 - 0.55 - g.slot * 0.95, m.H + 0.05, -m.size.d / 2 + 0.05); }
  function buildPipes() { // copper pipes from a gauge to the other machines that read or write its variable
    for (const p of pipeMeshes) { p.removeFromParent(); if (p.geometry !== geo.pulse) { p.geometry.dispose(); owned.geos.delete(p.geometry); } }
    pipeMeshes.length = 0;
    root.updateMatrixWorld(true);
    const toRoot = (obj, v) => root.worldToLocal(obj.localToWorld(v));
    gauges.forEach((g, i) => {
      g.pipes = [];
      const base = toRoot(g.group, new V3(0, 0.05, -0.2));
      for (const r of g.others) {
        if (!r.chromeBuilt) continue;
        const tgt = toRoot(r.chrome, new V3(r.size.w / 2 - 0.3, r.H + 0.1, -r.size.d / 2 + 0.3));
        const mid = base.clone().lerp(tgt, 0.5); mid.y = Math.max(base.y, tgt.y) + 1.1 + 0.15 * i;
        const curve = new THREE.CatmullRomCurve3([tgt, tgt.clone().add(new V3(0, 0.6, 0)), mid, base.clone().add(new V3(0, 0.5, 0)), base]);
        const pm = M(new THREE.MeshStandardMaterial({ color: 0xb8693f, roughness: 0.4, metalness: 0.6, emissive: 0xffa060, emissiveIntensity: 0 }));
        const mesh = new THREE.Mesh(G(new THREE.TubeGeometry(curve, 40, 0.032, 6, false)), pm); root.add(mesh); pipeMeshes.push(mesh);
        mesh.userData.pick = { kind: "variable", id: g.id }; pickables.push(mesh);
        const pulse = new THREE.Mesh(geo.pulse, mat.pulse); pulse.visible = false; root.add(pulse); pipeMeshes.push(pulse);
        g.pipes.push({ r, curve, mesh, mat: pm, pulse, writer: g.writers.has(r) || !g.writers.size });
      }
    });
  }
  function drawDial(g, v) {
    const x = g.faceCanvas.getContext("2d");
    x.fillStyle = "#efe4c6"; x.beginPath(); x.arc(128, 128, 127, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "#3a3330"; x.lineWidth = 6;
    for (let i = 0; i <= 8; i++) { const a = (-120 + (240 * i) / 8 - 90) * Math.PI / 180; x.beginPath(); x.moveTo(128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92); x.lineTo(128 + Math.cos(a) * 116, 128 + Math.sin(a) * 116); x.stroke(); }
    x.fillStyle = "#1d1f24"; x.fillRect(64, 158, 128, 58);
    x.fillStyle = "#ffd27a"; x.font = "700 46px ui-monospace, Menlo, monospace"; x.textAlign = "center"; x.textBaseline = "middle";
    const sv = typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : String(v ?? "–"); x.fillText(sv.slice(0, 5), 128, 189);
    g.faceTex.needsUpdate = true;
  }
  for (const g of gauges) if (g.kind === "dial") { let mx = 1; for (const e of ((sim.trace && sim.trace.events) || [])) if (e.type === "snapshot" && e.actor === actorId && e.values && typeof e.values[g.id] === "number") mx = Math.max(mx, Math.abs(e.values[g.id])); g.max = mx; drawDial(g, 0); }

  // ---------- fitting the head to the view the WORLD gives it ----------
  // The content stands on a table; scale and height are chosen so the content fills ENTRY's frame
  // (fillW of its width, fillH of its height), within x +-6.6, z +-6 and above the room's floor.
  const projCam = new THREE.PerspectiveCamera(ENTRY.fov, ENTRY.aspect, 0.1, 100);
  projCam.position.set(0, Math.sin(ENTRY.el) * ENTRY.dist, Math.cos(ENTRY.el) * ENTRY.dist); projCam.lookAt(0, 0, 0); projCam.updateMatrixWorld(true);
  const _p = new V3();
  function projExtent(b, s, y0) { // the screen box (NDC) of box b (root units) scaled by s, its bottom at y0, centred in x and z
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    let x0 = Infinity, x1 = -Infinity, ya = Infinity, yb = -Infinity;
    for (let i = 0; i < 8; i++) {
      _p.set(((i & 1 ? b.max.x : b.min.x) - cx) * s, y0 + ((i & 2 ? b.max.y : b.min.y) - b.min.y) * s, ((i & 4 ? b.max.z : b.min.z) - cz) * s).project(projCam);
      x0 = Math.min(x0, _p.x); x1 = Math.max(x1, _p.x); ya = Math.min(ya, _p.y); yb = Math.max(yb, _p.y);
    }
    return { x0, x1, y0: ya, y1: yb };
  }
  function fitBox(b) {
    const sz = b.getSize(new V3());
    const place = (s) => { let lo = ROOM_FLOOR + 0.6, hi = 3; for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; const e = projExtent(b, s, mid); if ((e.y0 + e.y1) / 2 < -0.06) lo = mid; else hi = mid; } return (lo + hi) / 2; };
    const ok = (s) => { if (sz.x * s > 15 || sz.z * s > 12.5) return false; const y0 = place(s); const e = projExtent(b, s, y0); return e.x1 - e.x0 <= 2 * ENTRY.fillW && e.y1 - e.y0 <= 2 * ENTRY.fillH; };
    let lo = 0.02, hi = 6; for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    const s = lo, y0 = place(s);
    return { s, p: new V3(-((b.min.x + b.max.x) / 2) * s, y0 - b.min.y * s, -((b.min.z + b.max.z) / 2) * s) };
  }
  function recBox(r) { // a record's box in root units, from the current layout
    root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const extra = (r.gaugeList && r.gaugeList.length) ? 1.1 : 0.7;
    const b = r.kind === "bench" ? new THREE.Box3(new V3(-r.size.w / 2, -0.2, -r.size.d / 2), new V3(r.size.w / 2, r.size.h + 0.7, r.size.d / 2)) : new THREE.Box3(new V3(-r.size.w / 2, r.level === 1 ? -(r.BEAM || 0.5) - 0.06 : -PLINTH, -r.size.d / 2), new V3(r.size.w / 2, r.H + extra, r.size.d / 2)); // a region's open beam hangs below its plinth
    if (r.kind === "bench") b.min.z -= 0, b.max.z += 0;
    return b.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, r.group.matrixWorld));
  }
  const xf = { s: 1, p: new V3() }, xfTarget = { s: 1, p: new V3() };
  let stage = null;
  function refit() {
    if (!top) return;
    const t = fitBox(recBox(stage || top)); xfTarget.s = t.s; xfTarget.p.copy(t.p);
  }

  // ---------- the table the machines stand on, and the inlet where mail comes in ----------
  const table = new THREE.Group(); group.add(table);
  const tableTop = new THREE.Mesh(geo.box, mat.wood); table.add(tableTop);
  const tableLegs = [0, 1, 2, 3].map(() => { const l = new THREE.Mesh(geo.box, mat.woodDark); table.add(l); return l; });
  function placeTable() {
    if (!top) { table.visible = false; return; }
    root.updateMatrixWorld(true); group.updateMatrixWorld(true);
    const b = recBox(stage || top).applyMatrix4(root.matrix);
    const w = b.max.x - b.min.x + 0.7, d = b.max.z - b.min.z + 0.7, y = b.min.y - 0.02, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const th = 0.22; tableTop.scale.set(w, th, d); tableTop.position.set(cx, y - th / 2, cz);
    const lh = Math.max(0.05, y - th - ROOM_FLOOR);
    tableLegs.forEach((l, i) => { l.scale.set(0.3, lh, 0.3); l.position.set(cx + (i & 1 ? 1 : -1) * (w / 2 - 0.3), ROOM_FLOOR + lh / 2, cz + (i & 2 ? 1 : -1) * (d / 2 - 0.3)); });
  }
  const inlet = new THREE.Group(); inlet.position.set(...INLET); group.add(inlet);
  { const pipe = new THREE.Mesh(geo.rod, mat.brass); pipe.scale.set(4.5, 2.4, 4.5); pipe.position.y = 1.2; inlet.add(pipe);
    const mouth = new THREE.Mesh(geo.funnel, mat.funnel); mouth.rotation.x = Math.PI; mouth.scale.setScalar(1.1); mouth.position.y = -0.1; inlet.add(mouth);
    const ring = new THREE.Mesh(geo.ring, mat.brass); ring.rotation.x = Math.PI / 2; ring.scale.setScalar(0.6); ring.position.y = 0.4; inlet.add(ring); }

  // ---------- the room (optional; WORLD mounts it: README "The room") ----------
  const room = options.room === false ? null : buildRoom();
  function buildRoom() {
    const R = new THREE.Group(); R.name = `head-room:${actorId}`;
    // a skull-shaped attic: a lathe, drawn from inside only (BackSide), so a camera outside sees in through the near side
    const prof = []; const N = 28;
    for (let j = 0; j < N; j++) { const a = (j / (N - 1)) * Math.PI * 0.5; const y = ROOM_FLOOR + 3.2 * Math.min(1, j / 6) + (j >= 6 ? 9.2 * Math.sin(((j - 6) / (N - 7)) * Math.PI / 2) : 0); prof.push(new THREE.Vector2(j >= 6 ? 9.2 * Math.cos(((j - 6) / (N - 7)) * Math.PI / 2) + 0.001 : 9.0 + 0.2 * (j / 6), y)); void a; }
    const lathe = G(new THREE.LatheGeometry(prof, 72));
    const tex = roomTexture(prof); owned.texs.add(tex);
    const wall = new THREE.Mesh(lathe, M(new THREE.MeshStandardMaterial({ map: tex, side: THREE.BackSide, roughness: 0.85, alphaTest: 0.5, emissive: 0x3a2412, emissiveIntensity: 0.35 })));
    R.add(wall);
    // the floor: planks
    const fc = document.createElement("canvas"); fc.width = fc.height = 512; const fx = fc.getContext("2d");
    for (let i = 0; i < 16; i++) { fx.fillStyle = i % 2 ? "#6e4b30" : "#7b5536"; fx.fillRect(0, i * 32, 512, 32); fx.fillStyle = "#4a301e"; fx.fillRect(0, i * 32, 512, 2); fx.fillRect(((i * 197) % 400) + 40, i * 32, 2, 32); }
    const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace; ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(2, 2); owned.texs.add(ft);
    const floor = new THREE.Mesh(G(new THREE.CircleGeometry(9.1, 64)), M(new THREE.MeshStandardMaterial({ map: ft, roughness: 0.9 })));
    floor.rotation.x = -Math.PI / 2; floor.position.y = ROOM_FLOOR; R.add(floor);
    // a lamp hanging from the crown: warm light painted on everything near it is the walls' own glow; the bulb is unlit
    const lamp = new THREE.Group(); lamp.position.set(0, 6.2, 1.6); R.add(lamp);
    const cord = new THREE.Mesh(geo.rod, mat.iron); cord.scale.set(0.6, 2.2, 0.6); cord.position.y = 1.1; lamp.add(cord);
    const shade = new THREE.Mesh(G(new THREE.CylinderGeometry(0.22, 0.75, 0.55, 24, 1, true)), M(new THREE.MeshStandardMaterial({ color: 0x2f5a46, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide, emissive: 0xffc070, emissiveIntensity: 0.06 }))); lamp.add(shade);
    const bulb = new THREE.Mesh(G(new THREE.SphereGeometry(0.2, 16, 10)), M(new THREE.MeshBasicMaterial({ color: 0xfff1c4 }))); bulb.position.y = -0.2; lamp.add(bulb);
    const gc = document.createElement("canvas"); gc.width = gc.height = 128; const gx = gc.getContext("2d"); const gr = gx.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,215,140,0.55)"); gr.addColorStop(1, "rgba(255,200,120,0)"); gx.fillStyle = gr; gx.fillRect(0, 0, 128, 128);
    const gt = new THREE.CanvasTexture(gc); owned.texs.add(gt);
    const halo = new THREE.Sprite(M(new THREE.SpriteMaterial({ map: gt, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))); halo.scale.setScalar(3.2); halo.position.y = -0.35; lamp.add(halo);
    return R;
  }
  function roomTexture(prof) { // plaster above wood panelling, brass ribs like the skull's sutures, two round eyes cut out at the front
    const W = 2048, H = 1024; const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
    const vOf = (y) => { for (let j = 1; j < prof.length; j++) if (prof[j].y >= y) { const u = (y - prof[j - 1].y) / (prof[j].y - prof[j - 1].y || 1); return (j - 1 + u) / (prof.length - 1); } return 1; };
    const py = (v) => (1 - v) * H; // canvas y of texture v (flipY)
    const g = x.createLinearGradient(0, py(vOf(ROOM_FLOOR + 3)), 0, 0); g.addColorStop(0, "#c9a27a"); g.addColorStop(0.55, "#dcbf98"); g.addColorStop(1, "#ecd7b4");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const yPanel = py(vOf(ROOM_FLOOR + 2.2));
    x.fillStyle = "#6a4a30"; x.fillRect(0, yPanel, W, H - yPanel);
    for (let i = 0; i < 48; i++) { x.fillStyle = "#57391f"; x.fillRect((i / 48) * W, yPanel, 4, H - yPanel); }
    x.fillStyle = "#b8913f"; x.fillRect(0, yPanel - 8, W, 10);
    x.strokeStyle = "rgba(160,120,58,0.45)"; x.lineWidth = 4;
    for (let i = 0; i < 12; i++) { const u = (i + 0.5) / 12 * W; x.beginPath(); x.moveTo(u, yPanel - 8); for (let v = vOf(ROOM_FLOOR + 2.3); v <= 0.995; v += 0.01) x.lineTo(u + Math.sin(v * 23 + i * 1.7) * 3, py(v)); x.stroke(); }
    for (const yy of [1.2, 4.3]) { x.beginPath(); x.moveTo(0, py(vOf(yy))); x.lineTo(W, py(vOf(yy))); x.stroke(); }
    // the eyes: at the front (lathe u = 0 is +z), cut out with a brass rim
    const ve = vOf(1.6), rr = 1.25;
    for (const a of [0.42, -0.42]) {
      const u = ((a / (Math.PI * 2)) + 1) % 1; const cxp = u * W, cyp = py(ve);
      const ru = rr / (2 * Math.PI * 9.2) * W, rv = rr / (prof[prof.length - 1].y - prof[0].y) * H * 0.85;
      for (const du of [0, W, -W]) {
        x.save(); x.fillStyle = "#c9a44c"; x.beginPath(); x.ellipse(cxp + du, cyp, ru * 1.18, rv * 1.18, 0, 0, Math.PI * 2); x.fill();
        x.globalCompositeOperation = "destination-out"; x.beginPath(); x.ellipse(cxp + du, cyp, ru, rv, 0, 0, Math.PI * 2); x.fill(); x.restore();
      }
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
  }

  // capsule pool
  const capPool = [];
  for (let i = 0; i < 8; i++) { const c = new THREE.Mesh(geo.capsule, mat.capsule); c.visible = false; group.add(c); capPool.push(c); }

  // ---------- detail / focus ----------
  let detail = options.detail ?? 0, focusId = null, focusPath = null, focusLevel = maxLevel;
  const ss = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  const openLevels = Math.min(maxLevel, OPEN_LEVELS);
  // a small chart is all open by the time the WORLD's entry camera arrives (detail 0.57); a big one opens later
  const PACE = stations.size <= 12 ? 1.8 : stations.size <= 40 ? 0.9 : 1;
  function openOf(m, active) {
    if (big && !active && m.level > 1 && !(focusPath && focusPath.has(m))) return 0;
    if (!focusPath) return ss(Math.min(1, detail * PACE) * openLevels - (m.level - 1));
    const base = stage ? stage.level - 1 : 0;
    if (focusPath.has(m)) return m.level <= base ? 1 : ss(detail * (focusLevel - base) - (m.level - 1 - base));
    if (stage) return m.level === stage.level ? ss(detail) : 0;
    return ss(Math.min(1, detail * PACE) * openLevels - (m.level - 1));
  }
  function ownerMachines(id) { const path = []; let x = nodeById.get(id); while (x) { const m = machById.get(x.id); if (m && m.kind !== "bench") path.unshift(m); x = parentOf.get(x.id); } return path; }
  function visibleChain(m) { for (let p = m.parent; p; p = p.parent) if (p.kind !== "bench" && p.open < 0.04) return false; return true; }
  function stageFor(id) {
    if (!id) return null;
    let m = machById.get(id);
    const st = stations.get(id); if ((!m || m.kind === "solo") && st) m = st.m;
    if (!m) return null;
    while (m && m.kind === "solo") m = m.parent;
    if (!m || m.level < 2) return null;
    return m;
  }
  function applyStage(m) {
    for (const r of recs) { r.chrome.visible = true; r.own.visible = true; for (const c of r.children) c.group.visible = true; }
    for (const p of pipeMeshes) p.visible = !m;
    if (!m) return;
    for (let a = m.parent; a; a = a.parent) {
      a.chrome.visible = false; a.own.visible = false;
      for (const c of a.children) { let on = false; for (let x = m; x; x = x.parent) if (x === c) on = true; c.group.visible = on; }
    }
  }

  // ---------- growth: open machines grow inside their parents; the layout follows ----------
  function grow(act, alive) {
    let changed = false;
    for (const r of recs) {
      if (!r.grows) continue;
      let o;
      if (r.kind === "bench") o = Math.max(0, ...r.children.map((c) => openOf(c, act.has(c.id) || alive)));
      else o = openOf(r, act.has(r.id));
      const k = K0 + (K1 - K0) * Math.round(o * 20) / 20; // in steps: a zoom re-lays out 20 times, not every frame
      if (Math.abs(k - r.k) > 1e-4) { r.k = k; changed = true; }
    }
    if (!changed) return false;
    const before = new Map(recs.map((r) => [r, `${r.size.w.toFixed(4)},${r.size.d.toFixed(4)},${(r.H || r.size.h).toFixed(4)}`]));
    const kb = new Map(recs.map((r) => [r, r.k]));
    layoutAll();
    for (const r of recs) { const ch = r.children.some((c) => c.lastK !== c.k || c.lastSig !== `${c.size.w.toFixed(4)},${c.size.d.toFixed(4)},${(c.H || c.size.h).toFixed(4)}`); if (ch || !r.applied) { applyLayout(r); r.applied = true; } }
    for (const r of recs) { r.lastK = r.k; r.lastSig = `${r.size.w.toFixed(4)},${r.size.d.toFixed(4)},${(r.H || r.size.h).toFixed(4)}`; }
    void before; void kb;
    return true;
  }

  // ---------- update ----------
  const _v = new V3(), _q = new THREE.Quaternion(), _c = new THREE.Color();
  function stateAt(m, s) {
    const i = upperBound(m.moveStarts, s) - 1;
    if (i < 0) return { rest: null, idx: -1 };
    const mv = m.moves[i];
    if (s < mv.end) return { travel: mv, u: (s - mv.start) / (mv.end - mv.start), idx: i };
    return { rest: mv.to, idx: i };
  }
  function lifeState(s) {
    for (const [a, b] of livesS) if (s >= a && s < b) return { alive: true, fade: 1 };
    let lastEnd = -Infinity; for (const [, b] of livesS) if (b <= s && b > lastEnd) lastEnd = b;
    return { alive: false, fade: lastEnd > -Infinity ? Math.max(0, 1 - (s - lastEnd) / 1.2) : 0 };
  }
  let lastAct = new Set(), lastT = 0, fitDirty = true;
  function update(t, dt) {
    const s = warp(t); lastT = t;
    const life = lifeState(s);
    const act = life.alive && sim.activeAt ? new Set(sim.activeAt(actorId, t)) : new Set(); lastAct = act;
    const lifeDim = life.alive ? 1 : 0.35 + 0.4 * life.fade;
    if (top) ensureChrome(top);
    if (grow(act, life.alive) || fitDirty) { refit(); fitDirty = false; if (!(dt > 0) || firstFit) { xf.s = xfTarget.s; xf.p.copy(xfTarget.p); firstFit = false; } if (gauges.length) buildPipes(); }
    // stage re-normalisation (eased; snapped when dt is 0 or missing)
    const k = dt > 0 ? 1 - Math.exp(-dt * 5) : 1;
    const moving = Math.abs(xf.s - xfTarget.s) > 1e-6 || xf.p.distanceToSquared(xfTarget.p) > 1e-10;
    if (moving) { xf.s = Math.abs(xf.s - xfTarget.s) < 1e-5 ? xfTarget.s : Math.exp(Math.log(xf.s) + (Math.log(xfTarget.s) - Math.log(xf.s)) * k); xf.p.lerp(xfTarget.p, k); if (xf.p.distanceToSquared(xfTarget.p) < 1e-10) xf.p.copy(xfTarget.p); }
    root.scale.setScalar(xf.s); root.position.copy(xf.p);
    if (moving || !table.userData.placed) { placeTable(); table.userData.placed = true; }
    for (const m of machines) {
      if (!m.chromeBuilt) { m.open = 0; continue; }
      const activeHere = act.has(m.id) || (m.node.id === "__root__" && life.alive) || (m === top && life.alive);
      m.open = openOf(m, activeHere);
      const o = m.open; const shown = visibleChain(m);
      if (o > 0.04 && shown) ensureInterior(m);
      resizePlates(m);
      const glowDoor = activeHere && m.parent && m.parent.kind === "machine";
      m.wallMat.color.copy(m.baseColor).multiplyScalar((activeHere ? 1 : 0.55) * lifeDim);
      if (m.doorMat) m.doorMat.emissiveIntensity = glowDoor && life.alive ? 0.9 : 0;
      const oo = Math.min(1, o * 2.2);
      m.beamG.position.y = m.beamY[0] + (m.beamY[1] - m.beamY[0]) * ss(o * 1.3);
      m.wallMat.opacity = 1 - 0.92 * oo; m.wallMat.depthWrite = oo < 0.35;
      m.lidMat.color.copy(m.baseColor).multiplyScalar((activeHere ? 1.08 : 0.6) * lifeDim);
      if (o > 0.005) housingFull(m);
      m.lidMat.opacity = 1 - oo; m.lidMat.depthWrite = oo < 0.35; if (m.lid) m.lid.visible = oo < 0.97;
      m.interior.visible = o > 0.04 && shown;
      let lit = null;
      if (!m.interiorBuilt) {
        if (m.kind === "solo") lit = act.has(m.id) ? m.id : null;
        else { const stt = stateAt(m, s); lit = stt.travel ? (stt.u > 0.92 ? stt.travel.to : null) : stt.rest; if (!m.moves.length && activeHere) { const c = kids(m.node).find((x) => act.has(x.id)); lit = c ? c.id : null; } }
      } else if (m.kind === "solo") {
        lit = act.has(m.id) ? m.id : null;
        const st = m.pads.get(m.id); const kick = kickAt(st.kicks, s);
        m.marble.visible = !!lit;
        if (lit) { m.marble.position.copy(st.pos).add(_v.set(0, PAD_TOP + MARBLE_R + (kick >= 0 ? Math.sin(Math.PI * kick) * 0.3 : 0), 0)); m.marble.rotation.y = kick >= 0 ? kick * 12 : 0; m.marble.scale.setScalar(1); }
        ringBell(st, kick);
        for (const tr of m.tracks) setTrack(tr, 0, true);
      } else {
        const stt = stateAt(m, s);
        let p = null, scale = 1, fast = false, tang = null;
        if (stt.travel) {
          const mv = stt.travel, u = stt.u; fast = !!mv.fast;
          const toDoor = mv.to && m.pads.get(mv.to)?.door, fromDoor = mv.from && m.pads.get(mv.from)?.door;
          if (mv.from && mv.to) { const c = moveCurve(m, mv); p = c.getPointAt(ease(u)).add(_v.set(0, MARBLE_R, 0)); if (fast) tang = c.getTangentAt(Math.min(0.999, ease(u))); lit = u > 0.92 ? mv.to : null; if (toDoor && u > 0.8) scale = Math.max(0.01, (1 - u) / 0.2); if (fromDoor && u < 0.2) scale = Math.max(0.01, u / 0.2); }
          else if (mv.to && mv.viaHist) {
            if (u < 0.45) { const w = u / 0.45; p = m.histPad.pos.clone().add(_v.set(0, PAD_TOP + MARBLE_R + 1.3 * (1 - w * w), 0)); }
            else p = trackCurve({ m, edge: { a: m.histPad.node.id, b: mv.to, srcs: new Set() }, kind: "arc", lane: 0 }).getPointAt(ease((u - 0.45) / 0.55)).add(_v.set(0, MARBLE_R, 0));
            lit = u > 0.92 ? mv.to : null;
          }
          else if (mv.to) { const c = moveCurve(m, mv); p = c.getPointAt(ease(u)).add(_v.set(0, MARBLE_R, 0)); scale = Math.min(1, u / 0.2); if (toDoor && u > 0.8) scale = Math.max(0.01, (1 - u) / 0.2); lit = u > 0.9 ? mv.to : null; }
          else if (mv.from && mv.death) { const q = m.pads.get(mv.from).pos; p = q.clone().add(_v.set(0, PAD_TOP + MARBLE_R - 0.3 * u, 0)); scale = 1 - u; }
          else if (mv.from) { const c = moveCurve(m, mv); p = c.getPointAt(ease(u)).add(_v.set(0, MARBLE_R, 0)); scale = Math.max(0.01, Math.min(1, (1 - u) / 0.25, fromDoor ? u / 0.2 : 1)); }
          if (fromDoor && !mv.to && u < 0.2) scale = Math.min(scale, Math.max(0.01, u / 0.2));
        } else if (stt.rest) {
          lit = stt.rest; const st = m.pads.get(stt.rest);
          if (st && !st.door) {
            p = st.pos.clone().add(_v.set(0, PAD_TOP + MARBLE_R, 0));
            const kk = kickAt(st.kicks, s); if (kk >= 0) p.y += Math.sin(Math.PI * kk) * 0.32;
            ringBell(st, kk);
          } else if (st) ringBell(st, kickAt(st.kicks, s)); // in a compound: its own marble is inside; its door glows
        }
        if (!p && !stt.travel && !stt.rest && !m.moves.length && activeHere) { const c = kids(m.node).find((x) => act.has(x.id)); if (c && m.pads.has(c.id)) { lit = c.id; const st = m.pads.get(c.id); if (!st.door) p = st.pos.clone().add(_v.set(0, PAD_TOP + MARBLE_R, 0)); } }
        m.marble.visible = !!p && scale > 0.02;
        if (p) {
          m.marble.position.copy(p);
          if (tang) { _q.setFromUnitVectors(_v.set(0, 0, 1), tang.normalize()); m.marble.quaternion.copy(_q); m.marble.scale.set(0.7, 0.7, 2.6); }
          else { m.marble.rotation.set(s * 4, 0, 0); m.marble.scale.setScalar(Math.max(0.01, scale)); }
        }
        if (m.ghost) {
          let mem = null;
          if (!p && life.alive && stt.idx >= 0) { for (let i = stt.idx; i >= 0; i--) { const mv = m.moves[i]; if (mv.death) break; if (mv.from && !mv.to) { mem = mv.from; break; } if (mv.to) break; } }
          m.ghost.visible = !!(mem && m.pads.has(mem) && !m.pads.get(mem).door && m.remembers);
          if (m.ghost.visible) m.ghost.position.copy(m.pads.get(mem).pos).add(_v.set(0, PAD_TOP + MARBLE_R, 0));
        }
        const curMv = stt.idx >= 0 ? m.moves[stt.idx] : null;
        const g = stt.travel ? 1 : curMv ? Math.max(0, 1 - (s - curMv.end) / GLOW) : 0;
        for (const tr of m.tracks) setTrack(tr, curMv && curMv.track === tr ? g : 0, tr.firstTaken <= s);
        if (m.buses) for (const b of m.buses) setTrack(b, curMv && curMv.track && curMv.track.bus === b ? g : 0, b.firstTaken <= s);
      }
      const hk = kickAt(m.hopperKicks, s);
      if (m.funnel) m.funnel.scale.setScalar(hk >= 0 ? 1 + 0.25 * Math.sin(Math.PI * hk) : 1);
      // a closed machine says which part runs, in the dark window of its beam
      if (m.window) {
        const want = m.open < 0.5 && lit ? lit : null;
        if (want !== m.windowText) {
          m.windowText = want;
          if (want) { const t2 = plateTexture(want, "window"); m.window.material = t2.mat; m.window.userData.plate = { text: want, h: 1, maxW: 1, aspect: t2.aspect, kind: "window", m, comp: false }; plateMeshes.add(m.window); m.window.visible = true; fitChrome(m); }
          else m.window.visible = false;
        }
      }
      if (m.lampIM && m.lampLit !== lit) {
        if (m.lampLit && m.pads.has(m.lampLit) && m.pads.get(m.lampLit).inst != null) m.lampIM.setColorAt(m.pads.get(m.lampLit).inst, COL.lampOff);
        if (lit && m.pads.has(lit) && m.pads.get(lit).inst != null) { const st = m.pads.get(lit); m.lampIM.setColorAt(st.inst, _c.copy(st.exc ? COL.lampExc : st.final ? COL.lampFinal : COL.lampOn).multiplyScalar(lifeDim)); }
        m.lampIM.instanceColor.needsUpdate = true; m.lampLit = lit;
      }
      if (m.interiorBuilt && m.interior.visible) for (const st of m.padList) if (st.clock) {
        let run = null; for (const tm of st.timers) if (t >= tm.t0 && t < tm.t1) run = tm;
        st.hand.visible = st.clockWedge.visible = !!run; st.clockFace.emissiveIntensity = run ? 0.45 : 0.08;
        if (run) { const u = Math.min(1, (t - run.t0) / run.delay); st.hand.rotation.z = -u * Math.PI * 2; const q = Math.round(u * 48); if (st.wedgeQ !== q) { st.wedgeQ = q; st.clockWedge.geometry.dispose(); owned.geos.delete(st.clockWedge.geometry); st.clockWedge.geometry = G(new THREE.CircleGeometry(0.16, 24, Math.PI / 2 - (q / 48) * Math.PI * 2, Math.max(0.001, (q / 48) * Math.PI * 2))); } }
      }
      if (m.marble) { const mm = m.marble.material; if (life.alive) { mm.emissiveIntensity = 0.75; mm.color.setHex(0xeef8ff); } else { mm.emissiveIntensity = 0; mm.color.setHex(0x6a7080); } }
      if (m.interiorBuilt) for (const st of m.padList) if (st.tubeMat) {
        const on = act.has(st.node.id) && (!st.childIds.length || st.childIds.some((c) => (sim.alive ? sim.alive(c, t) : true)));
        st.tubeMat.emissiveIntensity = on ? 0.9 + 0.4 * Math.sin(s * 6) : 0; st.tubeOn = on;
      }
    }
    // push-buttons: only for the events that would move the actor now
    if (INTERACTIVE) { const live = new Set(affordanceList().map((a) => a.button).filter(Boolean)); for (const m of machines) for (const tr of m.tracks) for (const b of tr.buttons) { b.g.visible = live.has(b); mat.button.emissiveIntensity = 0.25; } }
    // capsules: in at the inlet, a flight to the funnel of the machine that takes them, a drop, gone
    root.updateMatrixWorld(true);
    let n = 0;
    for (let i = upperBound(capS, s + CAP_FLY) - 1; i >= 0 && n < capPool.length; i--) {
      const c = capsules[i]; const u = (s - (c.s0 - CAP_FLY)) / (CAP_FLY + 0.1); if (u > 1) { if (s - c.s0 > 3) break; continue; } if (u < 0) continue;
      let m = c.m; if (!m) continue;
      while (m && (!m.funnel || !m.chromeBuilt || !m.chrome.visible || !m.group.visible || !visibleChain(m) || !effectiveVisible(m.group))) { m = m.parent; while (m && m.kind === "bench") m = m.parent; }
      if (!m) continue;
      const mesh = capPool[n++]; mesh.visible = true;
      const mouth = group.worldToLocal(m.funnel.getWorldPosition(new V3())).add(_v.set(0, 0.02, 0));
      const fs = m.funnel.getWorldScale(new V3()).x / group.getWorldScale(new V3()).x;
      const sc = Math.min(1.4, Math.max(0.45, fs * 1.1));
      const above = mouth.clone().add(new V3(0, 0.9 * sc + 0.4, 0));
      const fly = 0.78;
      if (u < fly) { const w = ease(u / fly); const a = new V3(...INLET).add(new V3(0, -0.2, 0)); const ctl = a.clone().lerp(above, 0.5).add(new V3(0, 1.2, 0)); mesh.position.set((1 - w) * (1 - w) * a.x + 2 * (1 - w) * w * ctl.x + w * w * above.x, (1 - w) * (1 - w) * a.y + 2 * (1 - w) * w * ctl.y + w * w * above.y, (1 - w) * (1 - w) * a.z + 2 * (1 - w) * w * ctl.z + w * w * above.z); mesh.rotation.set(0, 0, Math.PI / 2 * (1 - w)); mesh.scale.setScalar(sc); }
      else { const w = (u - fly) / (1 - fly); mesh.position.copy(above).lerp(mouth, w * w); mesh.rotation.set(0, 0, 0); mesh.scale.setScalar(Math.max(0.01, sc * (w < 0.7 ? 1 : 1 - (w - 0.7) / 0.3))); }
    }
    for (; n < capPool.length; n++) capPool[n].visible = false;
    // gauges
    if (gauges.length) {
      const vals = sim.valuesAt ? sim.valuesAt(actorId, t) : {};
      for (const g of gauges) {
        const v = vals[g.id];
        let flash = 0, pulseU = -1;
        for (const ch of g.changes) { if (ch.s - 0.5 <= s && s < ch.s) pulseU = (s - (ch.s - 0.5)) / 0.5; if (ch.s <= s && s < ch.s + 0.8) flash = 1 - (s - ch.s) / 0.8; }
        if (g.kind === "tube") {
          const cnt = Math.min(16, v == null ? 0 : Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : 1);
          if (g.last !== cnt) { g.balls.count = cnt; for (let i = 0; i < cnt; i++) { _o.scale.setScalar(1); _o.position.set(((i % 2) - 0.5) * 0.09, 0.22 + i * 0.09, 0); _o.updateMatrix(); g.balls.setMatrixAt(i, _o.matrix); } g.balls.instanceMatrix.needsUpdate = true; g.last = cnt; }
          g.ballMat.emissive.setRGB(flash, flash * 0.7, flash * 0.3);
        } else if (g.kind === "dial") {
          const num = typeof v === "number" ? v : 0;
          g.needleG.rotation.z = -((-120 + 240 * Math.min(1, Math.abs(num) / g.max)) * Math.PI) / 180;
          if (g.last !== num) { drawDial(g, num); g.last = num; }
          g.faceMat.emissiveIntensity = 0.1 + 0.5 * flash;
        } else {
          const on = g.kind === "lever" ? v === true : v != null && v !== "" && v !== false;
          g.lampMat.emissiveIntensity = on ? 1.6 : 0.05 + flash;
          if (g.lever) g.lever.rotation.z = on ? -0.7 : 0.7;
        }
        for (const p of g.pipes) {
          p.mat.emissiveIntensity = 0.9 * flash;
          if (pulseU >= 0 && p.writer && !stage) { p.pulse.visible = true; p.pulse.position.copy(p.curve.getPointAt(1 - pulseU)); } else p.pulse.visible = false;
        }
      }
    }
  }
  let firstFit = true;
  function ringBell(st, kick) { if (st && st.bell) st.bell.rotation.z = kick >= 0 ? Math.sin(kick * Math.PI * 6) * 0.6 * (1 - kick) : 0; }
  function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
  function kickAt(list, s) { if (!list.length) return -1; const i = upperBound(list, s) - 1; if (i < 0) return -1; const u = (s - list[i]) / 0.42; return u < 1 ? u : -1; }
  function setTrack(tr, glow, taken) {
    tr.mat.color.copy(tr.baseCol).multiplyScalar((taken ? 1 : 0.45) + 0.25 * glow); tr.mat.emissiveIntensity = 1.4 * glow;
  }

  // ---------- affordances: what the visitor could send now ----------
  function lca(a, b) { const anc = new Set(); for (let x = a; x; x = parentOf.get(x.id)) anc.add(x); for (let x = b; x; x = parentOf.get(x.id)) if (anc.has(x)) return x; return null; }
  function drawnTrack(S, T) { // the track a transition from S to T is drawn as (README "Tracks")
    if (!T) return null;
    if (T === S) { const p = parentOf.get(S.id); const m = p && machById.get(p.id); return m ? trackIn(m, `${S.id}|${S.id}`) : null; }
    if (isDesc(T, S) && T !== S) { const m = machById.get(S.id); const c = childContaining(S, T.id); return m && c ? trackIn(m, `*|${c.id}`) : null; }
    let P = lca(S, T); if (!P) return null;
    if (P === T) { const pp = parentOf.get(T.id); const m = pp && machById.get(pp.id); return m ? trackIn(m, `${T.id}|${T.id}`) : null; }
    const m = machById.get(P.id); if (!m || m.kind !== "machine") return null;
    const a = childContaining(P, S.id), b = childContaining(P, T.id); return a && b ? trackIn(m, `${a.id}|${b.id}`) : null;
  }
  function trackIn(m, k) { return m.trackByKey.get(k + "|0") || m.trackByKey.get(k + "|1") || null; }
  function affordanceList() {
    const out = []; const seen = new Set();
    // deepest first, as SCXML selects: a deeper state's transition on an event wins over its ancestors'
    const ids = [...lastAct].filter((id) => nodeById.has(id)).sort((a, b) => depth(b) - depth(a));
    const taken = new Set();
    for (const id of ids) {
      const S = nodeById.get(id);
      for (const tr of S.transitions || []) {
        if (!tr.event) continue;
        for (const ev of tr.event.split(/\s+/).filter((x) => x && !x.includes("*") && !/^(done|error)(\.|$)/.test(x))) {
          const T = (tr.targets || [])[0] ? nodeById.get(tr.targets[0]) : null;
          const key = `${ev}|${S.id}|${(tr.targets || []).join(",")}`; if (seen.has(key)) continue; seen.add(key);
          const track = T ? drawnTrack(S, T) : null;
          const button = track && track.buttons ? track.buttons.find((b) => b.ev === ev) : null;
          const st = stations.get(S.id);
          const shadowed = taken.has(ev); // an unguarded deeper (or earlier) transition already takes it
          out.push({ event: ev, from: S.id, to: T ? T.id : null, targets: tr.targets || [], cond: tr.cond || null, preempted: shadowed, object: (button && button.body) || (track && track.mesh) || (st && (st.bell || st.group)) || null, button: button || null, track: track || null });
        }
        if (!tr.cond) for (const ev of tr.event.split(/\s+/)) taken.add(ev);
      }
    }
    return out;
  }
  function depth(id) { let d = 0; for (let x = nodeById.get(id); x && parentOf.get(x.id); x = parentOf.get(x.id)) d++; return d; }

  // ---------- pick / focus ----------
  const hits = [];
  function effectiveVisible(o) { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; }
  function pick(raycaster) {
    hits.length = 0; group.updateMatrixWorld(true);
    raycaster.intersectObjects(pickables, false, hits);
    for (const h of hits) {
      if (!effectiveVisible(h.object)) continue;
      const pk = h.object.userData.pick;
      if (pk.kind === "event") { const a = affordanceList().find((x) => x.event === pk.event && x.track === pk.track && !x.preempted) || affordanceList().find((x) => x.event === pk.event && x.track === pk.track); if (!a) continue; return { kind: "event", id: `${a.from}:${a.event}`, event: a.event, from: a.from, to: a.to, targets: a.targets, object: h.object, point: h.point }; }
      let id = pk.id;
      if (h.object.userData.pickIds) id = h.object.userData.pickIds[h.instanceId];
      if (pk.kind === "state" && machById.has(id)) { const m = machById.get(id); if (m.open > 0.5 && (h.object === m.walls || h.object === m.lid)) continue; }
      return { kind: pk.kind, id, object: h.object, point: h.point };
    }
    return null;
  }
  function targetBounds(id) {
    group.updateMatrixWorld(true); root.updateMatrixWorld(true);
    const m = id ? machById.get(id) : null, st = id ? stations.get(id) : null;
    let b;
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    if (m && top) b = recBox(m);
    else if (st && st.m.own) { const sc = st.m.own.getWorldScale(new V3()).x / root.getWorldScale(new V3()).x; const rp = st.m.own.localToWorld(st.pos.clone()).applyMatrix4(inv); b = new THREE.Box3(rp.clone().add(new V3(-0.6 * sc, 0, -0.6 * sc)), rp.clone().add(new V3(0.6 * sc, 1.0 * sc, 0.6 * sc))); }
    else b = top ? recBox(top) : new THREE.Box3(new V3(-1, -1, -1), new V3(1, 1, 1));
    b.applyMatrix4(new THREE.Matrix4().compose(xfTarget.p, new THREE.Quaternion(), new V3(xfTarget.s, xfTarget.s, xfTarget.s)));
    b.applyMatrix4(group.matrixWorld);
    const sphere = b.getBoundingSphere(new THREE.Sphere());
    return { center: sphere.center, radius: sphere.radius, box: b, object: m ? m.group : st ? st.group || st.m.group : group };
  }
  function focus(id) {
    focusId = id && (machById.has(id) || stations.has(id)) ? id : null;
    if (!focusId) { focusPath = null; focusLevel = maxLevel; }
    else {
      const path = ownerMachines(focusId); focusPath = new Set(path);
      const st = stations.get(focusId); if (st && !machById.has(focusId)) { focusPath.add(st.m); for (let p = st.m.parent; p; p = p.parent) focusPath.add(p); }
      for (const m of [...focusPath]) for (let p = m.parent; p; p = p.parent) focusPath.add(p);
      focusLevel = Math.max(1, ...[...focusPath].filter((m) => m.kind !== "bench").map((m) => m.level));
    }
    const ns = stageFor(focusId);
    if (ns !== stage) { stage = ns; applyStage(stage); fitDirty = true; }
    if (fitDirty) { grow(lastAct, true); refit(); fitDirty = false; if (gauges.length) buildPipes(); }
    return api.focusBounds;
  }
  function setDetail(d) { detail = Math.min(1, Math.max(0, d)); }
  function dispose() {
    group.removeFromParent(); if (room) room.removeFromParent();
    for (const g of owned.geos) g.dispose(); for (const m of owned.mats) m.dispose(); for (const t of owned.texs) t.dispose(); for (const im of owned.inst) im.dispose();
  }

  const api = {
    group, update, setDetail, pick, focus, dispose, room, refresh,
    get focusBounds() { return targetBounds(focusId); },
    get detail() { return detail; },
    get focusId() { return focusId; },
    get stageId() { return stage ? stage.id : null; },
    levels: maxLevel,
    states: () => [...stations.keys(), ...[...machById.keys()].filter((k) => !stations.has(k))],
    pathTo: (id) => ownerMachines(id).map((m) => m.id),
    boundsOf: (id) => targetBounds(id),
    movesOf: (id) => { const m = machById.get(id); return m && m.moves ? m.moves.map(({ start, end, from, to, ev, fast, death }) => ({ start, end, from, to, ev, fast: !!fast, death: !!death })) : []; },
    outlets: () => { group.updateMatrixWorld(true); return [...stations.values()].filter((st) => st.outlet).map((st) => ({ stateId: st.node.id, invokes: st.invokes, childIds: st.childIds, active: !!st.tubeOn, position: st.outlet.getWorldPosition(new V3()), visible: effectiveVisible(st.outlet) })); },
    // the events that would make a transition now (the configuration of the last update), deepest state first
    affordances: () => affordanceList().map(({ event, from, to, targets, cond, preempted, object }) => ({ event, from, to, targets, cond, preempted, object, pick: { kind: "event", id: `${from}:${event}`, event, from, to, targets, object } })),
    // every engraved plate now shown: {text, kind, level, focal (it belongs to an open machine), mesh}
    plates: () => [...plateMeshes].filter((x) => effectiveVisible(x) && x.parent).map((mesh) => { const p = mesh.userData.plate; const m = p.m; return { text: p.text, kind: p.kind, level: m ? m.level : 0, focal: !!(m && m.open > 0.5 && (p.kind === "state" || p.kind === "event")), mesh }; }),
    stats: () => { let meshes = 0, inst = 0; group.traverse((o) => { if (o.isInstancedMesh) inst++; else if (o.isMesh) meshes++; }); return { meshes, instanced: inst, machines: machines.length, stations: stations.size, levels: maxLevel }; },
  };
  layoutAll(); for (const r of recs) { r.lastK = r.k; r.lastSig = `${r.size.w.toFixed(4)},${r.size.d.toFixed(4)},${(r.H || r.size.h).toFixed(4)}`; }
  if (!top) { const c = new THREE.Mesh(geo.box, mat.iron); c.scale.set(3, 2, 2); c.position.y = 1; root.add(c); c.userData.pick = { kind: "state", id: actorId }; pickables.push(c); }
  update(0, 0);
  return api;
}

function upperBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; }
