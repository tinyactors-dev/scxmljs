// head/head.js: what you see inside a person's head. Their statechart, built as machines, for ANY chart.
//
// Grammar (README.md has the full table):
//   parallel state  -> a bench: one machine per region (wrapped into rows / tiers when there are many)
//   compound state  -> a machine: a housing on a plinth. Closed: a solid box with one lamp per part on
//                      its header beam. Opened (detail): glass walls, the beam slides down, the parts appear.
//   atomic state    -> a station (pad); the occupied one holds the marble. Many siblings: a serpentine of rows.
//   final           -> a drain; history -> a notched pad (H, or H* for deep) and a ghost marble remembering
//   transition      -> a track (brass = main line, red = exceptional, by the structural rule in README.md);
//                      the machine's own transition to a part -> a chute from its hopper; re-entry -> a loop;
//                      a state that reacts without moving (targetless) -> a bell beside its pad
//   <invoke>        -> a speaking tube rising from the pad, ending in a horn: lit while the child lives
//   event arriving  -> a mail capsule into the machine's hopper; then the marble travels
//   variable        -> a gauge on the roof of the machine that reads it (tube of balls, dial, lever, lamp)
// Deep charts: focus() on a machine at level >= 2 re-normalises the head so that machine fills the box
// (its ancestors' housings and other branches step aside), so every level is seen at a readable size.
// Everything but that re-normalisation (eased with dt, snapped when dt is 0) is a pure function of t.
// This file imports nothing: WORLD passes THREE in.

const NEST = 0.5;        // scale of a machine inside a machine
const PAD_W = 1.3;       // slot width of a station
const PAD_ZONE = 1.05;   // depth taken by a pad (in front of a nested housing)
const MARGIN = 0.38;
const ROW_GAP = 0.4;
const SHELF = 0.32;      // exceptional rows stand on a shelf
const PLINTH = 0.3;
const CAP_LEAD = 0.26;   // playback s: capsule drop before the marble starts
const TRAVEL = 0.38;     // playback s a marble spends on a track
const GLOW = 1.8;        // playback s a taken track keeps glowing
const LAG_SOFT = 0.35;   // a machine's queue of moves may lag its trace this much before moves are shortened
const LAG_HARD = 1.6;    // beyond this lag, moves fast-forward (a blur)
const MARBLE_R = 0.14;
const PAD_TOP = 0.12;
const OPEN_LEVELS = 3;
const FAN = 10;           // a part with more tracks than this becomes a hub with a bus
const BIG_STATIONS = 80;  // beyond this many states, only the active path opens by itself   // unfocused, at most this many levels open; deeper machines wait for a focus

const HUES = [0x4fa39a, 0xd9a93f, 0xd46f62, 0x8a80c6, 0x5f97d4, 0x8db85c, 0xc77bb0, 0x6fb3c9, 0xc98f5a];
// names: only a weak tie-breaker for states and back-edges the structure leaves undecided
const EXC_NAME = /fail|error|offline|backoff|reject|timeout|abort|cancel|^left$|^locked$|^stopped$|crash|dead|broken/i;
const EXC_EVENT_NAME = /(^|\.)(error|fail|failed|timeout|interrupt|cancel|abort|offline|leave|rejected|forget|bye|kill|crash)(\.|$)/i;
const SUCCESS_COND = /\bok\b|success|succeeded/i;
const ERR_COND = /\berror\b|\bfail|\bok\s*===?\s*false|!\s*[\w.]*\bok\b/i;

