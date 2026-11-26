// head/head.js: what you see inside a person's head. Their statechart, built as machines.
//
// Grammar (see README.md):
//   parallel state  -> a bench: one machine per region, side by side
//   compound state  -> a machine: a housing on a plinth; closed it shows one lamp per part;
//                      opened (detail) the walls turn to glass, the lid swings up, parts appear
//   atomic state    -> a station: a pad on the machine's floor; the occupied one holds the marble
//   final state     -> a drain (dark ring with a hole); history -> a notched pad
//   transition      -> a track between pads (brass = main line, red = exceptional);
//                      a transition the machine itself takes to one of its parts -> a chute from
//                      its hopper; a re-entry -> a loop above the pad
//   event arriving  -> a mail capsule dropping into the machine's hopper; then the marble travels
//   variable        -> a gauge on the back rail (tube of balls = list/map, dial = number,
//                      lever = boolean), piped to the machines that read or write it
// Everything is a pure function of virtual time t (through sim.warp) and of detail/focus.
// This file imports nothing: WORLD passes THREE in.

const NEST = 0.5;        // scale of a machine inside a machine
const PAD_W = 1.3;       // slot width of a station
const PAD_ZONE = 1.05;   // depth taken by a pad (in front of a nested housing)
const MARGIN = 0.38;
const ROW_GAP = 0.35;
const SHELF = 0.32;      // exceptional row stands on a shelf
const PLINTH = 0.3;
const CAP_LEAD = 0.32;   // playback s: capsule drop before the marble starts
const TRAVEL = 0.46;     // playback s a marble spends on a track
const GLOW = 1.8;        // playback s a taken track keeps glowing
const MARBLE_R = 0.14;
const PAD_TOP = 0.12;

