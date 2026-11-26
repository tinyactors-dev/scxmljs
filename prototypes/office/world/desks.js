// world/desks.js: a desk at every seat the plan made; the desk IS the datamodel of whoever sits
// there, by type: number = flip counter, boolean = lamp on a switch, string = a card in a holder,
// array = a letter tray with one sheet per item, object = pigeonholes with one card per key. Each
// object stands on the back edge facing the visitor, with an engraved plate on the desk's front edge
// naming the variable; when its value changes it hops once. Every desk also has what an office desk
// has, each a recognisable thing: a monitor whose lit screen faces the sitter and shows the state
// they are in, a keyboard, a telephone, a wire in-basket under the hatch where the tube ends, an egg
// timer (turned over while a delayed send is pending, ringing when it comes due), a desk lamp (lit
// while someone sits here) and a small red alarm lamp (lit in an exception). The hub's desk stands
// inside the exchange: an octagonal counter with a switchboard behind (a jack per partner, a cord
// while it talks to one). Positions come from world/layout.js (the seat frame), shared with the poses.
// Static furniture of each group is ONE mesh (BoxBatch); the moving parts are separate.
import * as THREE from "three";
import { box, block, cyl, mat, plate, canvasTex, BoxBatch, hash } from "./kit.js";
import { pickVariables } from "../core/desk.js";
import { DESK, SPOT, CHAIR, PARTITION, RISER_X } from "./layout.js";

const WOOD = "#a8743f", WOOD_D = "#7d5330", WOOD_L = "#c99a62", BRASS = "#c9a14a", STEEL = "#8d96a3", PAPER = "#f6f0de";
export const DESK_DZ = DESK.cz;

// the world point of a seat-frame point
export function seatPoint(seat, p) { const f = seat.facing || 0, c = Math.cos(f), s = Math.sin(f); return new THREE.Vector3(seat.x + p[0] * c + p[2] * s, p[1], seat.z - p[0] * s + p[2] * c); }
export const MOUTH = (seat) => seatPoint(seat, SPOT.hatch);

