// board/board.js: the telemetry board of "The Office".
//
// One 2D canvas that WORLD maps onto a wall screen. It shows the recorded run as a trace: one row
// per participant, time left to right in the shared warped time (sim.warp of each event's `at`),
// spans where someone is busy with something nameable (solid = doing, hatched = waiting),
// message marks between rows (fan-outs bundled, log traffic faint), a playhead at "now".
// Above the lanes: the seven behaviours (trace.stories) as chips and brackets. Below: the what-if
// reels. Everything is drawn in a 1600 x 900 design space and scaled to the canvas size.
//
// createBoard({ sim, width, height, rows?, baseUrl?, createSim?, now? }) -> see README.md

const DW = 1600, DH = 900;

// ---------------------------------------------------------------- layout (design px)
const PAD = 24;
const CHIP_Y = 14, CHIP_H = 84;
const HEAD_Y = 104, HEAD_H = 46;                 // one line of text: the picked behaviour / what-if
const BAND_Y = 152, BAND_H = 48;                 // story brackets
const LANE_Y = 204, LANE_B = 766;                // lanes
const AXIS_Y = 766, AXIS_H = 38;                 // time ticks + the playhead's handle
const TAB_Y = 806, TAB_H = 80;
const LABEL_X = PAD - 6, LABEL_W = 232;
const TL_X0 = PAD + LABEL_W + 10, TL_X1 = DW - PAD;

// ---------------------------------------------------------------- palette
const C = {
  bg: "#0b0f14", rowA: "#121821", rowB: "#0f141b", grid: "#1f2833", text: "#f4efe2", dim: "#7d8794",
  amber: "#ffb000", teal: "#2ee6b0", violet: "#b58cff", red: "#ff6248", yellow: "#ffe14d", grey: "#8a94a6",
  world: "#ff4fd8", play: "#ffffff", chainBack: "#fff2c2", chainFwd: "#57e8ff", select: "#ffe14d",
};
const KINDS = {
  ask: { color: C.amber, hatch: false, labels: ["ASKING THE MODEL", "ASKING MODEL", "ASKING", "ASK"] },
  toolwait: { color: C.teal, hatch: true, labels: ["WAITING FOR TOOLS", "WAITING TOOLS", "TOOLS"] },
  backoff: { color: C.red, hatch: true, labels: ["BACKING OFF", "BACKOFF", "WAIT"] },
  think: { color: C.violet, hatch: true, labels: ["THINKING", "THINK"] },
  write: { color: C.violet, hatch: false, labels: ["WRITING", "WRITE"] },
  tool: { color: C.teal, hatch: false, labels: ["RUNNING A TOOL", "RUNNING TOOL", "TOOL"] },
  offline: { color: C.grey, hatch: true, labels: ["OFFLINE", "OFF"] },
  queued: { color: C.yellow, hatch: true, labels: ["WAITING IN QUEUE", "QUEUED", "Q"] },
};
const STORY_COLORS = ["#4fc3ff", "#2ee6b0", "#ffe14d", "#ff9f40", "#ff6248", "#a99bff", "#8dff6b"];
const STORY_NAMES = { "send-message": "SEND", tools: "TOOLS", queue: "QUEUE", steer: "STEER", stop: "STOP", offline: "OFFLINE", join: "JOIN" };
const WORLD_TABS = [
  { id: null, label: "AS RECORDED" },
  { id: "model-fails", label: "MODEL FAILS" },
  { id: "client-offline-during-tool", label: "PYTHON DROPS" },
  { id: "stop-mid-answer", label: "STOP EARLY" },
  { id: "no-tool-provider", label: "NO PYTHON" },
];
const ROW_NAMES = { llm: "MODEL" };
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const font = (px, w = 800) => `${w} ${px}px ${FONT}`;

// ---------------------------------------------------------------- deriving a take (base or world)
const isFaint = (m) => m.name === "log.batch" || m.to === "log" || m.name === "snapshot.send" || /^invoke package/.test(m.name);

function deriveTake(S, rows, label) {
  const evs = S.eventsBetween(-Infinity, Infinity);
  const byId = new Map(evs.map((e) => [e.id, e]));
  const actors = new Map(S.actors.map((a) => [a.id, a]));
  const rowSet = new Set(rows);
  const spans = []; // {row, actor, kind, t0, t1, a0, a1, id}
  const end = S.duration;

  // spans from active configurations
  const RULES = {
    host: [
      ["turn", (s) => s.has("turn")],
      ["ask", (s) => s.has("turn") && s.has("requesting")],
      ["toolwait", (s) => s.has("turn") && s.has("tools")],
      ["backoff", (s) => s.has("backoff")],
    ],
    client: [
      ["tool", (s) => s.has("working")],
      ["offline", (s) => s.has("offline")],
      ["hostbusy", (s) => s.has("host-busy")],
      ["gone", (s) => s.has("left")],
    ],
  };
  const MODEL_RULES = [["think", (s) => s.has("turn") && s.has("connecting")], ["write", (s) => s.has("turn") && (s.has("writing") || s.has("calling"))]];
  const open = new Map(); // key -> {start event}
  const close = (key, row, actor, kind, e0, at1, t1) => {
    if (at1 > e0.at + 1e-6) spans.push({ row, actor, kind, t0: e0.t, a0: e0.at, t1, a1: at1, id: e0.id, take: label });
  };
  const apply = (actorId, row, rules, e, set, keyPrefix) => {
    for (const [kind, pred] of rules) {
      const key = `${keyPrefix}|${kind}`;
      const on = pred(set);
      const o = open.get(key);
      if (on && !o) open.set(key, e);
      else if (!on && o) { close(key, row, actorId, kind, o, e.at, e.t); open.delete(key); }
    }
  };
  for (const e of evs) {
    if (e.type === "config" || e.type === "end") {
      const a = actors.get(e.actor); if (!a) continue;
      const set = new Set(e.type === "end" ? [] : e.active);
      const rules = RULES[a.chart];
      if (rules && rowSet.has(e.actor)) apply(e.actor, e.actor, rules, e, set, e.actor);
      if (a.chart === "host" && rowSet.has("llm")) apply("llm", "llm", MODEL_RULES, e, set, "llm");
    } else if (e.type === "data" && e.key === "queue" && rowSet.has(e.actor)) {
      const n = parseInt(String(e.summary), 10) || 0;
      const key = `${e.actor}|queued`; const o = open.get(key);
      if (n > 0 && !o) open.set(key, e);
      else if (n === 0 && o) { close(key, e.actor, e.actor, "queued", o, e.at, e.t); open.delete(key); }
    }
  }
  for (const [key, o] of open) {
    const [actor, kind] = key.split("|");
    const a = actors.get(actor);
    const t1 = a && a.diedAt != null ? a.diedAt : end;
    close(key, actor, actor, kind, o, t1, t1);
  }

  // messages, bundled
  const rowOf = (id) => {
    if (rowSet.has(id)) return id;
    if (id && id.startsWith("tools.") && rowSet.has(id.slice(6))) return id.slice(6);
    return null;
  };
  const bundles = []; const bundleOf = new Map(); const keyed = new Map();
  for (const m of evs) {
    if (m.type !== "message") continue;
    const fr = rowOf(m.from); const targets = m.to === "*" ? rows.filter((r) => r !== fr) : [rowOf(m.to)].filter(Boolean);
    if (!fr && !targets.length) continue;
    const faint = isFaint(m);
    const key = `${m.t}|${m.from}|${m.name}|${m.depth}`;
    let b = keyed.get(key);
    if (!b) {
      b = { key, id: m.id, ids: [], at: m.at, t: m.t, from: m.from, fromRow: fr, to: [], toRows: [], name: m.name, faint, take: label };
      keyed.set(key, b); bundles.push(b);
    }
    b.ids.push(m.id); b.to.push(m.to);
    for (const r of targets) if (!b.toRows.includes(r)) b.toRows.push(r);
    bundleOf.set(m.id, b);
  }
  for (const b of bundles) b.kind = b.fromRow && b.toRows.some((r) => r !== b.fromRow) ? "link" : "tick";

  // causal links: message <- via (the step that sent it) or cause; transition <- cause
  const parentOf = (e) => (e.type === "message" ? e.via || e.cause : e.type === "transition" || e.type === "spawn" ? e.cause : null);
  const children = new Map();
  for (const e of evs) { const p = parentOf(e); if (p) { if (!children.has(p)) children.set(p, []); children.get(p).push(e); } }

  return { S, label, evs, byId, spans, bundles, bundleOf, children, parentOf, rowOf, actors, duration: S.duration, stories: S.stories || [] };
}