const HUES = [0x4fa39a, 0xd9a93f, 0xd46f62, 0x8a80c6, 0x5f97d4, 0x8db85c, 0xc77bb0];
const EXC_STATE = /fail|error|offline|backoff|reject|timeout|abort|cancel|^left$|^locked$|^stopped$/i;
const EXC_EVENT = /(^|\.)(error|fail|failed|timeout|interrupt|cancel|offline|leave|rejected|forget|bye|retry)(\.|$)/i;

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
    rod: G(new THREE.CylinderGeometry(0.03, 0.03, 1, 6)),
    box: G(new THREE.BoxGeometry(1, 1, 1)),
    ring: G(new THREE.TorusGeometry(0.27, 0.045, 8, 24)),
    hole: G(new THREE.CircleGeometry(0.2, 20)),
    capsule: G(new THREE.CapsuleGeometry(0.1, 0.24, 4, 10)),
    cone: G(new THREE.ConeGeometry(0.07, 0.16, 8)),
    ball: G(new THREE.SphereGeometry(0.085, 12, 8)),
    tube: G(new THREE.CylinderGeometry(0.22, 0.22, 1, 18, 1, true)),
    disc: G(new THREE.CircleGeometry(0.4, 32)),
    pulse: G(new THREE.SphereGeometry(0.08, 10, 8)),
    plane: G(new THREE.PlaneGeometry(1, 1)),
  };
  const mat = {
    iron: std(0x3b404c, { roughness: 0.85, metalness: 0.25 }),
    board: std(0x6b4f3a, { roughness: 0.9 }),
    plinth: std(0x2c3039, { roughness: 0.7, metalness: 0.3 }),
    brass: std(0xc9a44c, { roughness: 0.35, metalness: 0.7 }),
    pad: std(0x6a7180, { roughness: 0.55, metalness: 0.4 }),
    drain: std(0x15171c, { roughness: 0.9 }),
    red: std(0xc0463a, { roughness: 0.5, metalness: 0.3 }),
    sleeper: std(0x4a3a2c, { roughness: 0.9 }),
    copper: std(0xb8693f, { roughness: 0.4, metalness: 0.6 }),
    glass: M(new THREE.MeshStandardMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0, depthWrite: false })),
    capsule: std(0xf6ecd2, { roughness: 0.45, emissive: 0xffd88a, emissiveIntensity: 0.55 }),
    pulse: M(new THREE.MeshBasicMaterial({ color: 0xffd27a })),
    lampOff: std(0x23262d, { roughness: 0.5 }),
    shelf: std(0x4a3528, { roughness: 0.9 }),
    floor: std(0x555c6b, { roughness: 0.8, metalness: 0.2 }),
    funnel: std(0xc9a44c, { roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide }),
    none: M(new THREE.MeshBasicMaterial({ visible: false })),
  };

  const sleeperGeo = G(new THREE.BoxGeometry(0.26, 0.025, 0.05));

  // ---------- engraved plates (text only on things, small) ----------
  const plateCache = new Map();
  function plateTexture(text, fg = "#f4e7c4", bg = "#262a31") {
    const key = `${text}|${fg}|${bg}`;
    if (plateCache.has(key)) return plateCache.get(key);
    const c = document.createElement("canvas"); const ctx = c.getContext("2d");
    const font = "600 56px ui-monospace, Menlo, Consolas, monospace";
    ctx.font = font; const tw = Math.ceil(ctx.measureText(text).width);
    c.width = tw + 56; c.height = 88;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#b89443"; ctx.lineWidth = 6; ctx.strokeRect(3, 3, c.width - 6, c.height - 6);
    ctx.fillStyle = "#b89443"; for (const [x, y] of [[12, 12], [c.width - 12, 12], [12, c.height - 12], [c.width - 12, c.height - 12]]) { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill(); }
    ctx.font = font; ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.fillText(text, 28, c.height / 2 + 3);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; owned.texs.add(tex);
    const r = { tex, aspect: c.width / c.height }; plateCache.set(key, r); return r;
  }
  function plate(text, h, maxW = Infinity) {
    const { tex, aspect } = plateTexture(text);
    let w = h * aspect; if (w > maxW) { h *= maxW / w; w = maxW; }
    const m = new THREE.Mesh(geo.plane, M(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.2 })));
    m.scale.set(w, h, 1); m.userData.w = w; return m;
  }

  // ---------- chart helpers ----------
  const parentOf = new Map(), nodeById = new Map();
  function index(n, p) { nodeById.set(n.id, n); if (p) parentOf.set(n.id, p); for (const c of n.children || []) index(c, n); }
  const has = (n) => n && n.children && n.children.length > 0;
  function childContaining(node, id) {
    let x = nodeById.get(id); if (!x) return null;
    while (x && parentOf.get(x.id) !== node) x = parentOf.get(x.id);
    return x || null;
  }
  function walk(n, f) { f(n); for (const c of n.children || []) walk(c, f); }
  function matches(desc, name) {
    if (!desc || !name) return false;
    return desc.split(/\s+/).some((d) => d === "*" || d === name || (d.endsWith(".*") ? name.startsWith(d.slice(0, -1)) : name.startsWith(d + ".")));
  }
  const isExcState = (n) => EXC_STATE.test(n.id);

  // ---------- model ----------
  const machines = [];          // housed things (machine, solo)
  const machById = new Map();   // state id -> machine record (for compound/parallel-region/solo)
  const stations = new Map();   // state id -> {m, pos (machine interior local), pad}
  const pickables = [];
  const tracks = [];
  let maxLevel = 1;

  function siblingEdges(node) {
    const out = new Map();
    const add = (a, b, tr, global) => {
      const key = `${a}|${b}`; let e = out.get(key);
      if (!e) { e = { a, b, key, events: [], conds: [], global, exc: false }; out.set(key, e); }
      if (tr.event) e.events.push(tr.event); if (tr.cond) e.conds.push(tr.cond);
    };
    for (const tr of node.transitions || []) for (const tg of tr.targets) { const cb = childContaining(node, tg); if (cb) add("*", cb.id, tr, true); }
    for (const c of node.children) walk(c, (x) => {
      for (const tr of x.transitions || []) for (const tg of tr.targets) {
        const cb = childContaining(node, tg); if (!cb) continue;
        if (cb !== c) add(c.id, cb.id, tr, false); else if (tg === c.id) add(c.id, c.id, tr, false);
      }
    });
    for (const e of out.values()) {
      const nb = nodeById.get(e.b), na = nodeById.get(e.a);
      e.exc = e.events.some((ev) => ev.split(/\s+/).some((x) => EXC_EVENT.test(x))) || e.conds.some((c) => /error|fail/.test(c)) ||
        (nb && isExcState(nb) && !(node.initial || []).includes(nb.id)) || (na && isExcState(na) && !(node.initial || []).includes(na.id));
    }
    return [...out.values()];
  }
  function orderChildren(node, edges) {
    const kids = node.children; const init = (node.initial && node.initial[0]) || kids[0].id;
    const back = kids.filter((c) => c.id !== init && isExcState(c));
    const seen = new Set([init]); const order = [init]; const q = [init];
    while (q.length) { const a = q.shift(); for (const e of edges) if (!e.global && !e.exc && e.a === a && !seen.has(e.b) && !back.some((b) => b.id === e.b)) { seen.add(e.b); order.push(e.b); q.push(e.b); } }
    for (const e of edges) if (e.global && !seen.has(e.b) && !back.some((b) => b.id === e.b)) { seen.add(e.b); order.push(e.b); }
    for (const c of kids) if (!seen.has(c.id) && !back.includes(c)) { seen.add(c.id); order.push(c.id); }
    return { main: order.map((id) => nodeById.get(id)), back };
  }

  function addPad(m, node, pos, { initial }) {
    const g = new THREE.Group(); g.position.copy(pos); m.interior.add(g);
    const final = node.kind === "final", hist = node.kind === "history";
    const base = new THREE.Mesh(geo.pad, final ? mat.drain : mat.pad); base.position.y = PAD_TOP / 2; g.add(base);
    const lampMat = std(0x2a2d33, { emissive: isExcState(node) ? 0xff5a3c : 0xffc34a, emissiveIntensity: 0, roughness: 0.4 });
    let lamp;
    if (final) {
      const ring = new THREE.Mesh(geo.ring, lampMat); ring.rotation.x = Math.PI / 2; ring.position.y = PAD_TOP + 0.01; g.add(ring);
      const hole = new THREE.Mesh(geo.hole, mat.drain); hole.rotation.x = -Math.PI / 2; hole.position.y = PAD_TOP + 0.012; g.add(hole); lamp = ring;
    } else {
      lamp = new THREE.Mesh(geo.lamp, lampMat); lamp.position.y = PAD_TOP + 0.01; g.add(lamp);
      if (hist) { const notch = new THREE.Mesh(geo.box, mat.brass); notch.scale.set(0.12, 0.2, 0.3); notch.position.set(0.32, 0.1, 0); g.add(notch); }
    }
    if (initial) { // entry funnel above the initial station
      const f = new THREE.Mesh(geo.funnel, mat.funnel); f.position.set(-0.3, 0.62, -0.22); f.rotation.z = -0.5; f.scale.setScalar(0.5); g.add(f);
    }
    const p = plate(node.id, 0.17, 1.15); p.position.set(0, 0.06, 0.46); p.rotation.x = -0.9; g.add(p);
    base.userData.pick = { kind: "state", id: node.id }; pickables.push(base);
    const st = { m, node, pos: pos.clone(), group: g, lamp, lampMat, plate: p, kicks: [] };
    stations.set(node.id, st); m.pads.set(node.id, st); return st;
  }

  function housing(m, w, d, H, hue, label) {
    const plinth = new THREE.Mesh(geo.box, mat.plinth); plinth.scale.set(w, PLINTH, d); plinth.position.y = -PLINTH / 2; m.group.add(plinth);
    plinth.userData.pick = { kind: "state", id: m.id }; pickables.push(plinth);
    const floor = new THREE.Mesh(geo.box, mat.floor); floor.scale.set(w - 0.12, 0.02, d - 0.12); floor.position.y = 0.0; m.group.add(floor);
    const color = new THREE.Color(hue);
    const wallMat = M(new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, transparent: true, opacity: 1 }));
    const lidMat = M(new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(1.08), roughness: 0.55, metalness: 0.15, transparent: true, opacity: 1 }));
    const edgeMat = M(new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), roughness: 0.5, metalness: 0.3 }));
    const walls = new THREE.Mesh(geo.box, [wallMat, wallMat, mat.none, mat.none, wallMat, wallMat]);
    walls.scale.set(w, H, d); walls.position.y = H / 2; m.group.add(walls);
    walls.userData.pick = { kind: "state", id: m.id }; pickables.push(walls);
    // the frame stays solid: corner posts, a rim round the top, a header beam in front
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const post = new THREE.Mesh(geo.box, edgeMat); post.scale.set(0.09, H, 0.09); post.position.set(sx * (w / 2 - 0.02), H / 2, sz * (d / 2 - 0.02)); m.group.add(post); }
    for (const [sx, sz, lw, ld] of [[0, -1, w, 0.09], [-1, 0, 0.09, d], [1, 0, 0.09, d]]) { const r = new THREE.Mesh(geo.box, edgeMat); r.scale.set(lw, 0.09, ld); r.position.set(sx * (w / 2 - 0.02), H, sz * (d / 2 - 0.02)); m.group.add(r); }
    const BEAM = Math.min(0.5, 0.2 + 0.03 * w);
    // the header beam carries the nameplate and the lamps; when the machine opens it slides down to the plinth
    const beamG = new THREE.Group(); beamG.position.set(0, H - BEAM / 2 + 0.045, d / 2 - 0.02); m.group.add(beamG);
    const beam = new THREE.Mesh(geo.box, edgeMat); beam.scale.set(w, BEAM, 0.12); beamG.add(beam);
    beam.userData.pick = { kind: "state", id: m.id }; pickables.push(beam);
    const lid = new THREE.Mesh(geo.box, [mat.none, mat.none, lidMat, mat.none, mat.none, mat.none]); lid.scale.set(w, 0.02, d); lid.position.set(0, H + 0.03, 0); m.group.add(lid);
    lid.userData.pick = { kind: "state", id: m.id }; pickables.push(lid);
    // hopper: a funnel on a post at the back-left corner, above the lid
    const hx = -w / 2 + 0.32, hz = -d / 2 + 0.3;
    const post = new THREE.Mesh(geo.rod, mat.brass); post.scale.set(1.2, H + 0.5, 1.2); post.position.set(hx - 0.25, (H + 0.5) / 2, hz); m.group.add(post);
    const fun = new THREE.Mesh(geo.funnel, mat.funnel); fun.position.set(hx, H + 0.55, hz); m.group.add(fun);
    const mouth = new THREE.Object3D(); mouth.position.set(hx, H + 0.75, hz); m.group.add(mouth);
    // nameplate on the header beam
    const p = plate(label, BEAM * 0.62, w * 0.5); p.position.set(-w / 2 + 0.12 + p.userData.w / 2, 0, 0.065); beamG.add(p);
    Object.assign(m, { beamG, beamY: [H - BEAM / 2 + 0.045, -BEAM / 2 + 0.03], walls, wallMat, lidMat, edgeMat, baseColor: color.clone(), lid, hopper: mouth, funnel: fun, H, BEAM, size: { w, d, h: H + 0.8 }, namePlate: p });
  }

  function addLamps(m, order) { // one round lamp per part, on the header beam: closed, it still says which part runs
    const n = order.length; const room = m.size.w * 0.42; const sp = Math.min(m.BEAM * 0.95, room / Math.max(1, n));
    const x0 = m.size.w / 2 - 0.12 - sp / 2 - sp * (n - 1);
    order.forEach((c, i) => {
      const lm = std(0x1d1f24, { emissive: isExcState(c) ? 0xff5a3c : 0xffc34a, emissiveIntensity: 0, roughness: 0.35 });
      const l = new THREE.Mesh(geo.disc, lm); l.scale.setScalar((sp * 0.38) / 0.4); l.position.set(x0 + i * sp, 0, 0.065); m.beamG.add(l);
      m.lamps.set(c.id, lm);
    });
  }

  function newRecord(kind, node, level, hue, parent) {
    const m = { kind, node, id: node.id, level, hue, parent, children: [], pads: new Map(), edges: [], trackByKey: new Map(), arcs: new Map(), lamps: new Map(), moves: [], hopperKicks: [] };
    m.group = new THREE.Group(); m.interior = new THREE.Group(); m.group.add(m.interior);
    maxLevel = Math.max(maxLevel, level);
    return m;
  }

  function buildMachine(node, level, hue, parent) {
    const m = newRecord("machine", node, level, hue, parent); machines.push(m); machById.set(node.id, m);
    const edges = siblingEdges(node); m.edges = edges;
    const { main, back } = orderChildren(node, edges);
    const slot = (c) => {
      if (has(c)) {
        const sub = c.kind === "parallel" ? buildBench(c, level + 1, hue, m) : buildMachine(c, level + 1, lighten(hue, 0.18), m);
        return { c, sub, w: sub.size.w * NEST + 0.35, d: sub.size.d * NEST + PAD_ZONE, h: sub.size.h * NEST };
      }
      return { c, w: PAD_W, d: PAD_ZONE, h: 0 };
    };
    const mainS = main.map(slot), backS = back.map(slot);
    const rowW = (r) => r.reduce((s, x) => s + x.w, 0);
    const innerW = Math.max(rowW(mainS), rowW(backS), 1.4);
    const mainD = Math.max(PAD_ZONE, ...mainS.map((x) => x.d)), backD = backS.length ? Math.max(...backS.map((x) => x.d)) : 0;
    const w = innerW + 2 * MARGIN, d = mainD + (backS.length ? backD + ROW_GAP : 0) + 2 * MARGIN;
    const innerH = Math.max(1.5, ...mainS.map((x) => x.h + 0.25), ...backS.map((x) => x.h + 0.25 + SHELF));
    housing(m, w, d, innerH + 0.35, hue, node.id);
    const init = (node.initial && node.initial[0]) || node.children[0].id;
    const place = (row, zf, y) => {
      let x = -rowW(row) / 2;
      for (const s of row) {
        const cx = x + s.w / 2, padZ = zf - 0.48;
        addPad(m, s.c, new V3(cx, y, padZ), { initial: s.c.id === init });
        if (s.sub) { s.sub.group.scale.setScalar(NEST); s.sub.group.position.set(cx, y, padZ - 0.5 - (s.sub.size.d * NEST) / 2); m.interior.add(s.sub.group); m.children.push(s.sub); s.sub.padOf = s.c.id; }
        x += s.w;
      }
    };
    const zFront = d / 2 - MARGIN;
    place(mainS, zFront, 0);
    if (backS.length) {
      const zb = zFront - mainD - ROW_GAP;
      const shelf = new THREE.Mesh(geo.box, mat.shelf); shelf.scale.set(rowW(backS) + 0.2, SHELF, backD); shelf.position.set(0, SHELF / 2 - 0.001, zb - backD / 2); m.interior.add(shelf);
      place(backS, zb, SHELF);
    }
    addLamps(m, [...main, ...back]);
    buildTracks(m);
    m.marble = new THREE.Mesh(geo.marble, M(new THREE.MeshStandardMaterial({ color: 0xeef8ff, emissive: 0x8fd4ff, emissiveIntensity: 0.75, roughness: 0.15, metalness: 0.3 })));
    m.marble.visible = false; m.interior.add(m.marble);
    return m;
  }

  function buildSolo(node, level, hue, parent) { // an atomic region: one station, always occupied
    const m = newRecord("solo", node, level, hue, parent); machines.push(m); machById.set(node.id, m);
    const w = PAD_W + 2 * MARGIN, d = PAD_ZONE + 2 * MARGIN;
    housing(m, w, d, 1.5, hue, node.id);
    addPad(m, node, new V3(0, 0, d / 2 - MARGIN - 0.48), { initial: false });
    addLamps(m, [node]);
    // a loop above the pad: its transitions keep it where it is
    const st = stations.get(node.id); const c = loopCurve(st.pos); addTrackMesh(m, c, false, `${node.id}|${node.id}`, { a: node.id, b: node.id, events: (node.transitions || []).map((t) => t.event).filter(Boolean) });
    m.marble = new THREE.Mesh(geo.marble, M(new THREE.MeshStandardMaterial({ color: 0xeef8ff, emissive: 0x8fd4ff, emissiveIntensity: 0.75, roughness: 0.15, metalness: 0.3 })));
    m.marble.visible = false; m.interior.add(m.marble);
    return m;
  }

  function buildBench(node, level, hue, parent, top = false) {
    const b = newRecord("bench", node, level, hue, parent); machById.set(node.id, b);
    const subs = node.children.map((c, i) => {
      const h = top ? HUES[i % HUES.length] : lighten(hue, 0.1 + 0.08 * (i % 3));
      if (has(c)) return c.kind === "parallel" ? buildBench(c, level, h, parent) : buildMachine(c, level, h, parent);
      return buildSolo(c, level, h, parent);
    });
    b.children = subs;
    for (const s of subs) s.region = s; // regions of a bench
    const GAP = 0.55;
    const rowW = (r) => r.reduce((s, x) => s + x.size.w, 0) + GAP * Math.max(0, r.length - 1);
    let rows = [subs];
    const maxD = Math.max(...subs.map((s) => s.size.d));
    if (top && subs.length >= 3 && rowW(subs) > 3.2 * maxD) {
      // two tiers: the biggest machine in front, the rest behind on a raised step
      const big = subs.reduce((a, s) => (s.size.w * s.size.d > a.size.w * a.size.d ? s : a));
      let front = [big], backR = subs.filter((s) => s !== big);
      while (backR.length > 1 && rowW(backR) > rowW(front) * 1.25) { const s = backR.reduce((a, x) => (x.size.w < a.size.w ? x : a)); backR = backR.filter((x) => x !== s); front.push(s); front.sort((a, b2) => subs.indexOf(a) - subs.indexOf(b2)); }
      rows = [front, backR];
    } else if (!top && subs.length >= 4) { // a nested bench of many regions: two rows, order kept
      let best = 1, bestW = Infinity;
      for (let k = 1; k < subs.length; k++) { const mw = Math.max(rowW(subs.slice(0, k)), rowW(subs.slice(k))); if (mw < bestW) { bestW = mw; best = k; } }
      rows = [subs.slice(0, best), subs.slice(best)];
    }
    let z = 0, y = 0, W = 0; const placed = [];
    rows.forEach((row, ri) => {
      const rd = Math.max(...row.map((s) => s.size.d));
      let x = -rowW(row) / 2;
      for (const s of row) { s.group.position.set(x + s.size.w / 2, y + PLINTH, z - rd / 2); b.interior.add(s.group); x += s.size.w + GAP; }
      placed.push({ z, rd, y }); W = Math.max(W, rowW(row));
      z -= rd + 0.6; y += ri === 0 ? (top ? 1.3 : 0.6) : 0;
    });
    const D = -z - 0.6;
    // the bench board (and a step for the back tier)
    const board = new THREE.Mesh(geo.box, mat.board); board.scale.set(W + 0.8, 0.2, D + 0.8); board.position.set(0, -0.1, -D / 2); b.interior.add(board);
    if (rows.length > 1) { const p = placed[1]; const step = new THREE.Mesh(geo.box, mat.board); step.scale.set(W + 0.8, p.y, p.rd + 0.7); step.position.set(0, p.y / 2, p.z - p.rd / 2); b.interior.add(step); }
    b.interior.position.z = D / 2;
    b.size = { w: W + 0.8, d: D + 0.8, h: Math.max(...subs.map((s) => s.size.h + (s.group.position.y))) };
    b.rows = rows;
    return b;
  }

  function lighten(hex, f) { const c = new THREE.Color(hex); c.lerp(new THREE.Color(0xffffff), f); return c.getHex(); }

  // ---------- tracks ----------
  function padTop(m, id) { const st = m.pads.get(id); return st.pos.clone().add(new V3(0, PAD_TOP + 0.04, 0)); }
  function arcCurve(p0, p3, off = 0.24) {
    const v = p3.clone().sub(p0); const dist = v.length();
    const n = new V3(v.z, 0, -v.x).normalize().multiplyScalar(off);
    const h = 0.22 + 0.16 * dist;
    const p1 = p0.clone().addScaledVector(v, 0.22).add(n).add(new V3(0, h, 0));
    const p2 = p0.clone().addScaledVector(v, 0.78).add(n).add(new V3(0, h, 0));
    return new THREE.CubicBezierCurve3(p0, p1, p2, p3);
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
    m.interior.add(mesh);
    // arrowhead at the arriving end
    const cone = new THREE.Mesh(geo.cone, tm); const u = 0.86; cone.position.copy(curve.getPointAt(u));
    cone.quaternion.setFromUnitVectors(new V3(0, 1, 0), curve.getTangentAt(u).normalize()); m.interior.add(cone);
    if (!exc && !chute && edge.a !== edge.b) { // sleepers under the main line (instanced, one InstancedMesh for the head)
      const len = curve.getLength(); const n = Math.max(2, Math.floor(len / 0.2));
      for (let i = 1; i < n; i++) { const p = curve.getPointAt(i / n), tg = curve.getTangentAt(i / n); (m.sleepers ||= []).push({ p, tg }); }
    }
    const tr = { m, key, curve, mesh, mat: tm, baseCol, exc, edge, chute, firstTaken: Infinity, takenAt: [] };
    mesh.userData.pick = { kind: "transition", id: `${m.id}:${key.replace("|", "->")}` }; pickables.push(mesh);
    m.trackByKey.set(key, tr); tracks.push(tr); return tr;
  }
  function addSleepers(m) { // the repeated part of every main line: one InstancedMesh per machine
    if (!m.sleepers || !m.sleepers.length) return;
    const im = new THREE.InstancedMesh(sleeperGeo, mat.sleeper, m.sleepers.length); const o = new THREE.Object3D();
    m.sleepers.forEach(({ p, tg }, i) => { const h = tg.clone(); h.y = 0; if (h.lengthSq() < 1e-6) h.set(1, 0, 0); h.normalize(); o.position.copy(p).add(new V3(0, -0.045, 0)); o.quaternion.setFromUnitVectors(new V3(0, 0, 1), h); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.instanceMatrix.needsUpdate = true; m.interior.add(im); owned.inst.push(im);
  }
  function buildTracks(m) {
    for (const e of m.edges) {
      let curve, chute = false;
      if (e.global) {
        if (!m.pads.has(e.b)) continue;
        const h = m.hopper.position; const p3 = padTop(m, e.b);
        const p0 = new V3(h.x, m.H - 0.15, h.z);
        curve = new THREE.CubicBezierCurve3(p0, new V3(p0.x, p3.y + 0.9, p0.z), new V3(p3.x, p3.y + 0.9, p3.z - 0.15), p3); chute = true;
      } else if (e.a === e.b) curve = loopCurve(m.pads.get(e.a).pos);
      else if (m.pads.has(e.a) && m.pads.has(e.b)) curve = arcCurve(padTop(m, e.a), padTop(m, e.b));
      else continue;
      addTrackMesh(m, curve, e.exc, e.key, e, chute);
    }
    addSleepers(m);
  }
  function moveCurve(m, from, to) {
    const key = `${from}|${to}`;
    const t = m.trackByKey.get(key); if (t) return t.curve;
    if (m.arcs.has(key)) return m.arcs.get(key);
    const c = from === to ? loopCurve(m.pads.get(from).pos) : arcCurve(padTop(m, from), padTop(m, to), 0);
    m.arcs.set(key, c); return c;
  }

  // ---------- build ----------
  let top = null;
  if (chart) {
    index(chart.root, null);
    let tn = chart.root;
    if (tn.id === "__root__" && tn.children.length === 1 && has(tn.children[0])) tn = tn.children[0];
    if (tn.kind === "parallel") top = buildBench(tn, 1, HUES[0], null, true);
    else {
      top = buildMachine(tn, 1, HUES[0], null);
      if (tn.id === "__root__") { top.namePlate.visible = false; const p = plate(chart.source ? chart.source.replace(/\.scxml$/, "") : actorId, PLINTH * 0.72, top.size.w * 0.55); p.position.copy(top.namePlate.position); p.position.x = -top.size.w / 2 + 0.08 + p.userData.w / 2; top.group.add(p); }
    }
    root.add(top.group);
  } else {
    // an external: a sealed crate, nothing inside to see
    const c = new THREE.Mesh(geo.box, mat.iron); c.scale.set(3, 2, 2); c.position.y = 1; root.add(c);
    c.userData.pick = { kind: "state", id: actorId }; pickables.push(c);
  }
  const regions = top ? (top.kind === "bench" ? top.children : [top]) : [];

  // ---------- data: moves, capsules, kicks ----------
  const housed = machines; const compound = machines.filter((m) => m.kind === "machine");
  const allMsgs = sim.messagesBetween ? sim.messagesBetween(-1, (sim.duration || 1e9) + 10).filter((x) => x.to === actorId) : [];
  const allTrs = sim.transitionsBetween ? sim.transitionsBetween(-1, (sim.duration || 1e9) + 10).filter((x) => x.actor === actorId) : [];
  const atOf = (e) => (e.at != null ? e.at : e.t);
  const arrive = (msg) => (sim.flight ? sim.flight(msg)[1] : warp(atOf(msg)));
  const capsules = []; // {s0, m}
  const usedMsg = new Set();
  for (const tr of allTrs) {
    const at = atOf(tr);
    const msg = tr.event ? allMsgs.find((x) => !usedMsg.has(x.id) && x.name === tr.event && Math.abs(atOf(x) - at) < 1e-6) : null;
    if (msg) usedMsg.add(msg.id);
    const base = msg ? arrive(msg) + CAP_LEAD : warp(at) + 0.04;
    let outer = null, outerBoth = null;
    for (const m of compound) {
      const ex = m.node.children.find((c) => tr.from.includes(c.id));
      const en = m.node.children.find((c) => tr.to.includes(c.id));
      if (!ex && !en) continue;
      m.moves.push({ base, from: ex ? ex.id : null, to: en ? en.id : null, ev: tr.event || "", trId: tr.id });
      if (!outer || m.level < outer.level) outer = m;
      if (ex && en && (!outerBoth || m.level < outerBoth.level)) outerBoth = m;
    }
    if (msg) capsules.push({ s0: arrive(msg), m: outerBoth || outer || regions[0] });
  }
  // messages that moved nothing: find who heard them (a targetless or failed-guard transition)
  for (const msg of allMsgs) {
    if (usedMsg.has(msg.id)) continue;
    const at = atOf(msg); const act = sim.activeAt(actorId, at - 1e-7);
    let hit = null;
    for (let i = act.length - 1; i >= 0 && !hit; i--) {
      const n = nodeById.get(act[i]); if (!n) continue;
      if ((n.transitions || []).some((tr) => matches(tr.event, msg.name))) hit = n;
    }
    // deepest by tree depth among matches
    let best = null, bestDepth = -1;
    for (const id of act) { const n = nodeById.get(id); if (!n || !(n.transitions || []).some((tr) => matches(tr.event, msg.name))) continue; let dd = 0, x = n; while (parentOf.get(x.id)) { dd++; x = parentOf.get(x.id); } if (dd > bestDepth) { best = n; bestDepth = dd; } }
    hit = best;
    const s0 = arrive(msg);
    if (!hit) { capsules.push({ s0, m: regions[0], lost: true }); continue; }
    const st = stations.get(hit.id);
    if (st && !machById.has(hit.id)) { st.kicks.push(s0 + CAP_LEAD); capsules.push({ s0, m: st.m }); continue; }
    const sm = machById.get(hit.id);
    if (sm && sm.kind === "solo") { stations.get(hit.id).kicks.push(s0 + CAP_LEAD); capsules.push({ s0, m: sm }); continue; }
    let mm = sm; while (mm && mm.kind === "bench") mm = mm.parent;
    if (!mm) mm = regions.find((r) => { let ok = false; walk(r.node, (x) => { if (x.id === hit.id) ok = true; }); return ok; }) || regions[0];
    if (mm) { mm.hopperKicks.push(s0 + CAP_LEAD); capsules.push({ s0, m: mm }); }
  }
  capsules.sort((a, b) => a.s0 - b.s0);
  for (const st of stations.values()) st.kicks.sort((a, b) => a - b);
  // schedule each machine's moves: in order, never overlapping
  for (const m of compound) {
    // trace order is causal order: keep it, never let a later step start first
    let end = -Infinity;
    for (const mv of m.moves) {
      mv.start = Math.max(mv.base, end);
      const dur = mv.from && mv.to ? TRAVEL : 0.34;
      mv.end = mv.start + dur; end = mv.end;
      const tr = mv.from && mv.to ? m.trackByKey.get(`${mv.from}|${mv.to}`) || (mv.from !== mv.to ? m.trackByKey.get(`*|${mv.to}`) : null) : (mv.to ? m.trackByKey.get(`*|${mv.to}`) : null);
      mv.track = tr || null;
      if (tr) { tr.takenAt.push(mv); tr.firstTaken = Math.min(tr.firstTaken, mv.start); }
    }
    m.moveStarts = m.moves.map((x) => x.start);
  }
  const capS = capsules.map((c) => c.s0);

  // ---------- gauges (the datamodel that matters) ----------
  const gauges = [];
  const evOf = (id) => (sim.event ? sim.event(id) : null);
  if (chart && chart.datamodel && top) {
    const evs = (sim.trace && sim.trace.events) || [];
    const snaps = evs.filter((e) => e.type === "snapshot" && e.actor === actorId);
    const cands = [];
    for (const dv of chart.datamodel) {
      if (!dv.readBy || !dv.readBy.length) continue;
      const changes = []; let prev;
      for (const sn of snaps) { if (!(dv.id in sn.values)) continue; const j = JSON.stringify(sn.values[dv.id]); if (prev !== undefined && j !== prev) { const e = evOf(sn.id); changes.push({ s: warp(e ? e.at : sn.t), cause: sn.cause }); } prev = j; }
      if (!changes.length) continue;
      cands.push({ dv, changes, score: changes.length + 1.5 * dv.readBy.length });
    }
    cands.sort((a, b) => b.score - a.score);
    const chosen = cands.slice(0, options.maxGauges ?? 4);
    const regOf = (sid) => regions.find((r) => { let ok = false; walk(r.node, (x2) => { if (x2.id === sid) ok = true; }); return ok; });
    const perRoof = new Map();
    root.updateMatrixWorld(true);
    const toRoot = (obj, v) => root.worldToLocal(obj.localToWorld(v));
    chosen.forEach((c, i) => {
      // the gauge stands on the roof of the machine that reads it most; pipes run to the others
      const reads = new Map();
      for (const sid of c.dv.readBy || []) { const r = regOf(sid); if (r) reads.set(r, (reads.get(r) || 0) + 1); }
      const prim = [...reads.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || regions[0];
      const k = perRoof.get(prim) || 0; perRoof.set(prim, k + 1);
      if (k === 0) { const rack = new THREE.Mesh(geo.box, prim.edgeMat); rack.scale.set(prim.size.w, 0.1, 0.5); rack.position.set(0, prim.H + 0.05, -prim.size.d / 2 + 0.25); prim.group.add(rack); }
      const GS = 0.6;
      const lp = new V3(prim.size.w / 2 - 0.45 - k * 0.8, prim.H + 0.1, -prim.size.d / 2 + 0.28);
      const g = makeGauge(c.dv, lp, prim.group, GS);
      g.changes = c.changes;
      g.pipes = [];
      const regs = new Set([prim]);
      for (const sid of [...(c.dv.readBy || []), ...(c.dv.writtenBy || [])]) { const r = regOf(sid); if (r) regs.add(r); }
      const base = toRoot(prim.group, lp.clone().add(new V3(0, 0.05, 0)));
      for (const r of regs) {
        let curve;
        if (r === prim) { // a stub down into its own housing
          const inside = toRoot(prim.group, new V3(lp.x, 0.05, -prim.size.d / 2 - 0.06));
          const top2 = toRoot(prim.group, new V3(lp.x, prim.H + 0.1, -prim.size.d / 2 - 0.06));
          curve = new THREE.CatmullRomCurve3([inside, top2, base]);
        } else {
          const tgt = toRoot(r.group, new V3(r.size.w / 2 - 0.3, r.H + 0.1, -r.size.d / 2 + 0.3));
          const mid = base.clone().lerp(tgt, 0.5); mid.y = Math.max(base.y, tgt.y) + 1.1 + 0.15 * i;
          curve = new THREE.CatmullRomCurve3([tgt, tgt.clone().add(new V3(0, 0.6, 0)), mid, base.clone().add(new V3(0, 0.5, 0)), base]);
        }
        const pm = M(new THREE.MeshStandardMaterial({ color: 0xb8693f, roughness: 0.4, metalness: 0.6, emissive: 0xffa060, emissiveIntensity: 0 }));
        const mesh = new THREE.Mesh(G(new THREE.TubeGeometry(curve, r === prim ? 8 : 40, 0.032, 6, false)), pm); root.add(mesh);
        mesh.userData.pick = { kind: "variable", id: c.dv.id }; pickables.push(mesh);
        const pulse = new THREE.Mesh(geo.pulse, mat.pulse); pulse.visible = false; root.add(pulse);
        g.pipes.push({ r, curve, mesh, mat: pm, pulse, writer: (c.dv.writtenBy || []).some((sid) => regOf(sid) === r) });
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
      const glass = new THREE.Mesh(geo.tube, mat.glass); glass.scale.set(1, 1.7, 1); glass.position.y = 0.85 + 0.1; g.group.add(glass);
      const cap = new THREE.Mesh(geo.box, mat.brass); cap.scale.set(0.52, 0.08, 0.52); cap.position.y = 1.84; g.group.add(cap);
      const base = new THREE.Mesh(geo.box, mat.brass); base.scale.set(0.52, 0.1, 0.52); base.position.y = 0.06; g.group.add(base);
      const bm = M(new THREE.MeshStandardMaterial({ color: dv.type === "object" ? 0x7fc4ff : 0xffb36b, roughness: 0.3, emissive: 0x000000 }));
      g.balls = new THREE.InstancedMesh(geo.ball, bm, 18); g.balls.count = 0; g.group.add(g.balls); g.ballMat = bm;
      glass.userData.pick = { kind: "variable", id: dv.id }; pickables.push(glass);
    } else if (kind === "dial") {
      const body = new THREE.Mesh(geo.box, mat.iron); body.scale.set(0.95, 0.95, 0.22); body.position.y = 0.75; g.group.add(body);
      g.faceCanvas = document.createElement("canvas"); g.faceCanvas.width = g.faceCanvas.height = 256;
      g.faceTex = new THREE.CanvasTexture(g.faceCanvas); g.faceTex.colorSpace = THREE.SRGBColorSpace; owned.texs.add(g.faceTex);
      const face = new THREE.Mesh(geo.disc, M(new THREE.MeshStandardMaterial({ map: g.faceTex, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0, emissiveMap: g.faceTex })));
      face.position.set(0, 0.75, 0.115); g.group.add(face); g.faceMat = face.material;
      g.needle = new THREE.Mesh(geo.box, mat.red); g.needle.geometry = geo.box; g.needleG = new THREE.Group(); g.needleG.position.set(0, 0.75, 0.13); g.group.add(g.needleG);
      g.needle.scale.set(0.035, 0.32, 0.02); g.needle.position.y = 0.14; g.needleG.add(g.needle);
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
    const c = g.faceCanvas, x = c.getContext("2d");
    x.fillStyle = "#efe4c6"; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = "#3a3330"; x.lineWidth = 5;
    for (let i = 0; i <= 8; i++) { const a = (-120 + (240 * i) / 8 - 90) * Math.PI / 180; x.beginPath(); x.moveTo(128 + Math.cos(a) * 98, 128 + Math.sin(a) * 98); x.lineTo(128 + Math.cos(a) * 118, 128 + Math.sin(a) * 118); x.stroke(); }
    x.fillStyle = "#1d1f24"; x.fillRect(84, 160, 88, 52);
    x.fillStyle = "#ffd27a"; x.font = "600 42px ui-monospace, Menlo, monospace"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(String(v ?? "–").slice(0, 4), 128, 188);
    g.faceTex.needsUpdate = true;
  }
  for (const g of gauges) if (g.kind === "dial") { const vals = []; for (const e of ((sim.trace && sim.trace.events) || [])) if (e.type === "snapshot" && e.actor === actorId && typeof e.values[g.id] === "number") vals.push(e.values[g.id]); g.max = Math.max(1, ...vals); drawDial(g, 0); }

  // ---------- fit into the 10 x 10 x 10 box ----------
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const sz = box.getSize(new V3()); const fit = Math.min(9.4 / sz.x, 9.4 / sz.y, 9.4 / sz.z);
  root.scale.setScalar(fit);
  const ctr = box.getCenter(new V3()).multiplyScalar(fit);
  root.position.set(-ctr.x, -ctr.y, -ctr.z);
  group.updateMatrixWorld(true);
  // static geometry in group-local coordinates
  const tmp = new V3();
  for (const m of housed) { m.hopperLocal = group.worldToLocal(m.hopper.getWorldPosition(new V3())); m.scaleLocal = m.hopper.getWorldScale(new V3()).x; }
  // capsule and pulse pools (group-local)
  const capPool = [];
  for (let i = 0; i < 8; i++) { const c = new THREE.Mesh(geo.capsule, mat.capsule); c.visible = false; group.add(c); capPool.push(c); }

  // ---------- detail / focus ----------
  let detail = options.detail ?? 0, focusId = null, focusPath = null, focusLevel = maxLevel;
  const ss = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  function openOf(m) {
    if (focusPath && focusPath.has(m)) return ss(detail * focusLevel - (m.level - 1));
    return ss(detail * maxLevel - (m.level - 1));
  }
  function ownerMachines(id) { // machines (housed) from top down that contain state id
    const path = []; let x = nodeById.get(id);
    while (x) { const m = machById.get(x.id); if (m && m.kind !== "bench") path.unshift(m); x = parentOf.get(x.id); }
    return path;
  }
  function visibleChain(m) { // m and every housed ancestor open enough to see in
    for (let p = m.parent; p; p = p.parent) if (p.kind !== "bench" && p.open < 0.04) return false;
    return true;
  }

  // ---------- update ----------
  const up = new V3(0, 1, 0);
  let lastS = -1;
  function stateAt(m, s) {
    const i = upperBound(m.moveStarts, s) - 1;
    if (i < 0) return { rest: null, idx: -1 };
    const mv = m.moves[i];
    if (s < mv.end) return { travel: mv, u: (s - mv.start) / (mv.end - mv.start), idx: i };
    return { rest: mv.to, idx: i };
  }
  function update(t /*, dt */) {
    const s = warp(t); lastS = s;
    const alive = sim.alive ? sim.alive(actorId, t) : true;
    const act = alive ? new Set(sim.activeAt(actorId, t)) : new Set();
    for (const m of housed) {
      m.open = openOf(m);
      const o = m.open;
      const shown = visibleChain(m);
      const activeHere = act.has(m.id) || (m.kind === "machine" && m.node.id === "__root__" && alive);
      // housing: glass as it opens; inactive machines are darker
      const dim = activeHere ? 1 : 0.55;
      m.wallMat.color.copy(m.baseColor).multiplyScalar(dim);
      const oo = Math.min(1, o * 2.2);
      m.beamG.position.y = m.beamY[0] + (m.beamY[1] - m.beamY[0]) * ss(o * 1.3);
      m.wallMat.opacity = 1 - 0.92 * oo; m.wallMat.depthWrite = o < 0.35;
      m.lidMat.color.copy(m.baseColor).multiplyScalar(dim * 1.08);
      m.lidMat.opacity = 1 - oo; m.lidMat.depthWrite = o < 0.35; m.lid.visible = o < 0.97;
      m.interior.visible = o > 0.04 && shown;
      // the marble
      let lit = null;
      if (m.kind === "solo") {
        lit = act.has(m.id) ? m.id : null;
        const st = m.pads.get(m.id); const kick = st.kicks.length ? kickAt(st.kicks, s) : -1;
        m.marble.visible = !!lit;
        if (lit) {
          if (kick >= 0) m.marble.position.copy(m.trackByKey.get(`${m.id}|${m.id}`).curve.getPointAt(kick)).add(new V3(0, MARBLE_R, 0));
          else m.marble.position.copy(st.pos).add(new V3(0, PAD_TOP + MARBLE_R, 0));
        }
        const tr = m.trackByKey.get(`${m.id}|${m.id}`); if (tr) setTrack(tr, kick >= 0 ? 1 : 0, st.kicks.length && st.kicks[0] <= s);
      } else {
        const stt = alive ? stateAt(m, s) : { rest: null, idx: -1 };
        let p = null, scale = 1;
        if (stt.travel) {
          const mv = stt.travel; const u = stt.u;
          if (mv.from && mv.to) { p = moveCurve(m, mv.from, mv.to).getPointAt(ease(u)).add(new V3(0, MARBLE_R, 0)); lit = u > 0.92 ? mv.to : null; }
          else if (mv.to) { const q = m.pads.get(mv.to).pos; const k = u * u; p = q.clone().add(new V3(0, PAD_TOP + MARBLE_R + 1.3 * (1 - k), 0)); lit = u > 0.9 ? mv.to : null; }
          else if (mv.from) { const q = m.pads.get(mv.from).pos; p = q.clone().add(new V3(0, PAD_TOP + MARBLE_R - 0.3 * u, 0)); scale = 1 - u; }
        } else if (stt.rest) {
          lit = stt.rest; const st = m.pads.get(stt.rest);
          p = st.pos.clone().add(new V3(0, PAD_TOP + MARBLE_R, 0));
          const k = st.kicks.length ? kickAt(st.kicks, s) : -1;
          if (k >= 0) p.y += Math.sin(Math.PI * k) * 0.32;
        }
        // fallback: no recorded move yet but the machine is active (e.g. born active)
        if (!p && !m.moves.length && activeHere) {
          const c = m.node.children.find((x) => act.has(x.id)); if (c) { lit = c.id; p = m.pads.get(c.id).pos.clone().add(new V3(0, PAD_TOP + MARBLE_R, 0)); }
        }
        m.marble.visible = !!p; if (p) { m.marble.position.copy(p); m.marble.scale.setScalar(Math.max(0.01, scale)); m.marble.rotation.x = s * 4; }
        // tracks: the possible stays dim; the taken ones are brighter; the last taken glows
        const cur = stt.idx >= 0 ? m.moves[stt.idx] : null;
        for (const tr of m.trackByKey.values()) {
          let g = 0;
          if (cur && cur.track === tr) g = stt.travel ? 1 : Math.max(0, 1 - (s - cur.end) / GLOW);
          setTrack(tr, g, tr.firstTaken <= s);
        }
        // hopper kicks: the machine heard mail and nothing moved
        const hk = m.hopperKicks.length ? kickAt(m.hopperKicks, s) : -1;
        m.funnel.scale.setScalar(hk >= 0 ? 1 + 0.25 * Math.sin(Math.PI * hk) : 1);
      }
      for (const [id, st] of m.pads) st.lampMat.emissiveIntensity = id === lit ? 1.7 + 0.3 * Math.sin(s * 5) : 0;
      for (const [id, lm] of m.lamps) lm.emissiveIntensity = id === lit ? 2.2 : 0;
      if (m.kind === "machine") for (const c of m.children) if (c.wallMat) c.lit = c.padOf === lit;
    }
    // capsules
    let k = 0;
    for (let i = upperBound(capS, s) - 1; i >= 0 && k < capPool.length; i--) {
      const c = capsules[i]; const u = (s - c.s0) / 0.42; if (u > 1) { if (s - c.s0 > 3) break; continue; }
      let m = c.m; if (!m) continue;
      while (m.parent && !visibleChain(m)) m = m.parent; // closed parents swallow it
      const mesh = capPool[k++]; mesh.visible = true;
      const sc = m.scaleLocal * 1.5;
      const drop = Math.min(1, u / 0.7);
      mesh.position.copy(m.hopperLocal).add(new V3(0, (1 - drop * drop) * 1.8 * sc, 0));
      const shrink = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      mesh.scale.setScalar(Math.max(0.01, sc * shrink)); mesh.rotation.z = 0.3 + u;
    }
    for (; k < capPool.length; k++) capPool[k].visible = false;
    // gauges
    if (gauges.length) {
      const vals = sim.valuesAt ? sim.valuesAt(actorId, t) : {};
      for (const g of gauges) {
        const v = vals[g.id];
        let flash = 0, pulseU = -1;
        for (const ch of g.changes) { if (ch.s - 0.5 <= s && s < ch.s) pulseU = (s - (ch.s - 0.5)) / 0.5; if (ch.s <= s && s < ch.s + 0.8) flash = 1 - (s - ch.s) / 0.8; }
        if (g.kind === "tube") {
          const n = v == null ? 0 : Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : 1;
          const cnt = Math.min(18, n); g.balls.count = cnt; const o = new THREE.Object3D();
          for (let i = 0; i < cnt; i++) { o.position.set(((i % 2) - 0.5) * 0.09, 0.22 + i * 0.09, 0); o.updateMatrix(); g.balls.setMatrixAt(i, o.matrix); }
          g.balls.instanceMatrix.needsUpdate = true; g.ballMat.emissive.setRGB(flash, flash * 0.7, flash * 0.3);
        } else if (g.kind === "dial") {
          const num = typeof v === "number" ? v : 0;
          g.needleG.rotation.z = -((-120 + 240 * Math.min(1, num / g.max)) * Math.PI) / 180;
          if (g.last !== num) { drawDial(g, num); g.last = num; }
          g.faceMat.emissiveIntensity = 0.5 * flash;
        } else {
          const on = g.kind === "lever" ? v === true : v != null && v !== "" && v !== false;
          g.lampMat.emissiveIntensity = on ? 1.6 : 0.05 + flash;
          if (g.lever) g.lever.rotation.z = on ? -0.7 : 0.7;
        }
        for (const p of g.pipes) {
          p.mat.emissiveIntensity = 0.9 * flash;
          if (pulseU >= 0 && p.writer) { p.pulse.visible = true; p.pulse.position.copy(p.curve.getPointAt(1 - pulseU)); }
          else p.pulse.visible = false;
        }
      }
    }
  }
  function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
  function kickAt(list, s) { const i = upperBound(list, s) - 1; if (i < 0) return -1; const u = (s - list[i]) / 0.42; return u < 1 ? u : -1; }
  function setTrack(tr, glow, taken) {
    const f = taken ? 1 : 0.42;
    tr.mat.color.copy(tr.baseCol).multiplyScalar(f + 0.25 * glow);
    tr.mat.emissiveIntensity = 1.4 * glow;
  }

  // ---------- pick / focus ----------
  const ray = { hits: [] };
  function effectiveVisible(o) { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; }
  function pick(raycaster) {
    ray.hits.length = 0;
    group.updateMatrixWorld(true);
    const hits = raycaster.intersectObjects(pickables, false, ray.hits);
    for (const h of hits) {
      if (!effectiveVisible(h.object)) continue;
      const pk = h.object.userData.pick;
      if (pk.kind === "state" && machById.has(pk.id)) { const m = machById.get(pk.id); if (m.open > 0.5 && h.object !== m.walls) { /* plinth/lid: fine */ } if (m.open > 0.5 && (h.object === m.walls || h.object === m.lid)) continue; }
      return { kind: pk.kind, id: pk.id, object: h.object, point: h.point };
    }
    return null;
  }
  function focusObject(id) {
    if (!id) return group;
    const m = machById.get(id); if (m) return m.group;
    const st = stations.get(id); if (st) return st.group;
    return group;
  }
  function boundsOf(obj) {
    group.updateMatrixWorld(true);
    let b;
    if (obj === group) b = new THREE.Box3().setFromObject(root);
    else {
      const m = [...machById.values()].find((x) => x.group === obj);
      if (m && m.size) { // the housing's box, not the swung lid
        b = new THREE.Box3(new V3(-m.size.w / 2, -PLINTH, -m.size.d / 2), new V3(m.size.w / 2, (m.H || m.size.h), m.size.d / 2));
        if (m.kind === "bench") b = new THREE.Box3(new V3(-m.size.w / 2, -0.2, -m.size.d / 2), new V3(m.size.w / 2, m.size.h, m.size.d / 2));
        b.applyMatrix4(obj.matrixWorld);
      } else { // a station: the pad and the space above it
        b = new THREE.Box3(new V3(-0.6, 0, -0.6), new V3(0.6, 1.0, 0.6)).applyMatrix4(obj.matrixWorld);
      }
    }
    const sphere = b.getBoundingSphere(new THREE.Sphere());
    return { center: sphere.center, radius: sphere.radius, box: b, object: obj };
  }
  function focus(id) {
    focusId = id && (machById.has(id) || stations.has(id)) ? id : null;
    if (!focusId) { focusPath = null; focusLevel = maxLevel; return api.focusBounds; }
    const path = ownerMachines(focusId);
    focusPath = new Set(path);
    // also the machine that holds a station
    const st = stations.get(focusId); if (st && !machById.has(focusId)) { focusPath.add(st.m); for (let p = st.m.parent; p; p = p.parent) focusPath.add(p); }
    for (const m of [...focusPath]) for (let p = m.parent; p; p = p.parent) focusPath.add(p);
    focusLevel = Math.max(1, ...[...focusPath].filter((m) => m.kind !== "bench").map((m) => m.level));
    return api.focusBounds;
  }
  function setDetail(d) { detail = Math.min(1, Math.max(0, d)); }

  function dispose() {
    group.removeFromParent();
    for (const g of owned.geos) g.dispose();
    for (const m of owned.mats) m.dispose();
    for (const t of owned.texs) t.dispose();
    for (const im of owned.inst) im.dispose();
  }

  const api = {
    group, update, setDetail, pick, focus, dispose,
    get focusBounds() { return boundsOf(focusObject(focusId)); },
    get detail() { return detail; },
    get focusId() { return focusId; },
    levels: maxLevel,
    // for WORLD/tests: ids of every state that has a place in here, and the machine paths
    states: () => [...stations.keys(), ...[...machById.keys()].filter((k) => !stations.has(k))],
    pathTo: (id) => ownerMachines(id).map((m) => m.id),
    boundsOf: (id) => boundsOf(focusObject(id)),
    // playback-second schedule of a machine's marble: [{start, end, from, to, ev}] (sim.unwarp(start) gives virtual ms)
    movesOf: (id) => { const m = machById.get(id); return m && m.moves ? m.moves.map(({ start, end, from, to, ev }) => ({ start, end, from, to, ev })) : []; },
  };
  update(0, 0);
  return api;
}

function upperBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; }