const counterTex = (digits = 4) => { const t = canvasTex(64 * digits, 112, () => {}); t.anisotropy = 8; return { tex: t, last: null, draw(n) { const s = n === null || n === undefined ? "".padStart(digits, " ") : String(Math.round(Number(n)) | 0).padStart(digits, "0").slice(-digits); if (s === this.last) return false; this.last = s; const g = t.userData.ctx, c = t.userData.canvas; g.fillStyle = "#1b1b1b"; g.fillRect(0, 0, c.width, c.height); for (let i = 0; i < digits; i++) { g.fillStyle = "#efe6d0"; g.fillRect(i * 64 + 5, 6, 54, 100); g.fillStyle = "#1b1b1b"; g.font = "bold 78px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(s[i], i * 64 + 32, 60); g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(i * 64 + 5, 55, 54, 3); } t.needsUpdate = true; return true; } }; };

// a value object, in the desk group's frame (seat frame), standing at (x, z) on the desk top
function varObject(parent, v, x, z) {
  const g = new THREE.Group(); g.position.set(x, DESK.topY, z); parent.add(g);
  const o = { g, type: v.type, id: v.id, hopAt: -9 };
  // the engraved plate on the desk's front edge, under the object, facing the visitor
  const label = plate(v.id, { w: 0.4, h: 0.052, bg: "#e9dcb4", font: "bold 64px 'DejaVu Sans Mono', monospace", border: "#8a6a22" });
  label.position.set(x, DESK.topY - DESK.thick / 2, DESK.z1 + 0.004); parent.add(label);
  let changed;
  if (v.type === "number") {
    const c = counterTex(4); block(g, 0.38, 0.16, 0.12, "#4a3b2b", 0, 0, 0); block(g, 0.4, 0.02, 0.14, "#2a2018", 0, 0.16, 0);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.13), new THREE.MeshLambertMaterial({ map: c.tex })); f.position.set(0, 0.08, 0.061); g.add(f);
    changed = (val) => c.draw(typeof val === "number" ? val : val == null ? null : Array.isArray(val) ? val.length : typeof val === "object" ? Object.keys(val).length : Number(val) || 0);
  } else if (v.type === "boolean") {
    block(g, 0.24, 0.05, 0.16, "#333", 0, 0, 0); const sw = box(0.03, 0.1, 0.03, "#ddd"); sw.position.set(0.06, 0.08, 0.02); g.add(sw);
    const m = new THREE.MeshLambertMaterial({ color: "#555", emissive: "#ffcf3a", emissiveIntensity: 0 }); const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), m); b.position.set(-0.05, 0.12, 0); g.add(b);
    const neck = cyl(0.025, 0.05, "#888", 8); neck.position.set(-0.05, 0.065, 0); g.add(neck);
    let last; changed = (val) => { const on = !!val; if (on === last) return false; last = on; m.emissiveIntensity = on ? 1.6 : 0; m.color.set(on ? "#fff2b0" : "#555"); sw.rotation.x = on ? -0.6 : 0.6; return true; };
  } else if (v.type === "string") {
    const t = canvasTex(320, 160, () => {}); t.anisotropy = 8; const card = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.18), new THREE.MeshLambertMaterial({ map: t })); card.position.set(0, 0.12, 0.0); card.rotation.x = -0.18; g.add(card);
    block(g, 0.3, 0.035, 0.08, WOOD_D, 0, 0, -0.01); const back = box(0.36, 0.18, 0.01, "#e8e0c8"); back.position.set(0, 0.12, -0.008); back.rotation.x = -0.18; g.add(back);
    let last; changed = (val) => { const s = val == null ? "" : typeof val === "string" ? val : JSON.stringify(val); if (s === last) return false; last = s; const c = t.userData.ctx; c.fillStyle = PAPER; c.fillRect(0, 0, 320, 160); c.strokeStyle = "#c8b890"; c.lineWidth = 4; c.strokeRect(2, 2, 316, 156); c.fillStyle = "#2b2418"; let fs = 44; c.font = `bold ${fs}px 'DejaVu Sans Mono', monospace`; const words = s.length > 30 ? s.slice(0, 29) + "…" : s; while (fs > 22 && c.measureText(words).width > 296 * 2) { fs -= 2; c.font = `bold ${fs}px 'DejaVu Sans Mono', monospace`; } const per = Math.max(1, Math.floor(296 / c.measureText("M").width)); const lines = [words.slice(0, per), words.slice(per, per * 2)].filter(Boolean); lines.forEach((l, i) => c.fillText(l, 12, 70 + i * (fs + 8) - (lines.length - 1) * (fs / 2))); t.needsUpdate = true; card.visible = s !== ""; return true; };
  } else if (v.type === "array") {
    // a wooden letter tray, open at the front: one sheet per item
    block(g, 0.4, 0.02, 0.3, WOOD_D, 0, 0, 0); for (const sx of [-1, 1]) block(g, 0.02, 0.09, 0.3, WOOD_D, sx * 0.19, 0, 0); block(g, 0.4, 0.09, 0.02, WOOD_D, 0, 0, -0.14);
    const sheets = []; for (let i = 0; i < 10; i++) { const s = box(0.3, 0.008, 0.24, i % 2 ? "#ffffff" : "#f3ecd8"); s.position.set((hash(i) - 0.5) * 0.03, 0.025 + i * 0.012, (hash(i + 5) - 0.5) * 0.03); s.rotation.y = (hash(i + 2) - 0.5) * 0.25; s.visible = false; g.add(s); sheets.push(s); }
    let last; changed = (val) => { const n = Array.isArray(val) ? val.length : val && typeof val === "object" ? Object.keys(val).length : 0; if (n === last) return false; last = n; sheets.forEach((s, i) => (s.visible = i < n)); return true; };
  } else {
    // pigeonholes, open toward the visitor: one card per key
    block(g, 0.42, 0.02, 0.2, WOOD_D, 0, 0, 0); block(g, 0.42, 0.02, 0.2, WOOD_D, 0, 0.15, 0); block(g, 0.42, 0.02, 0.2, WOOD_D, 0, 0.3, 0); for (let i = 0; i < 4; i++) block(g, 0.02, 0.32, 0.2, WOOD_D, -0.2 + i * 0.133, 0, 0); block(g, 0.42, 0.32, 0.02, WOOD_D, 0, 0, -0.1);
    const cards = []; for (let i = 0; i < 6; i++) { const k = box(0.1, 0.1, 0.03, ["#3fcf7c", "#4aa3ff", "#ffb84a", "#ff6b9a", "#b07cff", "#5fd6d6"][i]); k.position.set(-0.133 + (i % 3) * 0.133, 0.075 + Math.floor(i / 3) * 0.15, 0.03); k.rotation.x = -0.25; k.visible = false; g.add(k); cards.push(k); }
    let last; changed = (val) => { const n = val && typeof val === "object" ? (Array.isArray(val) ? val.length : Object.keys(val).length) : 0; if (n === last) return false; last = n; cards.forEach((k, i) => (k.visible = i < n)); return true; };
  }
  let primed = false;
  o.set = (val, amb) => { const c = changed(val); if (c && primed) o.hopAt = amb; primed = true; const k = amb - o.hopAt; g.position.y = DESK.topY + (k >= 0 && k < 0.45 ? Math.sin((k / 0.45) * Math.PI) * 0.05 : 0); };
  return o;
}