// ---------------------------------------------------------------- the board
export function createBoard({ sim, width = DW, height = DH, rows, baseUrl, createSim, now } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  const stat = document.createElement("canvas"); stat.width = width; stat.height = height;
  const sctx = stat.getContext("2d");
  const sx = width / DW, sy = height / DH;
  const clock = now || (() => performance.now());
  const dataBase = baseUrl ? new URL(baseUrl, document.baseURI) : new URL("../data/llm-chat/", import.meta.url);

  const present = new Set(sim.actors.map((a) => a.id));
  const ROWS = (rows || ["ada", "bo", "host", "terminal", "python", "llm"]).filter((r) => present.has(r));
  const base = deriveTake(sim, ROWS, "base");
  const stories = (sim.stories || []).slice(0, 7);
  const worldRefs = (sim.trace.worlds || []);

  // state
  let t = 0;                     // playhead, virtual ms
  let world = null;              // {id, ref, take}
  let loading = null;            // world id being loaded
  const worldCache = new Map();  // id -> Promise<take>
  let storyId = null;
  let msgSel = null;             // {bundle, chain}
  let hlActor = null;            // row lit by the room (or by a tap)
  let hover = null;
  let view = null;               // {w0, w1} in axis seconds; null = whole run
  let framed = false;            // the view was framed by a pick (no auto-follow)
  let lastUser = -1e9;
  let staticKey = "";
  let lastDrawKey = "";
  const listeners = { seek: [], select: [], world: [] };
  const emit = (ev, payload) => { for (const fn of listeners[ev] || []) try { fn(payload); } catch (err) { console.error(err); } };

  // ---------------------------------------------------------- the time axis
  // Base: sim.warp. A what-if: its own sim's warp (identical up to the fork), extended linearly
  // past its end so the base run's tail stays visible.
  const axis = () => (world ? world.take.S : sim);
  const axisEnd = () => Math.max(sim.duration, world ? world.take.duration : 0);
  function W(at) {
    const S = axis(); const d = S.duration;
    if (at <= d) return S.warp(at);
    return S.warp(d) + (at - d) * 0.0005;
  }
  function Winv(s) {
    const S = axis(); const d = S.duration; const sd = S.warp(d);
    if (s <= sd) return S.unwarp(s);
    return d + (s - sd) / 0.0005;
  }
  const fullView = () => ({ w0: 0, w1: W(axisEnd()) + 0.6 });
  const V = () => view || fullView();
  const X = (at) => { const v = V(); return TL_X0 + ((W(at) - v.w0) / (v.w1 - v.w0)) * (TL_X1 - TL_X0); };
  const tAtX = (x) => { const v = V(); const s = v.w0 + ((x - TL_X0) / (TL_X1 - TL_X0)) * (v.w1 - v.w0); return Math.max(0, Math.min(axisEnd(), Winv(s))); };
  const rowH = (LANE_B - LANE_Y) / ROWS.length;
  const rowTop = (r) => LANE_Y + ROWS.indexOf(r) * rowH;
  const rowMid = (r) => rowTop(r) + rowH / 2;
  const forkAt = () => (world ? world.ref.forkAt : Infinity);
  const forkX = () => (world ? X(sim.event(world.ref.divergesAtEvent)?.at ?? world.ref.forkAt) : Infinity);

  // ---------------------------------------------------------- what is lit
  function storyLit() {
    const st = stories.find((s) => s.id === storyId); if (!st) return null;
    const ids = new Set(st.steps.flatMap((s) => s.events));
    for (const id of [...ids]) for (const c of base.children.get(id) || []) if (c.type === "message" && !isFaint(c)) ids.add(c.id);
    const rowsLit = new Set(); const bundlesLit = new Set();
    for (const s of st.steps) { const r = base.rowOf(s.actor); if (r) rowsLit.add(r); }
    for (const id of ids) {
      const b = base.bundleOf.get(id);
      if (b && !b.faint) { bundlesLit.add(b); if (b.fromRow) rowsLit.add(b.fromRow); b.toRows.forEach((r) => rowsLit.add(r)); }
      const e = base.byId.get(id); if (e && e.actor && base.rowOf(e.actor)) rowsLit.add(base.rowOf(e.actor));
    }
    const t0 = Math.min(...st.steps.map((s) => s.t0)), t1 = Math.max(...st.steps.map((s) => s.t1));
    const ats = [...ids].map((id) => base.byId.get(id)?.at).filter((x) => x != null);
    const a0 = Math.min(t0, ...ats), a1 = Math.max(t1, ...ats);
    return { st, ids, rowsLit, bundlesLit, t0, t1, a0, a1, color: STORY_COLORS[stories.indexOf(st) % 7] };
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
        if (c.type === "message" && isFaint(c)) continue;
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
      const p = document.createElement("canvas"); p.width = p.height = 16;
      const q = p.getContext("2d"); q.globalAlpha = alpha;
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
    while (t2.length > 3 && g.measureText(t2 + "…").width > maxW) t2 = t2.slice(0, -1);
    return [t2 + "…", px];
  }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
  function arrowHead(g, x, y, dir, s) { g.beginPath(); g.moveTo(x, y); g.lineTo(x - s * 0.75, y - dir * s); g.lineTo(x + s * 0.75, y - dir * s); g.closePath(); g.fill(); }

  // ---------------------------------------------------------- the static layer
  function drawStatic() {
    const g = sctx;
    g.setTransform(sx, 0, 0, sy, 0, 0);
    g.fillStyle = C.bg; g.fillRect(0, 0, DW, DH);
    const lit = storyLit();
    drawChips(g, lit);
    drawHeader(g, lit);
    drawBand(g, lit);
    drawLanes(g, lit);
    drawAxis(g);
    drawTabs(g);
  }

  function drawChips(g, lit) {
    const n = Math.max(stories.length, 1), gap = 12;
    const w = (DW - 2 * PAD - gap * (n - 1)) / n;
    stories.forEach((s, i) => {
      const x = PAD + i * (w + gap); const col = STORY_COLORS[i % 7];
      const sel = s.id === storyId; const hov = hover && hover.type === "chip" && hover.id === s.id;
      rrect(g, x, CHIP_Y, w, CHIP_H, 14);
      g.fillStyle = sel ? col : "#18202a"; g.fill();
      g.lineWidth = sel ? 0 : 4; g.strokeStyle = col; if (!sel) g.stroke();
      // number disc
      g.fillStyle = sel ? "#0b0f14" : col;
      g.beginPath(); g.arc(x + 34, CHIP_Y + CHIP_H / 2, 20, 0, Math.PI * 2); g.fill();
      g.fillStyle = sel ? col : "#0b0f14"; g.font = font(26, 900); g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(i + 1), x + 34, CHIP_Y + CHIP_H / 2 + 1);
      const name = STORY_NAMES[s.id] || s.id.split(/[-_]/)[0].toUpperCase();
      const [txt, px] = fitSized(g, name, w - 76, [34, 30, 26]);
      g.font = font(px, 800);
      g.fillStyle = sel ? "#0b0f14" : (lit && !sel ? C.dim : C.text); g.textAlign = "left";
      g.fillText(txt, x + 62, CHIP_Y + CHIP_H / 2 + 2);
      if (hov && !sel) { rrect(g, x - 3, CHIP_Y - 3, w + 6, CHIP_H + 6, 16); g.lineWidth = 3; g.strokeStyle = C.text; g.stroke(); }
    });
  }

  function drawHeader(g, lit) {
    let text = null, color = C.text;
    if (lit) { text = lit.st.question; color = lit.color; }
    else if (msgSel) { const b = msgSel.bundle; text = `${b.name}${b.ids.length > 1 ? `  ×${b.ids.length}` : ""}`; color = C.select; }
    else if (world) { text = world.ref.change; color = C.world; }
    else if (loading) { text = "…"; color = C.world; }
    if (!text) return;
    g.font = font(30, 700); g.textBaseline = "middle"; g.textAlign = "left";
    let s = text; while (g.measureText(s).width > DW - 2 * PAD && s.length > 4) s = s.slice(0, -2);
    if (s !== text) s = s.slice(0, -1) + "…";
    g.fillStyle = color; g.fillText(s, PAD, HEAD_Y + HEAD_H / 2);
  }

  function storyRange(s) {
    const ids = s.steps.flatMap((st) => st.events).map((id) => base.byId.get(id)?.at).filter((x) => x != null);
    return [Math.min(...s.steps.map((st) => st.t0), ...ids), Math.max(...s.steps.map((st) => st.t1), ...ids)];
  }
  function bracketRects() {
    const lanes = [[], []]; const out = [];
    stories.forEach((s, i) => {
      const [a0, a1] = storyRange(s);
      let x0 = X(a0) - 8, x1 = X(a1) + 8; if (x1 - x0 < 34) { const c = (x0 + x1) / 2; x0 = c - 17; x1 = c + 17; }
      let lane = lanes.findIndex((l) => l.every(([p, q]) => x1 < p - 4 || x0 > q + 4)); if (lane < 0) lane = 1;
      lanes[lane].push([x0, x1]);
      out.push({ id: s.id, i, x0, x1, y: BAND_Y + 2 + lane * 23, h: 20 });
    });
    return out;
  }
  function drawBand(g, lit) {
    g.save(); g.beginPath(); g.rect(TL_X0 - 20, BAND_Y, TL_X1 - TL_X0 + 40, BAND_H); g.clip();
    for (const r of bracketRects()) {
      const col = STORY_COLORS[r.i % 7]; const sel = r.id === storyId;
      g.globalAlpha = (lit && !sel) || (world && r.x1 > forkX() + 8) ? 0.25 : 1;
      rrect(g, r.x0, r.y, r.x1 - r.x0, r.h, 6); g.fillStyle = sel ? col : col + "55"; g.fill();
      g.lineWidth = 2; g.strokeStyle = col; g.stroke();
      g.fillStyle = sel ? "#0b0f14" : col; g.font = font(17, 900); g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(r.i + 1), Math.max(r.x0 + 10, Math.min(r.x1 - 10, (r.x0 + r.x1) / 2)), r.y + r.h / 2 + 1);
    }
    g.restore(); g.globalAlpha = 1;
  }

  function drawLanes(g, lit) {
    const fx = forkX(); const fk = forkAt();
    // row backgrounds + labels
    ROWS.forEach((r, i) => {
      const y = rowTop(r);
      g.fillStyle = i % 2 ? C.rowB : C.rowA; g.fillRect(0, y, DW, rowH);
      const isHl = hlActor === r || (msgSel && msgSel.rows.has(r));
      const dim = lit && !lit.rowsLit.has(r);
      if (isHl) { g.fillStyle = "#ffffff12"; g.fillRect(0, y, DW, rowH); }
      const a = base.actors.get(r);
      const name = ROW_NAMES[r] || (a ? a.label : r).toUpperCase();
      const [txt, px] = fitSized(g, name, LABEL_W - 52, [38, 33, 29, 25]);
      g.font = font(px, 900); g.textAlign = "left"; g.textBaseline = "middle";
      g.fillStyle = isHl ? C.select : dim ? "#4a525c" : C.text; g.fillText(txt, LABEL_X + 42, y + rowH / 2 + 2);
      if (hover && hover.type === "row" && hover.row === r) { g.strokeStyle = C.text; g.lineWidth = 3; g.strokeRect(LABEL_X, y + 6, LABEL_W, rowH - 12); }
    });
    g.strokeStyle = C.grid; g.lineWidth = 2;
    ROWS.forEach((r) => { g.beginPath(); g.moveTo(0, rowTop(r)); g.lineTo(DW, rowTop(r)); g.stroke(); });

    g.save(); g.beginPath(); g.rect(TL_X0, LANE_Y, TL_X1 - TL_X0, LANE_B - LANE_Y); g.clip();
    // what-if: past the fork the lanes belong to the other take
    if (world && fx < TL_X1) { g.fillStyle = "#ff4fd80d"; g.fillRect(fx, LANE_Y, TL_X1 - fx + 10, LANE_B - LANE_Y); }
    // absent stretches (not born yet / left / never there)
    const absent = (take, r, xmin, xmax) => {
      const a = take.actors.get(r); const y = rowTop(r);
      const segs = [];
      if (!a) { if (r !== "llm") segs.push([xmin, xmax]); }
      else if (!a.external) { if (a.bornAt > 0) segs.push([X(-1), X(a.bornAt)]); if (a.diedAt != null) segs.push([X(a.diedAt), TL_X1 + 10]); }
      for (let [x0, x1] of segs) { x0 = Math.max(x0, xmin); x1 = Math.min(x1, xmax); if (x1 <= x0) continue; g.fillStyle = hatch(g, take === base ? "#2a323d" : "#3d2440"); g.fillRect(x0, y + 1, x1 - x0, rowH - 2); }
    };
    for (const r of ROWS) {
      if (world) { absent(base, r, TL_X0 - 10, Math.min(fx, TL_X1 + 10)); absent(world.take, r, fx, TL_X1 + 10); }
      else absent(base, r, TL_X0 - 10, TL_X1 + 10);
    }
    // spans
    const full = (s) => ({ y: rowTop(s.row) + 12, h: rowH - 24 });
    const labels = [];
    const box = (s, x0, x1, col, k, alpha, ghost) => {
      if (x1 < TL_X0 - 50 || x0 > TL_X1 + 50 || x1 <= x0) return;
      const top = rowTop(s.row);
      if (ghost) { // what would have happened: a thin strip at the top of the row
        g.globalAlpha = alpha * 0.65; g.fillStyle = col; rrect(g, x0, top + 4, x1 - x0, 12, 4); g.fill(); g.globalAlpha = 1; return;
      }
      const { y, h } = full(s);
      g.globalAlpha = alpha; rrect(g, x0, y, x1 - x0, h, 6);
      g.fillStyle = k.hatch ? hatch(g, col) : col; g.fill();
      if (k.hatch) { g.lineWidth = 3; g.strokeStyle = col; g.stroke(); }
      g.globalAlpha = 1;
      labels.push({ x0, x1, y, h, col, k, alpha });
    };
    const drawSpan = (s, take, alpha, xmin = -1e9) => {
      const k = KINDS[s.kind]; const top = rowTop(s.row);
      let x0 = X(s.a0), x1 = Math.max(X(s.a1), x0 + 3); x0 = Math.max(x0, xmin);
      const isW = take === "world"; const col = isW ? C.world : k ? k.color : C.amber;
      if (s.kind === "turn" || s.kind === "hostbusy") {
        const ghostPart = world && !isW;
        const seg = (a, b, gh) => {
          if (b <= a) return;
          g.globalAlpha = alpha * (s.kind === "hostbusy" ? 0.45 : 1) * (gh ? 0.3 : 1); g.fillStyle = col;
          if (s.kind === "turn") g.fillRect(a, top + (gh ? 15 : 3), b - a, gh ? 3 : 5); else g.fillRect(a, top + rowH - 8, b - a, 3);
          g.globalAlpha = 1;
        };
        if (ghostPart) { seg(x0, Math.min(x1, fx), false); seg(Math.max(x0, fx), x1, true); } else seg(x0, x1, false);
        return;
      }
      if (!k) return;
      if (world && !isW) { // split at the fork: before it, the shared run; after it, a ghost strip
        if (x0 < fx) box(s, x0, Math.min(x1, fx), col, k, alpha, false);
        if (x1 > fx) box(s, Math.max(x0, fx), x1, col, k, alpha, true);
      } else box(s, x0, x1, col, k, alpha, false);
    };
    const spanAlpha = (s) => {
      if (!lit) return msgSel ? (msgSel.rows.has(s.row) ? 0.95 : 0.35) : 1;
      if (!lit.rowsLit.has(s.row)) return 0.12;
      return s.a1 >= lit.a0 - 1 && s.a0 <= lit.a1 + 1 ? 1 : 0.22;
    };
    for (const s of base.spans) if (s.kind === "turn" || s.kind === "hostbusy") drawSpan(s, "base", spanAlpha(s));
    for (const s of base.spans) if (s.kind !== "turn" && s.kind !== "hostbusy") drawSpan(s, "base", spanAlpha(s));
    if (world) for (const s of world.take.spans) if (X(s.a1) > fx + 1) drawSpan(s, "world", lit ? 0.5 : 1, fx);

    // messages
    const drawBundle = (b, color, alpha, width) => {
      const x = X(b.at); if (x < TL_X0 - 20 || x > TL_X1 + 20) return;
      g.globalAlpha = alpha; g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width;
      if (b.faint) { // log traffic: a short tick at the foot of each row it reaches
        for (const r of new Set([...(b.toRows || []), b.fromRow].filter(Boolean))) { const yb = rowTop(r) + rowH - 3; g.beginPath(); g.moveTo(x, yb); g.lineTo(x, yb - 12); g.stroke(); }
        g.globalAlpha = 1; return;
      }
      if (b.kind === "link") {
        const y0 = rowMid(b.fromRow);
        const hs = Math.max(10, width * 3);
        const up = b.toRows.filter((r) => rowMid(r) < y0), down = b.toRows.filter((r) => rowMid(r) > y0);
        for (const grp of [up, down]) {
          if (!grp.length) continue;
          const far = grp.reduce((m, r) => (Math.abs(rowMid(r) - y0) > Math.abs(rowMid(m) - y0) ? r : m));
          const y1 = rowMid(far); const dir = y1 > y0 ? 1 : -1;
          g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1 - dir * hs * 0.9); g.stroke();
          for (const r of grp) arrowHead(g, x, rowMid(r), dir, hs);
        }
        g.beginPath(); g.arc(x, y0, width + 3, 0, Math.PI * 2); g.fill();
      } else {
        const r = b.fromRow || b.toRows[0]; const y = rowMid(r); const inbound = !b.fromRow;
        const len = rowH * 0.3;
        g.beginPath(); g.moveTo(x, inbound ? y - len - 8 : y - 4); g.lineTo(x, inbound ? y - 8 : y - len); g.stroke();
        if (inbound) arrowHead(g, x, y - 2, 1, 9); else { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
      }
      g.globalAlpha = 1;
    };
    const msgStyle = (b) => {
      const isWorld = b.take === "world";
      let color = isWorld ? C.world : C.text, alpha = b.faint ? 0.22 : b.kind === "tick" ? 0.55 : 0.8, width = b.faint ? 2 : b.kind === "tick" ? 2.5 : 3;
      if (lit) { if (lit.bundlesLit.has(b)) { color = lit.color; alpha = 1; width = 5; } else alpha *= 0.12; }
      if (msgSel) { if (msgSel.bundle === b) return null; alpha *= 0.3; }
      return [color, alpha, width];
    };
    const all = world ? [...base.bundles.filter((b) => X(b.at) <= fx + 0.5 && b.at <= fk + 1e-6), ...world.take.bundles.filter((b) => b.at > fk + 1e-6 && X(b.at) > fx - 0.5)] : base.bundles;
    for (const pass of [true, false]) for (const b of all) if (b.faint === pass) { const st = msgStyle(b); if (st) drawBundle(b, ...st); }

    // span labels on top of the marks, on a dark pill when hatched
    for (const L of labels) {
      const px = 26; const txt = fit(g, L.k.labels, L.x1 - L.x0 - 14, px);
      if (!txt) continue;
      g.globalAlpha = L.alpha; g.font = font(px, 900); g.textAlign = "left"; g.textBaseline = "middle";
      const tw = g.measureText(txt).width;
      const tx = Math.max(L.x0 + 7, Math.min(TL_X0 + 6, L.x1 - 7 - tw));
      const cy = L.y + L.h / 2;
      g.fillStyle = L.k.hatch ? "#0b0f14e6" : L.col; rrect(g, tx - 6, cy - 17, tw + 12, 34, 6); g.fill();
      g.fillStyle = L.k.hatch ? L.col : "#0b0f14"; g.fillText(txt, tx, cy + 1);
      g.globalAlpha = 1;
    }
    if (hover && hover.type === "msg") drawBundle(hover.bundle, C.select, 1, 5);
    if (hover && hover.type === "span") { const s = hover.span; const x0 = X(s.a0), x1 = Math.max(X(s.a1), x0 + 3); const { y, h } = full(s); g.lineWidth = 4; g.strokeStyle = C.text; rrect(g, x0 - 3, y - 3, x1 - x0 + 6, h + 6, 8); g.stroke(); }

    // the picked behaviour: numbered steps joined in order
    if (lit) drawSteps(g, lit.st.steps, base, lit.color);
    if (msgSel) drawChain(g, msgSel);
    g.restore();

    // fork marker and the what-if's end
    if (world && fx >= TL_X0 && fx <= TL_X1) {
      g.strokeStyle = C.world; g.lineWidth = 4; g.setLineDash([14, 10]);
      g.beginPath(); g.moveTo(fx, LANE_Y); g.lineTo(fx, LANE_B); g.stroke(); g.setLineDash([]);
      g.fillStyle = C.world; g.beginPath(); g.moveTo(fx, LANE_Y + 20); g.lineTo(fx - 14, LANE_Y); g.lineTo(fx + 14, LANE_Y); g.closePath(); g.fill();
    }
    if (world) {
      const ex = X(world.take.duration);
      if (ex > fx && ex < TL_X1) { g.fillStyle = C.world; g.fillRect(ex - 4, LANE_Y, 8, LANE_B - LANE_Y); g.fillStyle = hatch(g, "#3d2440"); g.fillRect(ex + 4, LANE_Y, TL_X1 - ex - 4, LANE_B - LANE_Y); }
    }
  }

  function stepPoints(steps, take) {
    const pts = []; const R = 17;
    for (const step of steps) {
      const evs = step.events.map((id) => take.byId.get(id)).filter(Boolean);
      const first = evs.find((e) => e.type !== "data" && e.type !== "snapshot") || evs[0];
      const at = first ? first.at : step.t0;
      let row = take.rowOf(step.actor);
      if (!row && first) row = take.rowOf(first.to) || take.rowOf(first.actor) || take.rowOf(first.from);
      if (!row) row = "host";
      let x = X(at); const y = rowTop(row) + R + 2; // on the row's upper edge, clear of the span labels
      // keep the discs apart, in order: a later step never sits on an earlier one
      for (const p of pts) if (Math.abs(p.y - y) < 2 * R + 4 && Math.abs(p.x - x) < 2 * R + 4) x = p.x + 2 * R + 6;
      pts.push({ x, y });
    }
    return pts;
  }
  function drawSteps(g, steps, take, color) {
    const pts = stepPoints(steps, take);
    g.strokeStyle = color; g.lineWidth = 6; g.lineJoin = "round";
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
    const R = 17;
    pts.forEach((p, i) => {
      g.fillStyle = "#0b0f14"; g.beginPath(); g.arc(p.x, p.y, R + 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = color; g.beginPath(); g.arc(p.x, p.y, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0b0f14"; g.font = font(21, 900); g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(i + 1), p.x, p.y + 1);
    });
  }
  function nodePoints(take, e) {
    const yOf = (r) => rowMid(r);
    if (e.type === "message") {
      const fr = take.rowOf(e.from), to = take.rowOf(e.to);
      if (!fr && !to) return null;
      return { x: X(e.at), y0: yOf(fr || to) - (fr ? 0 : rowH * 0.32), y1: yOf(to || fr) - (to ? 0 : rowH * 0.32), msg: true };
    }
    const r = take.rowOf(e.actor); if (!r) return null;
    return { x: X(e.at), y0: yOf(r), y1: yOf(r) };
  }
  function drawChain(g, sel) {
    const { take, bundle, chain } = sel;
    const pos = new Map();
    const place = (e) => { if (!pos.has(e.id)) pos.set(e.id, nodePoints(take, e)); return pos.get(e.id); };
    const linkTo = (e, color, w) => {
      // from the nearest drawn ancestor to e
      let p = take.parentOf(e); let pp = null; let n = 0;
      while (p && n++ < 50) { const pe = take.byId.get(p); if (!pe) break; pp = place(pe); if (pp) break; p = take.parentOf(pe); }
      const q = place(e); if (!pp || !q) return;
      g.strokeStyle = color; g.lineWidth = w; g.lineCap = "round";
      g.beginPath(); g.moveTo(pp.x, pp.y1); g.bezierCurveTo((pp.x + q.x) / 2, pp.y1, (pp.x + q.x) / 2, q.y0, q.x, q.y0); g.stroke();
    };
    const drawNode = (e, color, w) => {
      const q = place(e); if (!q) return;
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w;
      if (q.msg && q.y0 !== q.y1) { const dir = q.y1 > q.y0 ? 1 : -1; g.beginPath(); g.moveTo(q.x, q.y0); g.lineTo(q.x, q.y1 - dir * 14); g.stroke(); arrowHead(g, q.x, q.y1, dir, 16); }
      g.beginPath(); g.arc(q.x, q.y0, w * 1.6, 0, Math.PI * 2); g.fill();
    };
    g.save();
    g.shadowColor = "#000"; g.shadowBlur = 6;
    for (const e of chain.back) linkTo(e, C.chainBack, 5);
    for (const e of chain.fwd) linkTo(e, C.chainFwd, 5);
    const main = bundle.ids.map((id) => take.byId.get(id));
    for (const e of main) linkTo(e, C.chainBack, 5);
    for (const e of chain.back) drawNode(e, C.chainBack, 5);
    for (const e of chain.fwd) drawNode(e, C.chainFwd, 5);
    g.shadowBlur = 14; g.shadowColor = C.select;
    for (const e of main) drawNode(e, C.select, 8);
    g.restore();
  }

  function drawAxis(g) {
    g.fillStyle = C.bg; g.fillRect(TL_X0 - 30, AXIS_Y, TL_X1 - TL_X0 + 60, AXIS_H);
    g.font = font(18, 700); g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = C.dim; g.strokeStyle = "#3a4450"; g.lineWidth = 2;
    let last = -1e9; const end = axisEnd();
    const step = end > 30000 ? 5000 : 1000;
    for (let ms = 0; ms <= end + 1; ms += step) {
      const x = X(ms); if (x < TL_X0 - 1 || x > TL_X1 + 1) continue;
      g.beginPath(); g.moveTo(x, AXIS_Y); g.lineTo(x, AXIS_Y + 7); g.stroke();
      if (x - last >= 56) { g.fillText(`${ms / 1000}s`, x, AXIS_Y + 22); last = x; }
    }
  }

  function tabRects() {
    const gap = 12, n = WORLD_TABS.length; const w = (DW - 2 * PAD - gap * (n - 1)) / n;
    return WORLD_TABS.map((tb, i) => ({ ...tb, x: PAD + i * (w + gap), y: TAB_Y, w, h: TAB_H }));
  }
  let tabPx = 0;
  function tabFont(g, maxW) { if (!tabPx) { tabPx = [32, 30, 28, 26, 24, 22, 20].find((px) => WORLD_TABS.every((tb) => fit(g, [tb.label], maxW, px))) || 20; } return tabPx; }
  function drawTabs(g) {
    for (const r of tabRects()) {
      const avail = r.id === null || worldRefs.some((w) => w.id === r.id);
      const sel = (world ? world.ref.id : loading) === r.id || (r.id === null && !world && !loading);
      const col = r.id === null ? C.text : C.world;
      g.globalAlpha = avail ? 1 : 0.3;
      rrect(g, r.x, r.y, r.w, r.h, 14);
      g.fillStyle = sel ? col : "#18202a"; g.fill();
      g.lineWidth = 4; g.strokeStyle = col; if (!sel) g.stroke();
      // reel glyph: a disc in the take's colour
      g.beginPath(); g.arc(r.x + 30, r.y + r.h / 2, 12, 0, Math.PI * 2); g.fillStyle = sel ? "#0b0f14" : col; g.fill();
      g.beginPath(); g.arc(r.x + 30, r.y + r.h / 2, 4, 0, Math.PI * 2); g.fillStyle = sel ? col : "#18202a"; g.fill();
      const px = tabFont(g, r.w - 66);
      g.font = font(px, 800); g.fillStyle = sel ? "#0b0f14" : C.text; g.textAlign = "left"; g.textBaseline = "middle";
      g.fillText(r.label, r.x + 54, r.y + r.h / 2 + 2);
      if (loading != null && loading === r.id) { g.fillStyle = "#0b0f14"; g.textAlign = "right"; g.fillText("…", r.x + r.w - 12, r.y + r.h / 2); }
      if (hover && hover.type === "tab" && hover.id === r.id && !sel) { rrect(g, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 16); g.lineWidth = 3; g.strokeStyle = C.text; g.stroke(); }
      g.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------- the moving layer
  function spansAt(take, row, at) { return take.spans.filter((s) => s.row === row && s.a0 <= at && at < s.a1 && KINDS[s.kind]); }
  function render() {
    const key = [V().w0.toFixed(4), V().w1.toFixed(4), storyId, msgSel && msgSel.bundle.key, hlActor, world && world.ref.id, loading, hoverKey()].join("|");
    if (key !== staticKey) { drawStatic(); staticKey = key; }
    const px = X(t);
    const drawKey = key + "|" + Math.round(px * 2) + "|" + lampKey();
    if (drawKey === lastDrawKey) return;
    lastDrawKey = drawKey;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(stat, 0, 0);
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    const g = ctx;
    // not yet happened: dimmed
    const x = Math.max(TL_X0, Math.min(TL_X1, px));
    g.fillStyle = storyId || msgSel ? "#0b0f1440" : "#0b0f14a0"; g.fillRect(x, LANE_Y, TL_X1 - x + PAD, LANE_B - LANE_Y);
    // lamps: who is busy now
    for (const r of ROWS) {
      const take = world && t > forkAt() ? world.take : base;
      const sp = spansAt(take, r, t).sort((a, b) => (KINDS[a.kind].hatch ? 1 : 0) - (KINDS[b.kind].hatch ? 1 : 0))[0];
      const cy = rowMid(r), cx = LABEL_X + 16;
      g.beginPath(); g.arc(cx, cy, 13, 0, Math.PI * 2);
      if (sp) { const col = take === base ? KINDS[sp.kind].color : C.world; g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 18; g.fill(); g.shadowBlur = 0; }
      else { g.fillStyle = "#26303b"; g.fill(); }
    }
    // playhead
    if (px >= TL_X0 - 2 && px <= TL_X1 + 2) {
      g.fillStyle = C.play; g.fillRect(px - 2.5, LANE_Y, 5, LANE_B - LANE_Y);
      g.beginPath(); g.moveTo(px, LANE_Y + 14); g.lineTo(px - 11, LANE_Y); g.lineTo(px + 11, LANE_Y); g.closePath(); g.fill();
      const label = `${(t / 1000).toFixed(1)}s`;
      g.font = font(26, 900); const tw = g.measureText(label).width + 28;
      const hx = Math.max(TL_X0 - 10, Math.min(TL_X1 - tw + 10, px - tw / 2));
      rrect(g, hx, AXIS_Y + 1, tw, 36, 10); g.fillStyle = C.play; g.fill();
      g.fillStyle = "#0b0f14"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, hx + tw / 2, AXIS_Y + 20);
    }
    api.dirty = true;
  }
  const hoverKey = () => (!hover ? "" : hover.type + ":" + (hover.id ?? hover.row ?? (hover.bundle && hover.bundle.key) ?? (hover.span && hover.span.id + hover.span.kind + hover.span.row) ?? ""));
  const lampKey = () => ROWS.map((r) => { const take = world && t > forkAt() ? world.take : base; return spansAt(take, r, t).map((s) => s.kind).join(","); }).join("/");

  // ---------------------------------------------------------- hit testing
  function hit(p) {
    const { x, y } = p;
    if (y >= CHIP_Y && y <= CHIP_Y + CHIP_H) {
      const n = stories.length, gap = 12, w = (DW - 2 * PAD - gap * (n - 1)) / n;
      const i = Math.floor((x - PAD) / (w + gap));
      if (i >= 0 && i < n && x - PAD - i * (w + gap) <= w) return { type: "chip", id: stories[i].id };
      return null;
    }
    const px = X(t);
    if (y >= AXIS_Y - 10 && y < TAB_Y - 2 && Math.abs(x - px) < 64 && px >= TL_X0 - 10 && px <= TL_X1 + 10) return { type: "playhead" };
    if (y >= TAB_Y - 4) { for (const r of tabRects()) if (x >= r.x && x <= r.x + r.w) return { type: "tab", id: r.id }; return null; }
    if (y >= BAND_Y && y < LANE_Y) {
      for (const r of bracketRects()) if (x >= r.x0 - 6 && x <= r.x1 + 6 && y >= r.y - 3 && y <= r.y + r.h + 3) return { type: "bracket", id: r.id };
      return x >= TL_X0 ? { type: "timeline", t: tAtX(x) } : null;
    }
    if (y >= LANE_Y && y < LANE_B) {
      const row = ROWS[Math.min(ROWS.length - 1, Math.floor((y - LANE_Y) / rowH))];
      if (x < TL_X0 - 4) return { type: "row", row };
      // messages: nearest mark within reach whose vertical extent covers y
      const fx = forkX();
      const takes = world ? [[base, (b) => b.at <= forkAt() + 1e-6 && X(b.at) <= fx + 0.5], [world.take, (b) => b.at > forkAt() + 1e-6 && X(b.at) > fx - 0.5]] : [[base, () => true]];
      let best = null, bd = 16;
      for (const [take, keep] of takes) for (const b of take.bundles) {
        if (b.faint || !keep(b)) continue;
        const bx = X(b.at); const d = Math.abs(bx - x); if (d >= bd) continue;
        const rs = [b.fromRow, ...b.toRows].filter(Boolean).map((r) => ROWS.indexOf(r));
        const r0 = Math.min(...rs), r1 = Math.max(...rs); const ri = ROWS.indexOf(row);
        if (ri < r0 || ri > r1) continue;
        best = b; bd = d;
      }
      if (best) return { type: "msg", bundle: best };
      // spans
      const take = world && x >= fx ? world.take : base;
      const at = Winv(V().w0 + ((x - TL_X0) / (TL_X1 - TL_X0)) * (V().w1 - V().w0));
      const sp = take.spans.filter((s) => s.row === row && KINDS[s.kind] && X(s.a0) - 4 <= x && x <= Math.max(X(s.a1), X(s.a0) + 3) + 4)
        .sort((a, b) => (a.a1 - a.a0) - (b.a1 - b.a0))[0];
      if (sp) return { type: "span", span: sp, row };
      return { type: "timeline", t: Math.max(0, Math.min(axisEnd(), at)), row };
    }
    if (y >= AXIS_Y && y < TAB_Y && x >= TL_X0) return { type: "axis", t: tAtX(x) };
    return null;
  }

  // ---------------------------------------------------------- actions
  function seek(tt) { tt = Math.max(0, Math.min(axisEnd(), tt)); t = tt; emit("seek", { t: tt }); render(); }
  function actorIdsOfBundle(b) { return [...new Set([b.from, ...b.to].filter((a) => a !== "*"))]; }
  function selectStory(id, { emitEvents = true } = {}) {
    storyId = id; msgSel = null; hlActor = null;
    const lit = storyLit();
    if (lit) {
      const w0 = W(lit.a0), w1 = W(lit.a1); const pad = Math.max(0.12 * (w1 - w0), 1.2);
      view = { w0: Math.max(0, w0 - pad), w1: w1 + pad }; framed = true;
      if (emitEvents) {
        const actorIds = new Set(lit.st.steps.map((s) => s.actor));
        const messageIds = [];
        for (const id of lit.ids) { const e = base.byId.get(id); if (e && e.type === "message") { messageIds.push(id); actorIds.add(e.from); if (e.to !== "*") actorIds.add(e.to); } }
        emit("select", { actorIds: [...actorIds], messageIds, storyId: id });
        seek(lit.a0);
      }
    } else {
      if (framed) view = world ? worldView() : null;
      framed = false;
      if (emitEvents) emit("select", { actorIds: [], messageIds: [], storyId: null });
    }
    render();
  }
  function selectBundle(b, { emitEvents = true } = {}) {
    storyId = null;
    const take = b.take === "world" ? world.take : base;
    const chain = chainOf(take, b);
    const rows = new Set([b.fromRow, ...b.toRows].filter(Boolean));
    msgSel = { bundle: b, take, chain, rows };
    // frame the chain: what led to it and what it led to
    const ats = [b.at, ...chain.back.map((e) => e.at), ...chain.fwd.map((e) => e.at)];
    const w0 = W(Math.min(...ats)), w1 = W(Math.max(...ats)); const pad = Math.max(0.15 * (w1 - w0), 1.5);
    view = { w0: Math.max(0, w0 - pad), w1: w1 + pad }; framed = true;
    if (emitEvents) emit("select", { actorIds: actorIdsOfBundle(b), messageIds: b.ids.slice(), chainIds: chain.ids, storyId: null });
    render();
  }
  function clearSelection(emitEvents = true) {
    const had = storyId || msgSel || hlActor;
    if (framed) view = world ? worldView() : null;
    storyId = null; msgSel = null; hlActor = null; framed = false;
    if (had && emitEvents) emit("select", { actorIds: [], messageIds: [], storyId: null });
  }
  function loadWorld(id) {
    if (!worldCache.has(id)) {
      const ref = worldRefs.find((w) => w.id === id);
      if (!ref) return Promise.reject(new Error(`no world ${id}`));
      const url = new URL(`worlds/${id}.json`, dataBase);
      const mk = createSim || sim.createSim;
      worldCache.set(id, (async () => {
        const trace = await (await fetch(url)).json();
        let S;
        if (mk) S = mk(trace);
        else { const mod = await import(new URL("../core/sim.js", import.meta.url)); S = mod.createSim(trace); }
        return { ref, take: deriveTake(S, ROWS, "world") };
      })());
    }
    return worldCache.get(id);
  }
  async function selectWorld(id, { emitEvents = true } = {}) {
    if ((world ? world.ref.id : null) === id && !loading) return;
    if (emitEvents) emit("world", { worldId: id });
    msgSel = null;
    if (id == null) { world = null; loading = null; view = null; framed = false; render(); return; }
    loading = id; render();
    const w = await loadWorld(id);
    if (loading !== id) return; // another pick came meanwhile
    loading = null; world = w;
    if (storyId && emitEvents) emit("select", { actorIds: [], messageIds: [], storyId: null });
    storyId = null; framed = false; view = worldView();
    render();
  }
  // a what-if opens on its own story: from just before the fork to its end
  function worldView() {
    if (!world) return null;
    const f = W(world.ref.forkAt), e = W(Math.max(world.take.duration, Math.min(sim.duration, world.take.duration + 1)));
    const end = Math.max(e, W(axisEnd())) + 0.6;
    const w0 = Math.max(0, f - 0.22 * (end - f));
    return { w0, w1: end };
  }
  function zoom(factor, u = 0.5) {
    const v = V(); const full = fullView();
    const xd = u * DW; const f = Math.max(0, Math.min(1, (xd - TL_X0) / (TL_X1 - TL_X0)));
    const c = v.w0 + f * (v.w1 - v.w0);
    let span = (v.w1 - v.w0) / factor;
    span = Math.max(1.0, Math.min(full.w1 - full.w0, span));
    let w0 = c - f * span; w0 = Math.max(0, Math.min(full.w1 - span, w0));
    view = { w0, w1: w0 + span }; lastUser = clock();
    if (span >= full.w1 - full.w0 - 1e-6) view = null;
    render();
  }
  function pan(dxDesign) {
    const v = V(); const full = fullView(); const span = v.w1 - v.w0;
    let w0 = v.w0 - (dxDesign / (TL_X1 - TL_X0)) * span; w0 = Math.max(0, Math.min(full.w1 - span, w0));
    view = { w0, w1: w0 + span }; lastUser = clock(); render();
  }
  function resetView() { view = world ? worldView() : null; framed = false; render(); }

  function tap(h, p) {
    if (!h) return;
    switch (h.type) {
      case "chip": case "bracket": selectStory(storyId === h.id ? null : h.id); break;
      case "tab": selectWorld(h.id); break;
      case "row":
        msgSel = null; storyId = null; hlActor = hlActor === h.row ? null : h.row; framed = false;
        emit("select", { actorIds: hlActor ? [hlActor] : [], messageIds: [], storyId: null }); render(); break;
      case "msg": if (msgSel && msgSel.bundle === h.bundle) { clearSelection(); render(); } else { selectBundle(h.bundle); seek(h.bundle.t); } break;
      case "span":
        hlActor = h.span.row; storyId = null; msgSel = null;
        emit("select", { actorIds: [h.span.actor], messageIds: [], storyId: null });
        seek(h.span.t0); break;
      case "timeline": case "axis": seek(h.t); break;
    }
  }

  // pointer state
  let mode = null, downHit = null, downP = null, lastTap = null;
  function pointer(type, u, v, extra) {
    const p = { x: u * DW, y: v * DH };
    if (type === "wheel") {
      const dy = typeof extra === "number" ? extra : (extra && extra.dy) || 0;
      const dx = (extra && extra.dx) || 0;
      if (dy) zoom(Math.exp(-dy * 0.0015), u);
      if (dx) pan(-dx);
      return;
    }
    if (type === "down") {
      lastUser = clock();
      const h = hit(p);
      if (h && h.type === "playhead") { mode = "scrub"; return; }
      mode = "press"; downHit = h; downP = p; return;
    }
    if (type === "move") {
      if (mode === "scrub") { lastUser = clock(); if (p.x >= TL_X0 - 40) seek(tAtX(Math.max(TL_X0, Math.min(TL_X1, p.x)))); return; }
      if (mode === "pan") { pan(p.x - downP.x); downP = p; return; }
      if (mode === "press") {
        if (Math.hypot(p.x - downP.x, p.y - downP.y) > 12) {
          if (downHit && downHit.type === "axis") { mode = "pan"; pan(p.x - downP.x); downP = p; return; }
          if (downHit && ["timeline", "span", "msg"].includes(downHit.type)) { mode = "scrub"; seek(tAtX(Math.max(TL_X0, Math.min(TL_X1, p.x)))); return; }
        }
        return;
      }
      const h = hit(p); const hv = h && ["chip", "tab", "msg", "span", "row"].includes(h.type) ? h : null;
      const before = hoverKey(); hover = hv; if (hoverKey() !== before) render();
      return;
    }
    if (type === "up") {
      if (mode === "press") {
        const nowT = clock();
        const inLanes = downP.y >= BAND_Y && downP.y < LANE_B;
        if (inLanes && lastTap && nowT - lastTap.time < 380 && Math.hypot(downP.x - lastTap.p.x, downP.y - lastTap.p.y) < 50) {
          lastTap = null; clearSelection(); resetView();  // double tap: home
        } else { tap(downHit, downP); lastTap = inLanes ? { time: nowT, p: downP } : null; }
      }
      mode = null; downHit = null; return;
    }
    if (type === "leave") { mode = null; downHit = null; if (hover) { hover = null; render(); } }
  }

  function update(tt) {
    t = Math.max(0, tt);
    // keep the playhead in view when nobody is looking around
    if (view && !framed && clock() - lastUser > 2500 && mode == null) {
      const s = W(t); const span = view.w1 - view.w0;
      if (s < view.w0 || s > view.w1) { const full = fullView(); let w0 = Math.max(0, Math.min(full.w1 - span, s - span * 0.1)); view = { w0, w1: w0 + span }; }
    }
    render();
  }
  function highlight({ actorId, messageId } = {}) {
    hlActor = actorId ? (base.rowOf(actorId) || null) : null;
    if (messageId) {
      const b = (world && world.take.bundleOf.get(messageId)) || base.bundleOf.get(messageId);
      if (b && !b.faint) selectBundle(b, { emitEvents: false });
    } else if (msgSel) msgSel = null;
    render();
  }

  const api = {
    canvas, dirty: true,
    update, pointer, highlight,
    on(ev, fn) { (listeners[ev] ||= []).push(fn); return () => { listeners[ev] = listeners[ev].filter((f) => f !== fn); }; },
    // extras (see README.md)
    zoom, pan, resetView,
    selectStory: (id) => selectStory(id),
    selectWorld: (id) => selectWorld(id),
    selectMessage: (id) => { const b = (world && world.take.bundleOf.get(id)) || base.bundleOf.get(id); if (b) selectBundle(b); },
    loadWorld,
    warp: W, unwarp: Winv,
    get duration() { return axisEnd(); },
    get state() { return { t, storyId, worldId: world ? world.ref.id : null, messageId: msgSel ? msgSel.bundle.id : null, view: view ? { ...view } : null }; },
    rows: ROWS.slice(),
    // where something is drawn, in board coordinates (0..1), for scripted pointers and tests
    locate({ messageId, storyId: sid, worldId, t: tt, actorId } = {}) {
      let x, y;
      if (messageId) { const b = (world && world.take.bundleOf.get(messageId)) || base.bundleOf.get(messageId); if (!b) return null; x = X(b.at); const rs = [b.fromRow, ...b.toRows].filter(Boolean); y = (rowMid(rs[0]) + rowMid(rs[rs.length - 1])) / 2; }
      else if (sid !== undefined) { const n = stories.length, gap = 12, w = (DW - 2 * PAD - gap * (n - 1)) / n; const i = stories.findIndex((s) => s.id === sid); x = PAD + i * (w + gap) + w / 2; y = CHIP_Y + CHIP_H / 2; }
      else if (worldId !== undefined) { const r = tabRects().find((r) => r.id === worldId); x = r.x + r.w / 2; y = r.y + r.h / 2; }
      else if (tt !== undefined) { x = X(tt); y = actorId ? rowMid(base.rowOf(actorId)) : AXIS_Y + 19; } // no actor: the playhead's handle row
      else if (actorId) { x = LABEL_X + 90; y = rowMid(base.rowOf(actorId)); }
      return { u: x / DW, v: y / DH };
    },
    dispose() { for (const k of Object.keys(listeners)) listeners[k] = []; },
  };
  render();
  return api;
}