export function createHead({ THREE, sim, actorId, options = {} }) {
  const V3 = THREE.Vector3;
  const warp = typeof sim.warp === "function" ? (t) => sim.warp(t) : (t) => t / 1000;
  const group = new THREE.Group(); group.name = `head:${actorId}`;
  const root = new THREE.Group(); group.add(root);
  const chart = sim.chartOf ? sim.chartOf(actorId) : null;

  // ---------- resources ----------
  const owned = { geos: new Set(), mats: new Set(), texs: new Set(), inst: [] };
  const G = (g) => (owned.geos.add(g), g);
  const M = (m) => (owned.mats.add(m), m);
  const std = (color, o = {}) => M(new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o }));
  const geo = {
    pad: G(new THREE.CylinderGeometry(0.3, 0.34, PAD_TOP, 20)),
    lamp: G(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 20)),
    marble: G(new THREE.SphereGeometry(MARBLE_R, 20, 14)),
    funnel: G(new THREE.CylinderGeometry(0.3, 0.07, 0.36, 16, 1, true)),
    horn: G(new THREE.CylinderGeometry(0.2, 0.05, 0.3, 14, 1, true)),
    rod: G(new THREE.CylinderGeometry(0.03, 0.03, 1, 6)),
    box: G(new THREE.BoxGeometry(1, 1, 1)),
    ring: G(new THREE.TorusGeometry(0.27, 0.045, 8, 24)),
    hole: G(new THREE.CircleGeometry(0.2, 20)),
    capsule: G(new THREE.CapsuleGeometry(0.1, 0.24, 4, 10)),
    cone: G(new THREE.ConeGeometry(0.07, 0.16, 8)),
    bell: G(new THREE.CylinderGeometry(0.035, 0.11, 0.14, 12, 1, true)),
    ball: G(new THREE.SphereGeometry(0.085, 12, 8)),
    tube: G(new THREE.CylinderGeometry(0.22, 0.22, 1, 18, 1, true)),
    disc: G(new THREE.CircleGeometry(0.4, 32)),
    pulse: G(new THREE.SphereGeometry(0.08, 10, 8)),
    plane: G(new THREE.PlaneGeometry(1, 1)),
    sleeper: G(new THREE.BoxGeometry(0.26, 0.025, 0.05)),
  };
  const mat = {
    iron: std(0x3b404c, { roughness: 0.85, metalness: 0.25 }),
    board: std(0x6b4f3a, { roughness: 0.9 }),
    plinth: std(0x2c3039, { roughness: 0.7, metalness: 0.3 }),
    brass: std(0xc9a44c, { roughness: 0.35, metalness: 0.7 }),
    padIM: std(0xffffff, { roughness: 0.55, metalness: 0.4 }),
    drain: std(0x15171c, { roughness: 0.9 }),
    red: std(0xc0463a, { roughness: 0.5, metalness: 0.3 }),
    sleeper: std(0x4a3a2c, { roughness: 0.9 }),
    glass: M(new THREE.MeshStandardMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0, depthWrite: false })),
    capsule: std(0xf6ecd2, { roughness: 0.45, emissive: 0xffd88a, emissiveIntensity: 0.55 }),
    pulse: M(new THREE.MeshBasicMaterial({ color: 0xffd27a })),
    shelf: std(0x4a3528, { roughness: 0.9 }),
    floor: std(0x555c6b, { roughness: 0.8, metalness: 0.2 }),
    funnel: std(0xc9a44c, { roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide }),
    lampIM: M(new THREE.MeshBasicMaterial({ color: 0xffffff })),
    ghost: M(new THREE.MeshStandardMaterial({ color: 0xbfe6ff, emissive: 0x6fbfff, emissiveIntensity: 0.5, transparent: true, opacity: 0.5, roughness: 0.2, depthWrite: false })),
    none: M(new THREE.MeshBasicMaterial({ visible: false })),
    clockFace: M(new THREE.MeshStandardMaterial({ color: 0xf2ead2, emissive: 0xfff2c8, emissiveIntensity: 0.35, roughness: 0.6 })),
    clockWedge: M(new THREE.MeshBasicMaterial({ color: 0xffb84a, transparent: true, opacity: 0.55, side: THREE.DoubleSide })),
  };
  const COL = { padOff: new THREE.Color(0x6a7180), drain: new THREE.Color(0x15171c), lampOff: new THREE.Color(0x23262d), lampOn: new THREE.Color(0xffcf5a).multiplyScalar(1.6), lampExc: new THREE.Color(0xff5a3c).multiplyScalar(1.6), lampFinal: new THREE.Color(0x7dffb0).multiplyScalar(1.3) };

  // ---------- engraved plates (text only on things, small) ----------
  const plateCache = new Map();
  function plateTexture(text) {
    if (plateCache.has(text)) return plateCache.get(text);
    const c = document.createElement("canvas"); const ctx = c.getContext("2d");
    const font = "600 56px ui-monospace, Menlo, Consolas, monospace";
    ctx.font = font; const tw = Math.ceil(ctx.measureText(text).width);
    c.width = Math.min(2048, tw + 56); c.height = 88;
    ctx.fillStyle = "#262a31"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#b89443"; ctx.lineWidth = 6; ctx.strokeRect(3, 3, c.width - 6, c.height - 6);
    ctx.font = font; ctx.fillStyle = "#f4e7c4"; ctx.textBaseline = "middle"; ctx.fillText(text, 28, c.height / 2 + 3);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; owned.texs.add(tex);
    const r = { tex, aspect: c.width / c.height, mat: M(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.2 })) };
    plateCache.set(text, r); return r;
  }
  function plate(text, h, maxW = Infinity) {
    const { aspect, mat: pm } = plateTexture(text);
    let w = h * aspect; if (w > maxW) { h *= maxW / w; w = maxW; }
    const m = new THREE.Mesh(geo.plane, pm); m.scale.set(w, h, 1); m.userData.w = w; return m;
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
  // events raised by a delayed <send> anywhere in the chart: timers
  const timerEvents = new Set();
  function scanActions(list) { for (const a of list || []) { if (a.type === "send" && (a.delay || a.delayexpr) && a.event) timerEvents.add(a.event); if (a.then) scanActions(a.then); if (a.else) scanActions(a.else); if (a.body) scanActions(a.body); } }
  // the class of one transition: error (an error.* event, a guard on an error/failure), timeout (a timer racing
  // another way out of its state), or normal
  function transClass(tr, src) {
    const evs = (tr.event || "").split(/\s+/).filter(Boolean);
    if (evs.some((e) => e === "error" || e.startsWith("error."))) return "error";
    if (tr.cond && ERR_COND.test(tr.cond)) return "error";
    // the unguarded fallback of a transition guarded on success (done.invoke.x [ok] / done.invoke.x) is the failure
    if (!tr.cond && evs.length && (src.transitions || []).some((o) => o !== tr && o.event === tr.event && o.cond && SUCCESS_COND.test(o.cond) && !ERR_COND.test(o.cond))) return "error";
    if (evs.length && evs.every((e) => timerEvents.has(e)) && (src.transitions || []).some((o) => o !== tr && o.event && !o.event.split(/\s+/).every((e) => timerEvents.has(e)))) return "timeout";
    return "normal";
  }

  const actorRec = sim.actor ? sim.actor(actorId) : null;
  const rootLabel = (actorRec && actorRec.chart) || (chart && chart.source ? chart.source.replace(/^.*\//, "").replace(/\.scxml$/, "") : "chart");

  // ---------- model ----------
  const machines = [];          // housed records (machine, solo), parents before children
  const recs = [];              // every record, benches too
  const machById = new Map();   // state id -> record
  const stations = new Map();   // state id -> station
  const pickables = [];
  let maxLevel = 1;

  function siblingEdges(node) {
    const out = [];
    const add = (a, b, tr, x, global) => out.push({ a, b, ev: tr.event || "", cond: tr.cond || "", cls: transClass(tr, x), global });
    for (const tr of node.transitions || []) for (const tg of tr.targets || []) { const cb = childContaining(node, tg); if (cb) add("*", cb.id, tr, node, true); }
    for (const c of kids(node)) walk(c, (x) => {
      for (const tr of x.transitions || []) for (const tg of tr.targets || []) {
        const cb = childContaining(node, tg); if (!cb) continue;
        if (cb !== c) add(c.id, cb.id, tr, x, false); else if (tg === c.id) add(c.id, c.id, tr, x, false);
      }
    });
    return out;
  }
  // structural rule (README "Exceptional"): the main set is what the initial state reaches by normal
  // transitions; the other parts are exceptional; edges of class error/timeout, or touching an exceptional
  // part, are exceptional; names break ties only for parts no transition reaches and for back-edges.
  function classify(node, raw) {
    const init = initialOf(node);
    const isHist = (id) => { const n = nodeById.get(id); return n && n.kind === "history"; };
    const main = new Set([init]); const q = [init];
    while (q.length) { const a = q.shift(); for (const e of raw) if (e.cls === "normal" && (e.a === a || e.global) && !main.has(e.b) && !isHist(e.b)) { main.add(e.b); q.push(e.b); } }
    const reached = new Set(raw.map((e) => e.b));
    const exc = new Set();
    for (const c of kids(node)) {
      if (main.has(c.id) || c.kind === "history") continue;
      if (reached.has(c.id) || EXC_NAME.test(c.id)) exc.add(c.id);
    }
    // order: breadth-first along normal edges, then chute targets, then the rest in document order
    const order = [init]; const seen = new Set(order); const q2 = [init];
    while (q2.length) { const a = q2.shift(); for (const e of raw) if (!e.global && e.cls === "normal" && e.a === a && !seen.has(e.b) && !exc.has(e.b) && !isHist(e.b)) { seen.add(e.b); order.push(e.b); q2.push(e.b); } }
    for (const e of raw) if (e.global && !seen.has(e.b) && !exc.has(e.b) && !isHist(e.b)) { seen.add(e.b); order.push(e.b); }
    for (const c of kids(node)) if (!seen.has(c.id) && !exc.has(c.id) && c.kind !== "history") { seen.add(c.id); order.push(c.id); }
    const rank = new Map(order.map((id, i) => [id, i]));
    // merge edges by (a, b, exceptional?)
    const merged = new Map();
    for (const e of raw) {
      const back = e.a !== "*" && e.a !== e.b && rank.has(e.a) && rank.has(e.b) && rank.get(e.b) < rank.get(e.a);
      const isExc = e.cls !== "normal" || exc.has(e.a) || exc.has(e.b) || (back && e.ev.split(/\s+/).some((x) => EXC_EVENT_NAME.test(x)));
      const key = `${e.a}|${e.b}|${isExc ? 1 : 0}`;
      let m = merged.get(key); if (!m) { m = { a: e.a, b: e.b, key, exc: isExc, global: e.global, events: [], classes: new Set() }; merged.set(key, m); }
      if (e.ev) m.events.push(e.ev); m.classes.add(e.cls);
    }
    const hist = kids(node).filter((c) => c.kind === "history");
    return { main: order.map((id) => nodeById.get(id)), back: kids(node).filter((c) => exc.has(c.id)), hist, edges: [...merged.values()], exc };
  }

  function newRecord(kind, node, level, hue, parent) {
    const m = { kind, node, id: node.id, level, hue, parent, children: [], pads: new Map(), padList: [], trackByKey: new Map(), arcs: new Map(), lamps: new Map(), moves: [], moveStarts: [], hopperKicks: [], open: 1 };
    m.group = new THREE.Group(); m.chrome = new THREE.Group(); m.interior = new THREE.Group(); m.own = new THREE.Group();
    m.group.add(m.chrome); m.group.add(m.interior); m.interior.add(m.own);
    maxLevel = Math.max(maxLevel, level); recs.push(m);
    return m;
  }
  function shade(hex, level, i = 0) { const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl); c.setHSL((hsl.h + 0.035 * level + 0.02 * i) % 1, Math.max(0.25, hsl.s - 0.06 * level), Math.min(0.78, hsl.l + 0.07 * level)); return c.getHex(); }

  function measureHousing(m, w, d, H, hue, label) { // sizes now, meshes when first seen
    const BEAM = Math.min(0.5, 0.2 + 0.03 * w);
    const hx = -w / 2 + 0.32, hz = -d / 2 + 0.3;
    const mouth = new THREE.Object3D(); mouth.position.set(hx, H + 0.75, hz); m.chrome.add(mouth);
    Object.assign(m, { housingSpec: { w, d, H, hue, label }, hopper: mouth, H, BEAM, beamY: [H - BEAM / 2 + 0.045, -BEAM / 2 + 0.03], size: { w, d, h: H + 0.8 }, baseColor: new THREE.Color(hue) });
  }
  // a housing in two steps: "lite" (a closed box: plinth, walls with their top, the beam, its plate and lamps) when
  // its parent first opens; "full" (floor, frame, lid, hopper) when it starts to open itself
  function housing(m) {
    const { w, d, H, hue, label } = m.housingSpec;
    const C = m.chrome;
    const plinth = new THREE.Mesh(geo.box, mat.plinth); plinth.scale.set(w, PLINTH, d); plinth.position.y = -PLINTH / 2; C.add(plinth);
    plinth.userData.pick = { kind: "state", id: m.id }; pickables.push(plinth);
    const color = new THREE.Color(hue);
    const wallMat = M(new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, transparent: true, opacity: 1 }));
    const lidMat = M(new THREE.MeshStandardMaterial({ color: color.clone(), roughness: 0.55, metalness: 0.15, transparent: true, opacity: 1 }));
    const edgeMat = M(new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), roughness: 0.5, metalness: 0.3 }));
    const walls = new THREE.Mesh(geo.box, [wallMat, wallMat, lidMat, mat.none, wallMat, wallMat]);
    walls.scale.set(w, H, d); walls.position.y = H / 2; C.add(walls);
    walls.userData.pick = { kind: "state", id: m.id }; pickables.push(walls);
    const BEAM = m.BEAM;
    const beamG = new THREE.Group(); beamG.position.set(0, H - BEAM / 2 + 0.045, d / 2 - 0.02); C.add(beamG);
    const beam = new THREE.Mesh(geo.box, edgeMat); beam.scale.set(w, BEAM, 0.12); beamG.add(beam);
    beam.userData.pick = { kind: "state", id: m.id }; pickables.push(beam);
    const p = plate(label, BEAM * 0.62, w * 0.5); p.position.set(-w / 2 + 0.12 + p.userData.w / 2, 0, 0.065); beamG.add(p);
    if (m.level === 1 && actorRec && actorRec.incarnation > 1) { m.incarnation = actorRec.incarnation; const tp = plate(`#${m.incarnation}`, BEAM * 0.62); tp.position.set(-w / 2 + 0.22 + p.userData.w + tp.userData.w / 2, 0, 0.065); beamG.add(tp); } // a life after a restart
    Object.assign(m, { beamG, walls, wallMat, lidMat, edgeMat, namePlate: p });
  }
  function housingFull(m) {
    if (m.full) return; m.full = true;
    const { w, d, H } = m.housingSpec; const C = m.chrome; const edgeMat = m.edgeMat;
    m.walls.material = [m.wallMat, m.wallMat, mat.none, mat.none, m.wallMat, m.wallMat];
    const floor = new THREE.Mesh(geo.box, mat.floor); floor.scale.set(w - 0.12, 0.02, d - 0.12); C.add(floor);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const post = new THREE.Mesh(geo.box, edgeMat); post.scale.set(0.09, H, 0.09); post.position.set(sx * (w / 2 - 0.02), H / 2, sz * (d / 2 - 0.02)); C.add(post); }
    for (const [sx, sz, lw, ld] of [[0, -1, w, 0.09], [-1, 0, 0.09, d], [1, 0, 0.09, d]]) { const r = new THREE.Mesh(geo.box, edgeMat); r.scale.set(lw, 0.09, ld); r.position.set(sx * (w / 2 - 0.02), H, sz * (d / 2 - 0.02)); C.add(r); }
    const lid = new THREE.Mesh(geo.box, [mat.none, mat.none, m.lidMat, mat.none, mat.none, mat.none]); lid.scale.set(w, 0.02, d); lid.position.set(0, H + 0.03, 0); C.add(lid);
    lid.userData.pick = { kind: "state", id: m.id }; pickables.push(lid);
    const hx = m.hopper.position.x, hz = m.hopper.position.z;
    const post = new THREE.Mesh(geo.rod, mat.brass); post.scale.set(1.2, H + 0.5, 1.2); post.position.set(hx - 0.25, (H + 0.5) / 2, hz); C.add(post);
    const fun = new THREE.Mesh(geo.funnel, mat.funnel); fun.position.set(hx, H + 0.55, hz); C.add(fun);
    Object.assign(m, { lid, funnel: fun });
  }
  function addLamps(m, order) { // one round lamp per part on the header beam (one InstancedMesh); many parts: two rows
    const n = order.length; if (!n) return; const rowsN = n > 14 ? 2 : 1; const per = Math.ceil(n / rowsN);
    const room = m.size.w * 0.45; const sp = Math.min(m.BEAM * 0.95 / rowsN, room / Math.max(1, per));
    const x0 = m.size.w / 2 - 0.12 - sp / 2 - sp * (per - 1);
    const im = new THREE.InstancedMesh(geo.disc, mat.lampIM, n); const o = new THREE.Object3D();
    m.beamIdx = new Map(); m.beamCol = new Map();
    order.forEach((c, i) => {
      const r = Math.floor(i / per), k = i % per;
      o.position.set(x0 + k * sp, rowsN === 1 ? 0 : (0.5 - r) * m.BEAM * 0.48, 0.065); o.scale.setScalar((sp * 0.38) / 0.4); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, COL.lampOff);
      m.beamIdx.set(c.id, i); m.beamCol.set(c.id, m.exc && m.exc.has(c.id) ? COL.lampExc : c.kind === "final" ? COL.lampFinal : COL.lampOn);
    });
    im.instanceMatrix.needsUpdate = true; m.beamG.add(im); owned.inst.push(im); m.beamLamps = im;
  }

  function addStation(m, node, pos, flags) { // the station's place now; its meshes when its machine first opens
    const st = { m, node, pos: pos.clone(), kicks: [], index: m.padList.length, exc: !!flags.exc, initial: !!flags.initial, final: node.kind === "final", hist: node.kind === "history" };
    stations.set(node.id, st); m.pads.set(node.id, st); m.padList.push(st); return st;
  }
  function stationMeshes(st) {
    const { m, node, pos } = st; const flags = st;
    const g = new THREE.Group(); g.position.copy(pos); m.own.add(g); st.group = g;
    if (st.final) {
      const ring = new THREE.Mesh(geo.ring, mat.brass); ring.rotation.x = Math.PI / 2; ring.position.y = PAD_TOP + 0.01; g.add(ring);
      const hole = new THREE.Mesh(geo.hole, mat.drain); hole.rotation.x = -Math.PI / 2; hole.position.y = PAD_TOP + 0.012; g.add(hole);
    }
    if (st.hist) {
      const notch = new THREE.Mesh(geo.box, mat.brass); notch.scale.set(0.12, 0.22, 0.34); notch.position.set(0.34, 0.11, 0); g.add(notch);
      const deep = node.type === "deep" || node.history === "deep" || node.deep === true;
      const hp = plate(deep ? "H*" : "H", 0.16); hp.position.set(0, PAD_TOP + 0.02, 0); hp.rotation.x = -Math.PI / 2; g.add(hp);
    }
    if (flags.initial) { const f = new THREE.Mesh(geo.funnel, mat.funnel); f.position.set(-0.3, 0.62, -0.22); f.rotation.z = -0.5; f.scale.setScalar(0.5); g.add(f); }
    if ((node.transitions || []).some((tr) => !(tr.targets || []).length && tr.event)) { // a bell: it reacts without moving
      const br = new THREE.Mesh(geo.rod, mat.brass); br.scale.set(0.7, 0.5, 0.7); br.position.set(0.36, 0.25, -0.18); g.add(br);
      st.bell = new THREE.Mesh(geo.bell, mat.funnel); st.bell.position.set(0.36, 0.45, -0.18); g.add(st.bell);
    }
    if ((node.invokes || []).length) { // a speaking tube: up from the pad and out over the housing, ending in a horn
      const top = (m.H || 1.5) + 0.9;
      const curve = new THREE.CatmullRomCurve3([new V3(-0.28, 0.06, 0.12), new V3(-0.42, 0.5, 0.05), new V3(-0.42, top - 0.3, -0.1), new V3(-0.2, top, -0.25)]);
      st.tubeMat = std(0x3f8f6a, { roughness: 0.4, metalness: 0.5, emissive: 0x5dffb0, emissiveIntensity: 0 });
      const tube = new THREE.Mesh(G(new THREE.TubeGeometry(curve, 20, 0.045, 6, false)), st.tubeMat); g.add(tube);
      const horn = new THREE.Mesh(geo.horn, st.tubeMat); horn.position.copy(curve.getPoint(1)); horn.rotation.z = Math.PI / 2 + 0.4; horn.rotation.y = 0.6; g.add(horn);
      tube.userData.pick = { kind: "state", id: node.id }; pickables.push(tube);
      st.outlet = new THREE.Object3D(); st.outlet.position.copy(curve.getPoint(1)).add(new V3(0.15, 0.08, -0.05)); g.add(st.outlet);
      st.invokes = node.invokes;
    }
    const p = plate(node.id, 0.17, 1.15); p.position.set(0, 0.06, 0.46); p.rotation.x = -0.9; g.add(p);
    if (st.timers) { // a small clock on a stalk: shown while a timer it set runs
      st.clock = new THREE.Group(); st.clock.position.set(0.42, 0.5, 0.12); g.add(st.clock);
      const face = new THREE.Mesh(geo.disc, mat.clockFace); face.scale.setScalar(0.42); st.clock.add(face);
      const rim = new THREE.Mesh(geo.ring, mat.brass); rim.scale.setScalar(0.62); st.clock.add(rim);
      st.hand = new THREE.Group(); st.hand.position.z = 0.01; st.clock.add(st.hand);
      const hand = new THREE.Mesh(geo.box, mat.red); hand.scale.set(0.025, 0.14, 0.01); hand.position.y = 0.07; st.hand.add(hand);
      st.clockWedge = new THREE.Mesh(G(new THREE.CircleGeometry(0.15, 24, Math.PI / 2, 0.001)), mat.clockWedge); st.clockWedge.position.z = 0.005; st.clock.add(st.clockWedge);
      const stalk = new THREE.Mesh(geo.rod, mat.brass); stalk.scale.set(0.6, 0.4, 0.6); stalk.position.set(0.42, 0.25, 0.12); g.add(stalk); st.clockStalk = stalk;
    }
  }
  function finishStations(m) { // pad bases and lamps: two InstancedMeshes per machine
    const n = m.padList.length; if (!n) return;
    const bases = new THREE.InstancedMesh(geo.pad, mat.padIM, n), lamps = new THREE.InstancedMesh(geo.lamp, mat.lampIM, n);
    const o = new THREE.Object3D();
    m.padList.forEach((st, i) => {
      o.position.copy(st.pos).add(new V3(0, PAD_TOP / 2, 0)); o.updateMatrix(); bases.setMatrixAt(i, o.matrix); bases.setColorAt(i, st.final ? COL.drain : COL.padOff);
      o.position.copy(st.pos).add(new V3(0, PAD_TOP + 0.01, 0)); o.scale.setScalar(st.final ? 0.001 : 1); o.updateMatrix(); lamps.setMatrixAt(i, o.matrix); lamps.setColorAt(i, COL.lampOff); o.scale.setScalar(1);
    });
    bases.instanceMatrix.needsUpdate = true; lamps.instanceMatrix.needsUpdate = true;
    m.own.add(bases); m.own.add(lamps); owned.inst.push(bases, lamps);
    bases.userData.pickIds = m.padList.map((s) => s.node.id); bases.userData.pick = { kind: "state" }; pickables.push(bases);
    m.lampIM = lamps; m.lampLit = null;
  }

  function wrapRows(slots, targetW) {
    const rows = []; let cur = [], w = 0;
    for (const s of slots) { if (cur.length && w + s.w > targetW) { rows.push(cur); cur = []; w = 0; } cur.push(s); w += s.w; }
    if (cur.length) rows.push(cur); return rows;
  }
  const rowW = (r) => r.reduce((s, x) => s + x.w, 0);

  function buildMachine(node, level, hue, parent) {
    const m = newRecord("machine", node, level, hue, parent); machines.push(m); machById.set(node.id, m);
    const raw = siblingEdges(node); const cl = classify(node, raw);
    m.edges = cl.edges; m.exc = cl.exc;
    let ci = 0;
    const slot = (c) => {
      if (has(c)) {
        const sub = c.kind === "parallel" ? buildBench(c, level + 1, shade(hue, 1, ci++), m) : buildMachine(c, level + 1, shade(hue, 1, ci++), m);
        return { c, sub, w: sub.size.w * NEST + 0.35, d: sub.size.d * NEST + PAD_ZONE, h: sub.size.h * NEST };
      }
      return { c, w: PAD_W, d: PAD_ZONE, h: 0 };
    };
    const mainS = cl.main.map(slot), backS = [...cl.back, ...cl.hist].map(slot);
    const seqOf = new Map([...cl.main, ...cl.back, ...cl.hist].map((c, i) => [c.id, i]));
    const area = [...mainS, ...backS].reduce((s, x) => s + x.w * x.d, 0);
    const targetW = mainS.length <= 6 ? Infinity : Math.max(4.2, ...mainS.map((x) => x.w), ...backS.map((x) => x.w), Math.sqrt(area) * 1.5); // wrap only wide machines
    const mainRows = wrapRows(mainS, targetW).map((r, i) => (i % 2 ? r.slice().reverse() : r)); // serpentine
    const backRows = backS.length ? wrapRows(backS, targetW) : [];
    const rowD = (r) => Math.max(PAD_ZONE, ...r.map((x) => x.d));
    const innerW = Math.max(1.4, ...mainRows.map(rowW), ...backRows.map(rowW));
    const allRows = [...mainRows.map((r) => ({ r, shelf: false })), ...backRows.map((r) => ({ r, shelf: true }))];
    const w = innerW + 2 * MARGIN, d = allRows.reduce((s, x) => s + rowD(x.r), 0) + ROW_GAP * (allRows.length - 1) + 2 * MARGIN;
    const innerH = Math.max(1.5, ...allRows.map((x) => Math.max(0, ...x.r.map((s) => s.h)) + 0.25 + (x.shelf ? SHELF : 0)));
    measureHousing(m, w, d, innerH + 0.35, hue, node.id === "__root__" ? rootLabel : node.id);
    m.shelves = [];
    const init = initialOf(node);
    let zf = d / 2 - MARGIN;
    for (const { r, shelf } of allRows) {
      const y = shelf ? SHELF : 0, rd = rowD(r);
      if (shelf) m.shelves.push({ w: rowW(r) + 0.2, d: rd, z: zf - rd / 2 });
      let x = -rowW(r) / 2;
      for (const s of r) {
        const cx = x + s.w / 2, padZ = zf - 0.48;
        addStation(m, s.c, new V3(cx, y, padZ), { initial: s.c.id === init, exc: cl.exc.has(s.c.id) }).seq = seqOf.get(s.c.id);
        if (s.sub) { s.sub.group.scale.setScalar(NEST); s.sub.group.position.set(cx, y, padZ - 0.5 - (s.sub.size.d * NEST) / 2); m.interior.add(s.sub.group); m.children.push(s.sub); s.sub.padOf = s.c.id; }
        x += s.w;
      }
      zf -= rd + ROW_GAP;
    }
    m.lampOrder = [...cl.main, ...cl.back];
    if (cl.hist.length) { m.histPad = m.pads.get(cl.hist[0].id); m.histDeep = cl.hist.some((h) => h.type === "deep" || h.history === "deep"); }
    return m;
  }

  function buildSolo(node, level, hue, parent) { // an atomic (or final) region: one station
    const m = newRecord("solo", node, level, hue, parent); machines.push(m); machById.set(node.id, m);
    m.exc = new Set(); m.edges = [];
    const w = PAD_W + 2 * MARGIN, d = PAD_ZONE + 2 * MARGIN;
    measureHousing(m, w, d, 1.5, hue, node.id);
    addStation(m, node, new V3(0, 0, d / 2 - MARGIN - 0.48), {});
    m.lampOrder = [node]; m.shelves = [];
    if ((node.transitions || []).some((tr) => (tr.targets || []).includes(node.id))) m.edges = [{ a: node.id, b: node.id, key: `${node.id}|${node.id}|0`, exc: false, events: [] }];
    return m;
  }

  function buildBench(node, level, hue, parent, top = false) {
    const b = newRecord("bench", node, level, hue, parent); machById.set(node.id, b);
    const subs = kids(node).filter((c) => c.kind !== "history").map((c, i) => {
      const h = top ? HUES[i % HUES.length] : shade(hue, 0, i + 1);
      if (has(c)) return c.kind === "parallel" ? buildBench(c, level, h, b) : buildMachine(c, level, h, b);
      return buildSolo(c, level, h, b);
    });
    b.children = subs;
    const GAP = 0.55;
    const rw = (r) => r.reduce((s, x) => s + x.size.w, 0) + GAP * Math.max(0, r.length - 1);
    const area = subs.reduce((s, x) => s + x.size.w * x.size.d, 0);
    let rows;
    if (top && subs.length >= 3 && subs.length <= 6 && rw(subs) > 3.2 * Math.max(...subs.map((s) => s.size.d))) {
      // two tiers: the biggest machine in front, the rest behind on a raised step
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
    let z = 0, y = 0, W = 0; const steps = [];
    rows.forEach((row, ri) => {
      const rd = Math.max(...row.map((s) => s.size.d));
      let x = -rw(row) / 2;
      for (const s of row) { s.group.position.set(x + s.size.w / 2, y + PLINTH, z - rd / 2); b.interior.add(s.group); x += s.size.w + GAP; }
      if (ri > 0 && y > 0) steps.push({ z, rd, y });
      W = Math.max(W, rw(row));
      z -= rd + 0.6; y += top ? 1.0 : 0.3;
    });
    const D = -z - 0.6;
    b.boardSpec = { W, D, steps };
    b.interior.position.z = D / 2; b.chrome.position.z = D / 2;
    b.size = { w: W + 0.8, d: D + 0.8, h: Math.max(...subs.map((s) => s.size.h + s.group.position.y)) };
    return b;
  }

  // ---------- lazy building: a housing when its parent opens, the inside when it opens ----------
  let built = 0;
  function ensureChrome(r) {
    if (!r || r.chromeBuilt) return; r.chromeBuilt = true;
    if (r.kind === "bench") {
      const { W, D, steps } = r.boardSpec;
      const board = new THREE.Mesh(geo.box, mat.board); board.scale.set(W + 0.8, 0.2, D + 0.8); board.position.set(0, -0.1, -D / 2); r.chrome.add(board);
      for (const p of steps) { const st = new THREE.Mesh(geo.box, mat.board); st.scale.set(W + 0.8, p.y, p.rd + 0.7); st.position.set(0, p.y / 2, p.z - p.rd / 2); r.chrome.add(st); }
      for (const c of r.children) ensureChrome(c);
      return;
    }
    housing(r); addLamps(r, r.lampOrder); built++;
    if (r.level === 1) housingFull(r);
  }
  function ensureInterior(m) {
    if (m.interiorBuilt) return; ensureChrome(m); housingFull(m); m.interiorBuilt = true;
    for (const sh of m.shelves) { const x = new THREE.Mesh(geo.box, mat.shelf); x.scale.set(sh.w, SHELF, sh.d); x.position.set(0, SHELF / 2 - 0.001, sh.z); m.own.add(x); }
    for (const st of m.padList) stationMeshes(st);
    finishStations(m);
    if (m.kind === "solo") { for (const e of m.edges) addTrackMesh(m, loopCurve(m.pads.get(e.a).pos), false, e.key, e); }
    else buildTracks(m);
    for (const mv of m.moves) { mv.track = trackFor(m, mv.from, mv.to, mv.ev); const t = mv.track && mv.track.viaBus ? mv.track.bus : mv.track; if (t) t.firstTaken = Math.min(t.firstTaken, mv.start); }
    m.marble = new THREE.Mesh(geo.marble, M(new THREE.MeshStandardMaterial({ color: 0xeef8ff, emissive: 0x8fd4ff, emissiveIntensity: 0.75, roughness: 0.15, metalness: 0.3 })));
    m.marble.visible = false; m.own.add(m.marble);
    if (m.remembers) { m.ghost = new THREE.Mesh(geo.marble, mat.ghost); m.ghost.visible = false; m.own.add(m.ghost); }
    for (const c of m.children) ensureChrome(c);
  }

  // ---------- tracks ----------
  function padTop(m, id) { return m.pads.get(id).pos.clone().add(new V3(0, PAD_TOP + 0.04, 0)); }
  function arcCurve(p0, p3, off = 0.24) {
    const v = p3.clone().sub(p0); const dist = v.length();
    const n = new V3(v.z, 0, -v.x).normalize().multiplyScalar(off);
    const h = Math.min(1.3, 0.22 + 0.16 * dist);
    return new THREE.CubicBezierCurve3(p0, p0.clone().addScaledVector(v, 0.22).add(n).add(new V3(0, h, 0)), p0.clone().addScaledVector(v, 0.78).add(n).add(new V3(0, h, 0)), p3);
  }
  function loopCurve(pos) {
    const p = pos.clone().add(new V3(0, PAD_TOP + 0.04, 0));
    const pts = [[0, 0, 0], [0.18, 0.1, 0.05], [0.3, 0.38, 0.05], [0.14, 0.66, 0.02], [-0.14, 0.66, -0.02], [-0.3, 0.38, -0.05], [-0.18, 0.1, -0.05], [0, 0, 0]].map(([x, y, z]) => p.clone().add(new V3(x, y, z)));
    return new THREE.CatmullRomCurve3(pts, false, "centripetal");
  }
  function addTrackMesh(m, curve, exc, key, edge, chute = false) {
    const baseCol = new THREE.Color(exc ? 0xc0463a : 0xc9a44c);
    const tm = M(new THREE.MeshStandardMaterial({ color: baseCol.clone(), emissive: exc ? 0xff4a30 : 0xffb84a, emissiveIntensity: 0, roughness: 0.38, metalness: 0.6 }));
    const mesh = new THREE.Mesh(G(new THREE.TubeGeometry(curve, chute ? 20 : 32, exc ? 0.03 : 0.038, 6, false)), tm);
    m.own.add(mesh);
    const cone = new THREE.Mesh(geo.cone, tm); const u = 0.86; cone.position.copy(curve.getPointAt(u));
    cone.quaternion.setFromUnitVectors(new V3(0, 1, 0), curve.getTangentAt(u).normalize()); m.own.add(cone);
    if (!exc && !chute && edge.a !== edge.b) {
      const len = curve.getLength(); const n = Math.max(2, Math.floor(len / 0.2));
      for (let i = 1; i < n; i++) (m.sleepers ||= []).push({ p: curve.getPointAt(i / n), tg: curve.getTangentAt(i / n) });
    }
    const tr = { m, key, curve, mesh, mat: tm, baseCol, exc, edge, chute, firstTaken: Infinity };
    mesh.userData.pick = { kind: "transition", id: `${m.id}:${edge.a}->${edge.b}` }; pickables.push(mesh);
    m.trackByKey.set(key, tr); return tr;
  }
  // a hub (a part with more than FAN tracks) gets a bus: one raised brass rail over its partners, with a drop to
  // each; marbles to and from the hub ride the bus. A dispatcher with 64 queues stays one rail, not a fan.
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
      const drops = new THREE.InstancedMesh(geo.rod, bm, pts.length); const o = new THREE.Object3D();
      pts.forEach((q, i) => { const top = i === 0 ? hp : m.pads.get(others[i - 1]).pos; const h = HB - (top.y + 0.45); o.position.set(q.x, top.y + 0.45 + h / 2, q.z); o.scale.set(1.3, h, 1.3); o.updateMatrix(); drops.setMatrixAt(i, o.matrix); });
      drops.instanceMatrix.needsUpdate = true; m.own.add(drops); owned.inst.push(drops);
      const bus = { m, hub, others, pts, mat: bm, baseCol, mesh, exc, firstTaken: Infinity, curves: new Map(), isBus: true, chute: false };
      mesh.userData.pick = { kind: "transition", id: `${m.id}:${hub}->*` }; pickables.push(mesh);
      (m.buses ||= []).push(bus);
      for (const e of mine) { handled.add(e); m.trackByKey.set(e.key, { bus, edge: e, other: e.a === hub ? e.b : e.a, out: e.a === hub, exc: e.exc, chute: false, viaBus: true }); }
    }
    return handled;
  }
  function busCurve(tr) { // the marble's way along a bus: up from one end, along the rail, down at the other
    const bus = tr.bus, key = `${tr.other}|${tr.out}`;
    if (bus.curves.has(key)) return bus.curves.get(key);
    const i = bus.others.indexOf(tr.other); const pts = bus.pts.slice(0, i + 2);
    const hubTop = padTop(bus.m, bus.hub), otherTop = padTop(bus.m, tr.other);
    let all = [hubTop, ...pts, otherTop]; if (!tr.out) all = all.reverse();
    const path = new THREE.CurvePath(); for (let k = 1; k < all.length; k++) path.add(new THREE.LineCurve3(all[k - 1], all[k]));
    bus.curves.set(key, path); return path;
  }
  function buildTracks(m) {
    const onBus = buildBuses(m);
    for (const e of m.edges) {
      if (onBus.has(e)) continue;
      let curve, chute = false;
      if (e.global) {
        if (!m.pads.has(e.b)) continue;
        const h = m.hopper.position; const p3 = padTop(m, e.b); const p0 = new V3(h.x, m.H - 0.15, h.z);
        curve = new THREE.CubicBezierCurve3(p0, new V3(p0.x, p3.y + 0.9, p0.z), new V3(p3.x, p3.y + 0.9, p3.z - 0.15), p3); chute = true;
      } else if (e.a === e.b) { if (!m.pads.has(e.a)) continue; curve = loopCurve(m.pads.get(e.a).pos); if (e.exc && m.trackByKey.has(`${e.a}|${e.a}|0`)) curve = loopCurve(m.pads.get(e.a).pos.clone().add(new V3(0, 0, -0.12))); }
      else if (m.pads.has(e.a) && m.pads.has(e.b)) curve = arcCurve(padTop(m, e.a), padTop(m, e.b), e.exc && m.trackByKey.has(`${e.a}|${e.b}|0`) ? 0.42 : 0.24);
      else continue;
      addTrackMesh(m, curve, e.exc, e.key, e, chute);
    }
    if (m.sleepers && m.sleepers.length) {
      const im = new THREE.InstancedMesh(geo.sleeper, mat.sleeper, m.sleepers.length); const o = new THREE.Object3D();
      m.sleepers.forEach(({ p, tg }, i) => { const h = tg.clone(); h.y = 0; if (h.lengthSq() < 1e-6) h.set(1, 0, 0); h.normalize(); o.position.copy(p).add(new V3(0, -0.045, 0)); o.quaternion.setFromUnitVectors(new V3(0, 0, 1), h); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.instanceMatrix.needsUpdate = true; m.own.add(im); owned.inst.push(im);
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
  function moveCurve(m, mv) {
    if (mv.track && mv.track.viaBus) return busCurve(mv.track);
    if (mv.track && !mv.track.chute) return mv.track.curve;
    const key = `${mv.from}|${mv.to}`;
    if (m.arcs.has(key)) return m.arcs.get(key);
    const c = mv.from === mv.to ? loopCurve(m.pads.get(mv.from).pos) : arcCurve(padTop(m, mv.from), padTop(m, mv.to), 0);
    m.arcs.set(key, c); return c;
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
    else { top = buildSolo(tn, 1, HUES[0], null); }
    root.add(top.group); ensureChrome(top);
  } else {
    const c = new THREE.Mesh(geo.box, mat.iron); c.scale.set(3, 2, 2); c.position.y = 1; root.add(c);
    c.userData.pick = { kind: "state", id: actorId }; pickables.push(c);
  }
  const regions = top ? (top.kind === "bench" ? top.children : [top]) : [];
  const compound = machines.filter((m) => m.kind === "machine");

  // ---------- data: lives, moves, capsules, kicks ----------
  const END = (sim.duration || 1e9) + 10;
  const atOf = (e) => (e.at != null ? e.at : e.t);
  const evs = (sim.eventsBetween ? sim.eventsBetween(-1, END) : ((sim.trace && sim.trace.events) || [])).filter((e) => e.actor === actorId || (e.type === "message" && e.to === actorId));
  const allMsgs = evs.filter((e) => e.type === "message");
  const arrive = (msg) => (sim.flight ? sim.flight(msg)[1] : warp(atOf(msg)));
  let lives = sim.lifetimes ? sim.lifetimes(actorId) : null;
  if (!lives || !lives.length) { const a = sim.actor ? sim.actor(actorId) : null; lives = [[a && a.bornAt != null ? a.bornAt : 0, a && a.diedAt != null ? a.diedAt : Infinity]]; }
  const livesS = lives.map(([a, b]) => [warp(a), b === Infinity || b > END ? Infinity : warp(b)]);
  const capsules = []; const usedMsg = new Set(); const pendingKicks = [];
  const cur = new Map(compound.map((m) => [m, null]));
  const groups = []; let gEvent = null; // one group per trace event: its moves start together, after every machine it touches is free
  const push = (m, mv) => { m.moves.push(mv); cur.set(m, mv.to); if (gEvent !== currentEvent) { groups.push([]); gEvent = currentEvent; } groups[groups.length - 1].push({ m, mv }); };
  let currentEvent = null;
  for (const e of evs) {
    const at = atOf(e); currentEvent = e;
    if (e.type === "transition") {
      const from = e.from || [], to = e.to || [];
      const msg = e.event ? allMsgs.find((x) => !usedMsg.has(x.id) && x.name === e.event && Math.abs(atOf(x) - at) < 1e-6) : null;
      if (!from.length && !to.length) { // targetless: it rings where it was heard
        pendingKicks.push({ at, name: e.event, msg }); if (msg) usedMsg.add(msg.id); continue;
      }
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
    } else if (e.type === "config") { // agree with configs (traces without transitions, a restart at a checkpoint)
      const act = new Set(e.active || []);
      for (const m of compound) {
        const c = kids(m.node).find((x) => act.has(x.id)); const want = c ? c.id : null;
        if (want !== cur.get(m)) push(m, { base: warp(at) + 0.04, from: cur.get(m), to: want, ev: "" });
      }
    } else if (e.type === "end") { // a normal end winds down (every marble sinks); a killed process freezes where it stood
      if (e.reason !== "disposed" && e.reason !== "killed") for (const m of compound) if (cur.get(m)) push(m, { base: warp(at), from: cur.get(m), to: null, ev: "", death: true });
    }
  }
  if (!evs.some((e) => e.type === "transition" || e.type === "config") && sim.activeAt) { // nothing recorded: one config at birth
    const act = new Set(sim.activeAt(actorId, lives[0][0]));
    currentEvent = "birth"; for (const m of compound) { const c = kids(m.node).find((x) => act.has(x.id)); if (c) push(m, { base: livesS[0][0] + 0.04, from: null, to: c.id, ev: "" }); }
  }
  // messages (and targetless transitions) that moved nothing: who heard them
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
  // timers: a delayed send set by a state runs a small clock on that station until it fires or is cancelled
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
  // schedule each machine's moves in trace order: never overlapping; a burst is queued, shortened past
  // LAG_SOFT and fast-forwarded (a blur) past LAG_HARD
  const endOf = new Map(compound.map((m) => [m, -Infinity])), countOf = new Map();
  for (const g of groups) {
    const base = Math.min(...g.map((x) => x.mv.base));
    const start = Math.max(base, ...g.map((x) => endOf.get(x.m)));
    const lag = start - base;
    for (const { m, mv } of g) {
      mv.start = start;
      const k = countOf.get(m) || 0; countOf.set(m, k + 1);
      if (!mv.from && mv.to && !mv.death && m.histPad && mv.to !== initialOf(m.node) && k > 0) mv.viaHist = true; // re-entered where it was: through the memory notch
      let dur = mv.from && mv.to ? TRAVEL : mv.viaHist ? 0.7 : 0.28;
      if (mv.death) dur = 0.9;
      else if (lag > LAG_HARD) { dur = 0.03; mv.fast = true; }
      else if (lag > LAG_SOFT) { dur *= Math.max(0.15, 1 - (lag - LAG_SOFT) / (LAG_HARD - LAG_SOFT)); mv.fast = dur < 0.2; }
      mv.end = start + dur; endOf.set(m, mv.end);
      mv.track = null; // resolved when the machine's inside is built
    }
  }
  for (const m of compound) m.moveStarts = m.moves.map((x) => x.start);
  const capS = capsules.map((c) => c.s0);
  // deep history remembers for the machines inside too
  for (const m of compound) if (m.histPad) { const mark = (x) => { for (const c of x.children) { if (c.kind === "machine") c.remembers = true; mark(c); } }; m.remembers = true; if (m.histDeep) mark(m); }

  // invoked children: who lives while a tube is lit
  const allActors = sim.actors || sim.actorsList || [];
  const childrenOf = allActors.filter((a) => a.parent === actorId);
  for (const st of stations.values()) if ((st.node.invokes || []).length) { st.invokes = st.node.invokes;
    st.childIds = childrenOf.filter((a) => st.invokes.some((iv) => (iv.id && a.id.includes(iv.id)) || (iv.src && a.chart && iv.src.replace(/^.*\//, "").replace(/\.scxml$/, "") === a.chart))).map((a) => a.id);
    if (!st.childIds.length) st.childIds = childrenOf.map((a) => a.id);
  }

  // ---------- gauges (the datamodel that matters) ----------
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
    const perRoof = new Map();
    root.updateMatrixWorld(true);
    const toRoot = (obj, v) => root.worldToLocal(obj.localToWorld(v));
    chosen.forEach((c, i) => {
      const reads = new Map();
      for (const sid of c.dv.readBy || []) { const r = roofOf(regOf(sid)); if (r) reads.set(r, (reads.get(r) || 0) + 1); }
      const prim = [...reads.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || roofOf(regions[0]);
      if (!prim || !prim.H) return;
      const k = perRoof.get(prim) || 0; perRoof.set(prim, k + 1);
      if (k === 0) { const rack = new THREE.Mesh(geo.box, prim.edgeMat); rack.scale.set(prim.size.w, 0.1, 0.5); rack.position.set(0, prim.H + 0.05, -prim.size.d / 2 + 0.25); prim.chrome.add(rack); }
      const lp = new V3(prim.size.w / 2 - 0.45 - k * 0.8, prim.H + 0.1, -prim.size.d / 2 + 0.28);
      if (lp.x < -prim.size.w / 2 + 0.6) return; // no room on that roof
      const g = makeGauge(c.dv, lp, prim.chrome, 0.6);
      g.changes = c.changes; g.pipes = [];
      const regs = new Set([prim]);
      for (const sid of [...(c.dv.readBy || []), ...(c.dv.writtenBy || [])]) { const r = roofOf(regOf(sid)); if (r && r.H) regs.add(r); }
      const base = toRoot(prim.chrome, lp.clone().add(new V3(0, 0.05, 0)));
      for (const r of regs) {
        let curve;
        if (r === prim) curve = new THREE.CatmullRomCurve3([toRoot(prim.chrome, new V3(lp.x, 0.05, -prim.size.d / 2 - 0.06)), toRoot(prim.chrome, new V3(lp.x, prim.H + 0.1, -prim.size.d / 2 - 0.06)), base]);
        else {
          const tgt = toRoot(r.chrome, new V3(r.size.w / 2 - 0.3, r.H + 0.1, -r.size.d / 2 + 0.3));
          const mid = base.clone().lerp(tgt, 0.5); mid.y = Math.max(base.y, tgt.y) + 1.1 + 0.15 * i;
          curve = new THREE.CatmullRomCurve3([tgt, tgt.clone().add(new V3(0, 0.6, 0)), mid, base.clone().add(new V3(0, 0.5, 0)), base]);
        }
        const pm = M(new THREE.MeshStandardMaterial({ color: 0xb8693f, roughness: 0.4, metalness: 0.6, emissive: 0xffa060, emissiveIntensity: 0 }));
        const mesh = new THREE.Mesh(G(new THREE.TubeGeometry(curve, r === prim ? 8 : 40, 0.032, 6, false)), pm); root.add(mesh); pipeMeshes.push(mesh);
        mesh.userData.pick = { kind: "variable", id: c.dv.id }; pickables.push(mesh);
        const pulse = new THREE.Mesh(geo.pulse, mat.pulse); pulse.visible = false; root.add(pulse); pipeMeshes.push(pulse);
        g.pipes.push({ r, curve, mesh, mat: pm, pulse, writer: (c.dv.writtenBy || []).some((sid) => roofOf(regOf(sid)) === r) || !(c.dv.writtenBy || []).length });
      }
      gauges.push(g);
    });
  }
  function makeGauge(dv, pos, parent, scale) {
    const g = { id: dv.id, type: dv.type, group: new THREE.Group(), last: undefined };
    g.group.position.copy(pos); g.group.scale.setScalar(scale); parent.add(g.group);
    const pl = plate(dv.id, 0.2, 1.3); pl.position.set(0, 0.2, 0.56); pl.rotation.x = -0.5; g.group.add(pl);
    const kind = dv.type === "array" || dv.type === "object" ? "tube" : dv.type === "number" ? "dial" : dv.type === "boolean" ? "lever" : "lamp";
    g.kind = kind;
    if (kind === "tube") {
      const glass = new THREE.Mesh(geo.tube, mat.glass); glass.scale.set(1, 1.7, 1); glass.position.y = 0.95; g.group.add(glass);
      const cap = new THREE.Mesh(geo.box, mat.brass); cap.scale.set(0.52, 0.08, 0.52); cap.position.y = 1.84; g.group.add(cap);
      const base = new THREE.Mesh(geo.box, mat.brass); base.scale.set(0.52, 0.1, 0.52); base.position.y = 0.06; g.group.add(base);
      const bm = M(new THREE.MeshStandardMaterial({ color: dv.type === "object" ? 0x7fc4ff : 0xffb36b, roughness: 0.3, emissive: 0x000000 }));
      g.balls = new THREE.InstancedMesh(geo.ball, bm, 18); g.balls.count = 0; g.group.add(g.balls); g.ballMat = bm; owned.inst.push(g.balls);
      glass.userData.pick = { kind: "variable", id: dv.id }; pickables.push(glass);
    } else if (kind === "dial") {
      const body = new THREE.Mesh(geo.box, mat.iron); body.scale.set(0.95, 0.95, 0.22); body.position.y = 0.75; g.group.add(body);
      g.faceCanvas = document.createElement("canvas"); g.faceCanvas.width = g.faceCanvas.height = 256;
      g.faceTex = new THREE.CanvasTexture(g.faceCanvas); g.faceTex.colorSpace = THREE.SRGBColorSpace; owned.texs.add(g.faceTex);
      const face = new THREE.Mesh(geo.disc, M(new THREE.MeshStandardMaterial({ map: g.faceTex, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0, emissiveMap: g.faceTex })));
      face.position.set(0, 0.75, 0.115); g.group.add(face); g.faceMat = face.material;
      g.needleG = new THREE.Group(); g.needleG.position.set(0, 0.75, 0.13); g.group.add(g.needleG);
      const needle = new THREE.Mesh(geo.box, mat.red); needle.scale.set(0.035, 0.32, 0.02); needle.position.y = 0.14; g.needleG.add(needle);
      body.userData.pick = { kind: "variable", id: dv.id }; pickables.push(body);
      g.max = 1;
    } else {
      const body = new THREE.Mesh(geo.box, mat.iron); body.scale.set(0.6, 0.5, 0.4); body.position.y = 0.3; g.group.add(body);
      g.lampMat = std(0x23262d, { emissive: 0x7dff9a, emissiveIntensity: 0 });
      const l = new THREE.Mesh(geo.marble, g.lampMat); l.position.set(0, 0.68, 0); g.group.add(l);
      if (kind === "lever") { g.lever = new THREE.Group(); g.lever.position.set(0, 0.5, 0.15); const arm = new THREE.Mesh(geo.box, mat.brass); arm.scale.set(0.06, 0.45, 0.06); arm.position.y = 0.22; g.lever.add(arm); g.group.add(g.lever); }
      body.userData.pick = { kind: "variable", id: dv.id }; pickables.push(body);
    }
    return g;
  }
  function drawDial(g, v) {
    const x = g.faceCanvas.getContext("2d");
    x.fillStyle = "#efe4c6"; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = "#3a3330"; x.lineWidth = 5;
    for (let i = 0; i <= 8; i++) { const a = (-120 + (240 * i) / 8 - 90) * Math.PI / 180; x.beginPath(); x.moveTo(128 + Math.cos(a) * 98, 128 + Math.sin(a) * 98); x.lineTo(128 + Math.cos(a) * 118, 128 + Math.sin(a) * 118); x.stroke(); }
    x.fillStyle = "#1d1f24"; x.fillRect(74, 160, 108, 52);
    x.fillStyle = "#ffd27a"; x.font = "600 40px ui-monospace, Menlo, monospace"; x.textAlign = "center"; x.textBaseline = "middle";
    const sv = typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : String(v ?? "–"); x.fillText(sv.slice(0, 5), 128, 188);
    g.faceTex.needsUpdate = true;
  }
  for (const g of gauges) if (g.kind === "dial") { let mx = 1; for (const e of ((sim.trace && sim.trace.events) || [])) if (e.type === "snapshot" && e.actor === actorId && e.values && typeof e.values[g.id] === "number") mx = Math.max(mx, Math.abs(e.values[g.id])); g.max = mx; drawDial(g, 0); }

  // ---------- fit into the 10 x 10 x 10 box; stages for deep focus ----------
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const sz = box.getSize(new V3()); const fit = Math.min(9.4 / Math.max(sz.x, 1e-3), 9.4 / Math.max(sz.y, 1e-3), 9.4 / Math.max(sz.z, 1e-3));
  const ctr = box.getCenter(new V3());
  const whole = { s: fit, p: ctr.clone().multiplyScalar(-fit) };
  root.scale.setScalar(whole.s); root.position.copy(whole.p);
  group.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  for (const m of recs) { // each record's box in root-local units (static)
    const b = m.kind === "bench" ? new THREE.Box3(new V3(-m.size.w / 2, -0.2, -m.size.d / 2), new V3(m.size.w / 2, m.size.h, m.size.d / 2)) : new THREE.Box3(new V3(-m.size.w / 2, -PLINTH, -m.size.d / 2), new V3(m.size.w / 2, m.H + 0.9, m.size.d / 2));
    m.rootBox = b.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invRoot, m.group.matrixWorld));
  }
  for (const st of stations.values()) { st.rootPos = st.m.own.localToWorld(st.pos.clone()).applyMatrix4(invRoot); st.rootScale = st.m.own.getWorldScale(new V3()).x / root.getWorldScale(new V3()).x; }
  const xf = { s: whole.s, p: whole.p.clone() }, xfTarget = { s: whole.s, p: whole.p.clone() };
  let stage = null;
  function stageFor(id) { // the machine that fills the box while id is focused (deep levels only)
    if (!id) return null;
    let m = machById.get(id);
    const st = stations.get(id); if ((!m || m.kind === "solo") && st) m = st.m;
    if (!m) return null;
    while (m && m.kind === "solo") m = m.parent;
    if (!m || m.level < 2) return null;
    return m;
  }
  function stageXf(m) {
    if (!m) return { s: whole.s, p: whole.p.clone() };
    const b = m.rootBox; const s3 = b.getSize(new V3()); const c = b.getCenter(new V3());
    const s = 8.6 / Math.max(s3.x, s3.y, s3.z); return { s, p: c.multiplyScalar(-s) };
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

  // capsule pool
  const capPool = [];
  for (let i = 0; i < 8; i++) { const c = new THREE.Mesh(geo.capsule, mat.capsule); c.visible = false; group.add(c); capPool.push(c); }

  // ---------- detail / focus ----------
  let detail = options.detail ?? 0, focusId = null, focusPath = null, focusLevel = maxLevel;
  const ss = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  const openLevels = Math.min(maxLevel, OPEN_LEVELS);
  // a big chart (more than BIG_STATIONS states) opens unfocused only along the active path
  const big = stations.size > BIG_STATIONS;
  function openOf(m, active) {
    if (big && !active && m.level > 1 && !(focusPath && focusPath.has(m))) return 0;
    if (!focusPath) return ss(detail * openLevels - (m.level - 1));
    const base = stage ? stage.level - 1 : 0;
    if (focusPath.has(m)) return m.level <= base ? 1 : ss(detail * (focusLevel - base) - (m.level - 1 - base));
    if (stage) return m.level === stage.level ? ss(detail) : 0; // inside the stage: its parts wait closed
    return ss(detail * openLevels - (m.level - 1));
  }
  function ownerMachines(id) { const path = []; let x = nodeById.get(id); while (x) { const m = machById.get(x.id); if (m && m.kind !== "bench") path.unshift(m); x = parentOf.get(x.id); } return path; }
  function visibleChain(m) { for (let p = m.parent; p; p = p.parent) if (p.kind !== "bench" && p.open < 0.04) return false; return true; }

  // ---------- update ----------
  const _v = new V3(), _q = new THREE.Quaternion(), _o = new THREE.Object3D(), _c = new THREE.Color();
  function stateAt(m, s) {
    const i = upperBound(m.moveStarts, s) - 1;
    if (i < 0) return { rest: null, idx: -1 };
    const mv = m.moves[i];
    if (s < mv.end) return { travel: mv, u: (s - mv.start) / (mv.end - mv.start), idx: i };
    return { rest: mv.to, idx: i };
  }
  function lifeState(s) { // {alive, fade 1 -> 0 after a death, 0 before the first birth}
    for (const [a, b] of livesS) if (s >= a && s < b) return { alive: true, fade: 1 };
    let lastEnd = -Infinity; for (const [, b] of livesS) if (b <= s && b > lastEnd) lastEnd = b;
    return { alive: false, fade: lastEnd > -Infinity ? Math.max(0, 1 - (s - lastEnd) / 1.2) : 0 };
  }
  function update(t, dt) {
    const s = warp(t);
    // stage re-normalisation (eased; snapped when dt is 0 or missing)
    const k = dt > 0 ? 1 - Math.exp(-dt * 5) : 1;
    xf.s = Math.exp(Math.log(xf.s) + (Math.log(xfTarget.s) - Math.log(xf.s)) * k); xf.p.lerp(xfTarget.p, k);
    root.scale.setScalar(xf.s); root.position.copy(xf.p);
    const life = lifeState(s);
    const act = life.alive && sim.activeAt ? new Set(sim.activeAt(actorId, t)) : new Set();
    const lifeDim = life.alive ? 1 : 0.35 + 0.4 * life.fade;
    for (const m of machines) {
      if (!m.chromeBuilt) { m.open = 0; continue; }
      const activeHere = act.has(m.id) || (m.node.id === "__root__" && life.alive) || (m === top && life.alive);
      m.open = openOf(m, activeHere);
      const o = m.open; const shown = visibleChain(m);
      if (o > 0.04 && shown) ensureInterior(m);
      m.wallMat.color.copy(m.baseColor).multiplyScalar((activeHere ? 1 : 0.55) * lifeDim);
      const oo = Math.min(1, o * 2.2);
      m.beamG.position.y = m.beamY[0] + (m.beamY[1] - m.beamY[0]) * ss(o * 1.3);
      m.wallMat.opacity = 1 - 0.92 * oo; m.wallMat.depthWrite = oo < 0.35;
      m.lidMat.color.copy(m.baseColor).multiplyScalar((activeHere ? 1.08 : 0.6) * lifeDim);
      if (o > 0.005) housingFull(m);
      m.lidMat.opacity = 1 - oo; m.lidMat.depthWrite = oo < 0.35; if (m.lid) m.lid.visible = oo < 0.97;
      m.interior.visible = o > 0.04 && shown;
      let lit = null;
      if (!m.interiorBuilt) { // closed and never opened: only its lamps
        if (m.kind === "solo") lit = act.has(m.id) ? m.id : null;
        else { const stt = stateAt(m, s); lit = stt.travel ? (stt.u > 0.92 ? stt.travel.to : null) : stt.rest; if (!m.moves.length && activeHere) { const c = kids(m.node).find((x) => act.has(x.id)); lit = c ? c.id : null; } }
      } else if (m.kind === "solo") {
        lit = act.has(m.id) ? m.id : null;
        const st = m.pads.get(m.id); const kick = kickAt(st.kicks, s);
        m.marble.visible = !!lit;
        if (lit) { m.marble.position.copy(st.pos).add(_v.set(0, PAD_TOP + MARBLE_R + (kick >= 0 ? Math.sin(Math.PI * kick) * 0.3 : 0), 0)); m.marble.rotation.y = kick >= 0 ? kick * 12 : 0; }
        ringBell(st, kick);
        for (const tr of m.trackByKey.values()) setTrack(tr, 0, true);
      } else {
        const stt = stateAt(m, s);
        let p = null, scale = 1, fast = false, tang = null;
        if (stt.travel) {
          const mv = stt.travel, u = stt.u; fast = !!mv.fast;
          if (mv.from && mv.to) { const c = moveCurve(m, mv); p = c.getPointAt(ease(u)).add(_v.set(0, MARBLE_R, 0)); if (fast) tang = c.getTangentAt(Math.min(0.999, ease(u))); lit = u > 0.92 ? mv.to : null; }
          else if (mv.to && mv.viaHist) { // drops onto the history notch, then rolls to the part it remembers
            if (u < 0.45) { const w = u / 0.45; p = m.histPad.pos.clone().add(_v.set(0, PAD_TOP + MARBLE_R + 1.3 * (1 - w * w), 0)); }
            else p = arcCurve(padTop(m, m.histPad.node.id), padTop(m, mv.to), 0).getPointAt(ease((u - 0.45) / 0.55)).add(_v.set(0, MARBLE_R, 0));
            lit = u > 0.92 ? mv.to : null;
          }
          else if (mv.to) { const q = m.pads.get(mv.to).pos; p = q.clone().add(_v.set(0, PAD_TOP + MARBLE_R + 1.3 * (1 - u * u), 0)); lit = u > 0.9 ? mv.to : null; }
          else if (mv.from) { const q = m.pads.get(mv.from).pos; p = q.clone().add(_v.set(0, PAD_TOP + MARBLE_R - 0.3 * u, 0)); scale = 1 - u; }
        } else if (stt.rest) {
          lit = stt.rest; const st = m.pads.get(stt.rest);
          p = st.pos.clone().add(_v.set(0, PAD_TOP + MARBLE_R, 0));
          const kk = kickAt(st.kicks, s); if (kk >= 0) p.y += Math.sin(Math.PI * kk) * 0.32;
          ringBell(st, kk);
        }
        if (!p && !m.moves.length && activeHere) { const c = kids(m.node).find((x) => act.has(x.id)); if (c && m.pads.has(c.id)) { lit = c.id; p = m.pads.get(c.id).pos.clone().add(_v.set(0, PAD_TOP + MARBLE_R, 0)); } }
        m.marble.visible = !!p;
        if (p) {
          m.marble.position.copy(p);
          if (tang) { _q.setFromUnitVectors(_v.set(0, 0, 1), tang.normalize()); m.marble.quaternion.copy(_q); m.marble.scale.set(0.7, 0.7, 2.6); }
          else { m.marble.rotation.set(s * 4, 0, 0); m.marble.scale.setScalar(Math.max(0.01, scale)); }
        }
        // history: a ghost marble on the part it will come back to
        if (m.ghost) {
          let mem = null;
          if (!p && life.alive && stt.idx >= 0) { for (let i = stt.idx; i >= 0; i--) { const mv = m.moves[i]; if (mv.death) break; if (mv.from && !mv.to) { mem = mv.from; break; } if (mv.to) break; } }
          m.ghost.visible = !!(mem && m.pads.has(mem) && m.remembers);
          if (m.ghost.visible) m.ghost.position.copy(m.pads.get(mem).pos).add(_v.set(0, PAD_TOP + MARBLE_R, 0));
        }
        const curMv = stt.idx >= 0 ? m.moves[stt.idx] : null;
        const g = stt.travel ? 1 : curMv ? Math.max(0, 1 - (s - curMv.end) / GLOW) : 0;
        for (const tr of m.trackByKey.values()) if (!tr.viaBus) setTrack(tr, curMv && curMv.track === tr ? g : 0, tr.firstTaken <= s);
        if (m.buses) for (const b of m.buses) setTrack(b, curMv && curMv.track && curMv.track.bus === b ? g : 0, b.firstTaken <= s);
        const hk = kickAt(m.hopperKicks, s);
        if (m.funnel) m.funnel.scale.setScalar(hk >= 0 ? 1 + 0.25 * Math.sin(Math.PI * hk) : 1);
      }
      // lamps (beam and pads)
      if (m.beamLamps && (m.beamLit !== lit || m.beamDim !== lifeDim)) {
        if (m.beamLit != null && m.beamIdx.has(m.beamLit)) m.beamLamps.setColorAt(m.beamIdx.get(m.beamLit), COL.lampOff);
        if (lit != null && m.beamIdx.has(lit)) m.beamLamps.setColorAt(m.beamIdx.get(lit), _c.copy(m.beamCol.get(lit)).multiplyScalar(lifeDim));
        m.beamLamps.instanceColor.needsUpdate = true; m.beamLit = lit; m.beamDim = lifeDim;
      }
      if (m.lampLit !== lit && m.lampIM) {
        if (m.lampLit && m.pads.has(m.lampLit)) m.lampIM.setColorAt(m.pads.get(m.lampLit).index, COL.lampOff);
        if (lit && m.pads.has(lit)) { const st = m.pads.get(lit); m.lampIM.setColorAt(st.index, st.exc ? COL.lampExc : st.final ? COL.lampFinal : COL.lampOn); }
        m.lampIM.instanceColor.needsUpdate = true; m.lampLit = lit;
      }
      // speaking tubes: lit while the state is active and a child it invoked lives
      if (m.interiorBuilt && m.interior.visible) for (const st of m.padList) if (st.clock) {
        let run = null; for (const tm of st.timers) if (t >= tm.t0 && t < tm.t1) run = tm;
        st.clock.visible = st.clockStalk.visible = !!run;
        if (run) { const u = Math.min(1, (t - run.t0) / run.delay); st.hand.rotation.z = -u * Math.PI * 2; const q = Math.round(u * 48); if (st.wedgeQ !== q) { st.wedgeQ = q; st.clockWedge.geometry.dispose(); st.clockWedge.geometry = new THREE.CircleGeometry(0.15, 24, Math.PI / 2 - (q / 48) * Math.PI * 2, Math.max(0.001, (q / 48) * Math.PI * 2)); } }
      }
      if (m.marble) { const mm = m.marble.material; if (life.alive) { mm.emissiveIntensity = 0.75; mm.color.setHex(0xeef8ff); } else { mm.emissiveIntensity = 0; mm.color.setHex(0x6a7080); } }
      if (m.interiorBuilt) for (const st of m.padList) if (st.tubeMat) {
        const on = act.has(st.node.id) && (!st.childIds.length || st.childIds.some((c) => (sim.alive ? sim.alive(c, t) : true)));
        st.tubeMat.emissiveIntensity = on ? 0.9 + 0.4 * Math.sin(s * 6) : 0; st.tubeOn = on;
      }
    }
    // capsules (positions follow the current stage transform; getWorldPosition updates only the ancestors)
    let n = 0;
    for (let i = upperBound(capS, s) - 1; i >= 0 && n < capPool.length; i--) {
      const c = capsules[i]; const u = (s - c.s0) / 0.42; if (u > 1) { if (s - c.s0 > 3) break; continue; }
      let m = c.m; if (!m || !m.hopper) continue;
      while (m.parent && (!visibleChain(m) || !m.chrome.visible || !m.group.visible)) { m = m.parent; while (m && !m.hopper) m = m.parent; if (!m) break; }
      if (!m || !m.chrome.visible) continue;
      const mesh = capPool[n++]; mesh.visible = true;
      const sc = (m.hopper.getWorldScale(_v).x / group.getWorldScale(new V3()).x) * 1.5;
      const hp = group.worldToLocal(m.hopper.getWorldPosition(new V3()));
      const drop = Math.min(1, u / 0.7);
      mesh.position.copy(hp).add(_v.set(0, (1 - drop * drop) * 1.8 * sc, 0));
      mesh.scale.setScalar(Math.max(0.01, sc * (u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3))); mesh.rotation.z = 0.3 + u;
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
          const cnt = Math.min(18, v == null ? 0 : Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : 1);
          if (g.last !== cnt) { g.balls.count = cnt; for (let i = 0; i < cnt; i++) { _o.position.set(((i % 2) - 0.5) * 0.09, 0.22 + i * 0.09, 0); _o.updateMatrix(); g.balls.setMatrixAt(i, _o.matrix); } g.balls.instanceMatrix.needsUpdate = true; g.last = cnt; }
          g.ballMat.emissive.setRGB(flash, flash * 0.7, flash * 0.3);
        } else if (g.kind === "dial") {
          const num = typeof v === "number" ? v : 0;
          g.needleG.rotation.z = -((-120 + 240 * Math.min(1, Math.abs(num) / g.max)) * Math.PI) / 180;
          if (g.last !== num) { drawDial(g, num); g.last = num; }
          g.faceMat.emissiveIntensity = 0.5 * flash;
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
  function ringBell(st, kick) { if (st.bell) st.bell.rotation.z = kick >= 0 ? Math.sin(kick * Math.PI * 6) * 0.6 * (1 - kick) : 0; }
  function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
  function kickAt(list, s) { if (!list.length) return -1; const i = upperBound(list, s) - 1; if (i < 0) return -1; const u = (s - list[i]) / 0.42; return u < 1 ? u : -1; }
  function setTrack(tr, glow, taken) { tr.mat.color.copy(tr.baseCol).multiplyScalar((taken ? 1 : 0.42) + 0.25 * glow); tr.mat.emissiveIntensity = 1.4 * glow; }

  // ---------- pick / focus ----------
  const hits = [];
  function effectiveVisible(o) { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; }
  function pick(raycaster) {
    hits.length = 0; group.updateMatrixWorld(true);
    raycaster.intersectObjects(pickables, false, hits);
    for (const h of hits) {
      if (!effectiveVisible(h.object)) continue;
      const pk = h.object.userData.pick;
      let id = pk.id;
      if (h.object.userData.pickIds) id = h.object.userData.pickIds[h.instanceId];
      if (pk.kind === "state" && machById.has(id)) { const m = machById.get(id); if (m.open > 0.5 && (h.object === m.walls || h.object === m.lid)) continue; }
      return { kind: pk.kind, id, object: h.object, point: h.point };
    }
    return null;
  }
  function targetBounds(id) { // where the focused thing will be once the stage has settled (world coordinates)
    group.updateMatrixWorld(true);
    const m = id ? machById.get(id) : null, st = id ? stations.get(id) : null;
    let b;
    if (m && m.rootBox) b = m.rootBox.clone();
    else if (st) { const sc = st.rootScale; b = new THREE.Box3(st.rootPos.clone().add(new V3(-0.6 * sc, 0, -0.6 * sc)), st.rootPos.clone().add(new V3(0.6 * sc, 1.0 * sc, 0.6 * sc))); }
    else b = box.clone();
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
    stage = stageFor(focusId); applyStage(stage);
    const tx = stageXf(stage); xfTarget.s = tx.s; xfTarget.p.copy(tx.p);
    return api.focusBounds;
  }
  function setDetail(d) { detail = Math.min(1, Math.max(0, d)); }
  function dispose() {
    group.removeFromParent();
    for (const g of owned.geos) g.dispose(); for (const m of owned.mats) m.dispose(); for (const t of owned.texs) t.dispose(); for (const im of owned.inst) im.dispose();
  }

  const api = {
    group, update, setDetail, pick, focus, dispose,
    get focusBounds() { return targetBounds(focusId); },
    get detail() { return detail; },
    get focusId() { return focusId; },
    get stageId() { return stage ? stage.id : null; },
    levels: maxLevel,
    states: () => [...stations.keys(), ...[...machById.keys()].filter((k) => !stations.has(k))],
    pathTo: (id) => ownerMachines(id).map((m) => m.id),
    boundsOf: (id) => targetBounds(id),
    movesOf: (id) => { const m = machById.get(id); return m && m.moves ? m.moves.map(({ start, end, from, to, ev, fast, death }) => ({ start, end, from, to, ev, fast: !!fast, death: !!death })) : []; },
    // invokes: where each speaking tube leaves the head (world coordinates), and whether it is lit (after update)
    outlets: () => { group.updateMatrixWorld(true); return [...stations.values()].filter((st) => st.outlet).map((st) => ({ stateId: st.node.id, invokes: st.invokes, childIds: st.childIds, active: !!st.tubeOn, position: st.outlet.getWorldPosition(new V3()), visible: effectiveVisible(st.outlet) })); },
    stats: () => { let meshes = 0, inst = 0; group.traverse((o) => { if (o.isInstancedMesh) inst++; else if (o.isMesh) meshes++; }); return { meshes, instanced: inst, machines: machines.length, stations: stations.size, levels: maxLevel }; },
  };
  update(0, 0);
  return api;
}

function upperBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; }