// the furniture of one desk: static boxes into `batch` (world coordinates), moving parts into `grp`
// (a group placed and turned like the seat, so its children use seat-frame coordinates)
export function deskFurniture(batch, grp, seat, opts = {}) {
  const P = (p) => seatPoint(seat, p); const ry = seat.facing || 0;
  const add = (w, h, d, color, p) => { const q = P(p); batch.add(w, h, d, color, q.x, q.y, q.z, ry, q.x, q.z); };
  const fab = opts.fabric || "#7d8a96";
  if (!opts.noPartitions) for (const sx of [1, -1]) { const x = sx * PARTITION.x + (sx > 0 && opts.machine ? 1.1 : 0); add(0.12, PARTITION.h, PARTITION.z1 - PARTITION.z0, "#7d8a96", [x, 0, (PARTITION.z0 + PARTITION.z1) / 2]); add(0.14, 0.06, PARTITION.z1 - PARTITION.z0 + 0.02, fab, [x, PARTITION.h, (PARTITION.z0 + PARTITION.z1) / 2]); }
  // desk: top, legs, modesty panel
  add(DESK.w, DESK.thick, DESK.d, WOOD_L, [0, DESK.topY - DESK.thick, DESK.cz]);
  for (const sx of [1, -1]) add(0.08, DESK.topY - DESK.thick, DESK.d - 0.1, WOOD, [sx * (DESK.w / 2 - 0.1), 0, DESK.cz]);
  add(2.0, 0.5, 0.05, WOOD, [0, 0.17, DESK.z1 - 0.05]);
  // keyboard: a dark base with pale keys (rows)
  const [kx, , kz] = SPOT.keyboard; add(0.5, 0.025, 0.17, "#2e2f36", [kx, DESK.topY, kz]); for (let r = 0; r < 4; r++) add(0.44, 0.012, 0.025, "#e6e2d8", [kx, DESK.topY + 0.025, kz - 0.06 + r * 0.04]);
  // monitor stand and the screen's housing (the lit screen itself is a moving part: it shows the state)
  const [mx, , mz] = SPOT.monitor; add(0.26, 0.02, 0.18, "#2b2b30", [mx, DESK.topY, mz + 0.04]); add(0.06, 0.3, 0.06, "#2b2b30", [mx, DESK.topY + 0.02, mz + 0.05]);
  // the in-basket (wire) under the hatch
  const [bx, , bz] = SPOT.basket; add(0.36, 0.015, 0.27, STEEL, [bx, DESK.topY, bz]); for (const sz of [-1, 1]) add(0.36, 0.09, 0.015, STEEL, [bx, DESK.topY, bz + sz * 0.13]); for (const sx of [-1, 1]) add(0.015, 0.09, 0.27, STEEL, [bx + sx * 0.175, DESK.topY, bz]);
  // the telephone's base (the handset is a moving part)
  const [px, , pz] = SPOT.phone; add(0.24, 0.07, 0.2, "#1d1d1d", [px, DESK.topY, pz]); add(0.1, 0.012, 0.1, "#d8d0bc", [px, DESK.topY + 0.07, pz + 0.04]);
  // the chair is a moving part: it slides aside when its sitter stands
  const chair = new THREE.Group(); grp.parent.add(chair);
  { const cm = opts.chairColor || "#3d4250"; const seatB = box(CHAIR.w, 0.07, CHAIR.d, cm); seatB.position.set(0, CHAIR.seatTop - 0.035, CHAIR.cz); chair.add(seatB); const back = box(CHAIR.w, CHAIR.backTop - CHAIR.seatTop - 0.05, 0.06, cm); back.position.set(0, (CHAIR.seatTop + CHAIR.backTop) / 2 + 0.03, CHAIR.backZ); chair.add(back); const post = box(0.07, CHAIR.seatTop - 0.07, 0.07, "#222"); post.position.set(0, (CHAIR.seatTop - 0.07) / 2, CHAIR.cz); chair.add(post); const foot = box(0.56, 0.04, 0.08, "#222"); foot.position.set(0, 0.02, CHAIR.cz); chair.add(foot); const foot2 = box(0.08, 0.04, 0.56, "#222"); foot2.position.set(0, 0.02, CHAIR.cz); chair.add(foot2); }
  const ch0 = P([CHAIR.aside[0], 0, CHAIR.aside[1]]); chair.position.copy(ch0); chair.rotation.y = ry + 0.5;
  const d = { chair };
  // the screen: faces the sitter, shows the active state's name
  const scr = canvasTex(256, 160, () => {}); scr.anisotropy = 8;
  const mon = new THREE.Group(); mon.position.set(mx, DESK.topY + 0.46, mz); mon.rotation.y = 0.32; grp.add(mon);
  const housing = box(0.6, 0.38, 0.05, "#2b2b30"); housing.position.z = 0.02; mon.add(housing);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.32), new THREE.MeshBasicMaterial({ map: scr, toneMapped: false })); screen.position.z = -0.006; screen.rotation.y = Math.PI; mon.add(screen);
  let lastScr = null; d.screen = (text, on) => { const k = on ? text : ""; if (k === lastScr) return; lastScr = k; const g = scr.userData.ctx; g.fillStyle = on ? "#173a4e" : "#111418"; g.fillRect(0, 0, 256, 160); if (on) { g.fillStyle = "#8fe3ff"; g.fillRect(14, 16, 60, 8); g.fillStyle = "#e6fbff"; let fs = 34; g.font = `bold ${fs}px 'DejaVu Sans Mono', monospace`; while (fs > 14 && g.measureText(text).width > 228) { fs -= 2; g.font = `bold ${fs}px 'DejaVu Sans Mono', monospace`; } g.textBaseline = "middle"; g.fillText(text, 14, 84); g.fillStyle = "#4f8fa8"; g.fillRect(14, 120, 140, 6); g.fillRect(14, 132, 90, 6); } scr.needsUpdate = true; };
  d.screen("", false);
  // the hatch: where the tube ends, a brass funnel over the in-basket with a flap
  const [hx, hy, hz] = SPOT.hatch; const hatch = new THREE.Group(); hatch.position.set(hx, hy, hz); grp.add(hatch);
  // the tube's end: a short brass sleeve with a hinged flap underneath, on a bracket from the desk
  { const sleeve = cyl(0.095, 0.14, "#7d8794", 14); hatch.add(sleeve); const ring = cyl(0.105, 0.03, "#c9a14a", 14); ring.position.y = 0.07; hatch.add(ring); const mouth = cyl(0.08, 0.005, "#1b1d22", 14); mouth.position.y = -0.071; hatch.add(mouth); }
  { const post = box(0.03, hy - DESK.topY - 0.06, 0.03, "#6b5a3a"); post.position.set(0.14, -(hy - DESK.topY) / 2 - 0.03, 0); hatch.add(post); const arm = box(0.06, 0.025, 0.025, "#6b5a3a"); arm.position.set(0.11, 0, 0); hatch.add(arm); }
  const flap = new THREE.Group(); flap.position.set(0, -0.075, -0.1); hatch.add(flap); { const f = box(0.2, 0.01, 0.2, "#a5803a"); f.position.z = 0.1; flap.add(f); }
  d.flap = flap;
  // the handset
  d.receiver = block(grp, 0.28, 0.05, 0.07, "#1d1d1d", px, DESK.topY + 0.085, pz - 0.03);
  // the desk lamp: lit while someone sits here
  const [lx, , lz] = SPOT.lamp; const lampG = new THREE.Group(); lampG.position.set(lx, DESK.topY, lz); grp.add(lampG);
  block(lampG, 0.18, 0.03, 0.18, "#2d4a3a", 0, 0, 0); const arm = box(0.03, 0.4, 0.03, "#2d4a3a"); arm.position.set(0, 0.2, 0); lampG.add(arm);
  d.shadeM = new THREE.MeshLambertMaterial({ color: "#3f7a5a", emissive: "#ffd66b", emissiveIntensity: 0, side: THREE.DoubleSide });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.13, 14, 1, true), d.shadeM); shade.position.set(0.05, 0.42, -0.02); shade.rotation.z = -0.5; lampG.add(shade);
  d.bulbM = new THREE.MeshBasicMaterial({ color: "#5a5040" }); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), d.bulbM); bulb.position.set(0.06, 0.38, -0.02); lampG.add(bulb);
  // the egg timer (an hourglass): turned over and running while a delayed send is pending
  const [tx, , tz] = SPOT.timer; const tim = new THREE.Group(); tim.position.set(tx, DESK.topY, tz); grp.add(tim);
  const glass = new THREE.Group(); glass.position.y = 0.11; tim.add(glass);
  { const capM = mat("#7d5330"); for (const y of [-0.1, 0.1]) { const c = cyl(0.065, 0.02, null, 12, { material: capM }); c.position.y = y; glass.add(c); } for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const r = box(0.012, 0.2, 0.012, "#7d5330"); r.position.set(sx * 0.05, 0, sz * 0.05); glass.add(r); }
    const gm = new THREE.MeshLambertMaterial({ color: "#d9f2ff", transparent: true, opacity: 0.45, depthWrite: false }); const top = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, 12), gm); top.position.y = 0.045; top.rotation.x = Math.PI; glass.add(top); const bot = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, 12), gm); bot.position.y = -0.045; glass.add(bot); }
  const sandTop = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.06, 10), mat("#e2b85a")); sandTop.rotation.x = Math.PI; glass.add(sandTop); const sandBot = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.06, 10), mat("#e2b85a")); glass.add(sandBot);
  d.timer = tim; d.timerParts = { glass, sandTop, sandBot };
  // the alarm lamp: a small red dome, lit in an exception
  d.alarmM = new THREE.MeshLambertMaterial({ color: "#5a2020", emissive: "#ff2a1a", emissiveIntensity: 0 });
  const alarm = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), d.alarmM); alarm.position.set(-0.55, DESK.topY + 0.03, 1.28); grp.add(alarm); block(grp, 0.14, 0.03, 0.14, "#333", -0.55, DESK.topY, 1.28);
  d.alarmLight = new THREE.PointLight("#ff3a2a", 0, 2.2, 1.6); d.alarmLight.position.set(-0.55, DESK.topY + 0.25, 1.1); grp.add(d.alarmLight);
  return d;
}

export function buildDesks(scene, sim, plan, cfg = {}) {
  const root = new THREE.Group(); scene.add(root);
  const desks = new Map(); // seat key -> desk
  const varsOf = new Map();
  const chartVars = (chart) => { if (!varsOf.has(chart)) varsOf.set(chart, pickVariables(sim, chart, { max: 4, prefer: cfg.desk?.[chart] })); return varsOf.get(chart); };
  const keyOf = (s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`;
  const colliders = []; // world AABBs the camera keeps out of: [min, max] Vector3s
  for (const g of plan.groups) {
    const batch = new BoxBatch();
    const vars = chartVars(g.chart);
    for (let k = 0; k < g.slots; k++) {
      const s = plan.seats.get(`${g.id}#${k}`); if (!s) continue;
      const d = { seat: s, key: keyOf(s), chart: g.chart, hub: !!s.hub, spots: [] };
      const grp = new THREE.Group(); grp.position.set(s.x, 0, s.z); grp.rotation.y = s.facing || 0; root.add(grp); d.group = grp;
      Object.assign(d, deskFurniture(batch, grp, s, { machine: !!s.machineX, fabric: g.color, noPartitions: !!s.hub, chairColor: s.hub ? "#7b2f2a" : undefined }));
      if (s.hub) buildExchange(batch, d, grp);
      SPOT.vars.slice(0, vars.length).forEach(([x, z], i) => d.spots.push(varObject(grp, vars[i], x, z)));
      d.mouth = MOUTH(s); d.basket = seatPoint(s, [SPOT.basket[0], SPOT.basket[1] + 0.06, SPOT.basket[2]]);
      // colliders: the desk block and the partitions
      colliders.push(aabb(s, [-DESK.w / 2, 0, DESK.z0], [DESK.w / 2, 1.45, DESK.z1]));
      colliders.push(aabb(s, [RISER_X - 0.12, 0.7, SPOT.hatch[2] - 0.12], [RISER_X + 0.12, 3.4, SPOT.hatch[2] + 0.12])); // the tube's riser
      if (!s.hub) for (const sx of [1, -1]) { const x = sx * PARTITION.x + (sx > 0 && s.machineX ? 1.1 : 0); colliders.push(aabb(s, [x - 0.08, 0, PARTITION.z0], [x + 0.08, PARTITION.h + 0.05, PARTITION.z1])); }
      desks.set(d.key, d);
    }
    root.add(batch.mesh());
  }
  // visitor stools (invoked children sit across their parent's desk)
  const stools = new BoxBatch(); const done = new Set();
  for (const a of sim.actors) if (!a.external && plan.invokedBy.has(a.id) && plan.groupOf(a.id)?.startsWith("side:")) sim.lifetimes(a.id).forEach((_, i) => { const s = plan.seatOfLife(a.id, i); if (!s) return; const k = keyOf(s); if (done.has(k)) return; done.add(k); stools.add(0.42, CHAIR.seatTop - 0.05, 0.42, "#6b4a2b", s.x, 0, s.z).add(0.46, 0.05, 0.46, "#8a6a3a", s.x, CHAIR.seatTop - 0.05, s.z); });
  if (done.size) root.add(stools.mesh());

  function aabb(s, lo, hi) { const a = seatPoint(s, lo), b = seatPoint(s, hi); return [new THREE.Vector3(Math.min(a.x, b.x), lo[1], Math.min(a.z, b.z)), new THREE.Vector3(Math.max(a.x, b.x), hi[1], Math.max(a.z, b.z))]; }

  function buildExchange(batch, d, grp) {
    const s = d.seat; const cx = s.x, cz = s.z + 0.2;
    for (let i = 0; i < 8; i++) { if (i === 4) continue; const a = (i / 8) * Math.PI * 2; const x = cx + Math.sin(a) * 2.5, z = cz + Math.cos(a) * 2.5; batch.add(1.9, 0.72, 0.45, WOOD, x, 0, z, a, x, z).add(2.0, 0.07, 0.6, WOOD_L, x, 0.72, z, a, x, z).add(1.8, 0.08, 0.05, BRASS, x + Math.sin(a) * 0.24, 0.6, z + Math.cos(a) * 0.24, a, x + Math.sin(a) * 0.24, z + Math.cos(a) * 0.24); }
    batch.add(2.9, 2.1, 0.35, "#5a3b22", cx, 0, cz - 1.75).add(3.0, 0.12, 0.45, WOOD_D, cx, 2.1, cz - 1.75);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(3.4, 8), mat("#8c3b34")); rug.rotation.x = -Math.PI / 2; rug.rotation.z = Math.PI / 8; rug.position.set(cx, 0.012, cz); rug.receiveShadow = true; grp.parent.add(rug);
    // the switchboard behind: a jack per partner (the ones it talks to most), a cord while it talks to one
    const partners = plan.partners(plan.hub).sort((a, b) => plan.weight(plan.hub, b) - plan.weight(plan.hub, a)).slice(0, 6);
    d.jacks = new Map(); const z0 = cz - 1.56; const plugBase = new THREE.Vector3(cx, 0.95, z0 + 0.2); const par = grp.parent;
    partners.forEach((p, i) => { const x = cx - 1.15 + i * (2.3 / Math.max(1, partners.length - 1 || 1)); const a = sim.actor(p); const hole = cyl(0.06, 0.04, "#111"); hole.rotation.x = Math.PI / 2; hole.position.set(x, 1.15, z0); par.add(hole); const lm = new THREE.MeshLambertMaterial({ color: "#555", emissive: "#ffd36b", emissiveIntensity: 0 }); const lb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), lm); lb.position.set(x, 1.45, z0); par.add(lb); const pl = plate(String(cfg.names?.[p] || a?.label || p).replace(/^the /i, "").toUpperCase().slice(0, 14), { w: 0.44, h: 0.1, bg: "#e9dcb4" }); pl.position.set(x, 1.66, z0 + 0.005); par.add(pl);
      const jp = new THREE.Vector3(x, 1.15, z0 + 0.03); const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(plugBase, new THREE.Vector3((x + cx) / 2, 0.55, z0 + 0.4), jp), 16, 0.022, 6), mat("#2fa865")); cord.visible = false; par.add(cord); d.jacks.set(p, { lm, cord }); });
    const plateE = plate("EXCHANGE", { w: 1.1, h: 0.16 }); plateE.position.set(cx, 0.6, cz + 2.5 + 0.235); par.add(plateE);
    colliders.push([new THREE.Vector3(cx - 1.5, 0, z0 - 0.25), new THREE.Vector3(cx + 1.5, 2.25, z0 + 0.1)]);
  }

  function update(s, t, amb, occupantOf, ctx) {
    for (const d of desks.values()) {
      const occ = occupantOf(d.key, s);
      const here = occ && occ.present;
      const id = here ? occ.id : null;
      const v = id ? sim.valuesAt(id, t) : null;
      for (const sp of d.spots) sp.set(v ? v[sp.id] : null, amb);
      const lit = here && !ctx.dark;
      d.shadeM.emissiveIntensity = lit ? 0.6 : 0; d.bulbM.color.set(lit ? "#fff3c0" : "#5a5040");
      const sit = id ? ctx.situation(id) : null;
      const leaf = id ? (sim.activeAt(id, t) || []).slice(-1)[0] : null;
      d.screen(leaf ? String(leaf).split(/[.#/]/).pop() : "", !!id && !ctx.dark);
      d.receiver.visible = !(sit && sit.kind === "waiting" && sit.detail?.with && sim.actor(sit.detail.with)?.external);
      const exc = !!(sit && sit.kind === "exception");
      d.alarmM.emissiveIntensity = exc ? 1.2 + 0.6 * Math.sin(amb * 6) : 0; d.alarmM.color.set(exc ? "#ff5a4a" : "#5a2020"); d.alarmLight.intensity = exc ? 1.6 + 0.6 * Math.sin(amb * 6) : 0;
      // the hourglass: turned over while pending, sand running down; shaking when it rings
      const r = id && ctx.timerRing(id); const set = id && ctx.timerSet(id); const tp = d.timerParts;
      tp.glass.rotation.z = r ? Math.sin(amb * 50) * 0.15 : 0; d.timer.position.y = DESK.topY + (r ? Math.abs(Math.sin(amb * 25)) * 0.03 : 0);
      const run = set ? (amb * 0.25) % 1 : 1; tp.sandTop.scale.setScalar(Math.max(0.05, 1 - run)); tp.sandTop.position.y = 0.035; tp.sandBot.scale.setScalar(Math.max(0.05, run)); tp.sandBot.position.y = -0.065 + 0.03 * run;
      // the flap opens as mail drops into the basket
      const drop = ctx.dropping ? ctx.dropping(d.key) : 0; d.flap.rotation.x = -drop * 1.1;
      if (d.jacks) for (const [p, j] of d.jacks) { const on = !!(sit && sit.detail?.with === p) || ctx.talking(plan.hub, p); j.cord.visible = on; j.lm.emissiveIntensity = on ? 1.4 : 0; j.lm.color.set(on ? "#fff2b0" : "#555"); }
    }
  }
  return { root, desks, update, keyOf, chartVars, colliders };
}
