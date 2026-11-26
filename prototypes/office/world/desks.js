// world/desks.js: a desk at every seat the plan made; the desk IS the datamodel of whoever sits
// there, by type: number = flip counter, boolean = lamp on a switch, string = a card with the text,
// array = a tray with one sheet per item, object = pigeonholes with one card per key. Each object
// has a tiny engraved plate with the variable's name. The hub's desk is the exchange: an octagonal
// counter with a switchboard whose jacks are its partners (a cord is plugged while it talks to one).
// Static furniture of each group is ONE mesh (BoxBatch); only the moving parts are separate.
import * as THREE from "three";
import { box, block, cyl, mat, plate, canvasTex, BoxBatch, hash } from "./kit.js";
import { pickVariables, typeOf } from "../core/desk.js";
import { DESK_W } from "../core/plan.js";

const WOOD = "#a8743f", WOOD_D = "#7d5330", WOOD_L = "#c99a62", BRASS = "#c9a14a", STEEL = "#8d96a3", PAPER = "#f6f0de";
export const DESK_DZ = 0.95;     // desk centre, south of the seat
export const MOUTH = (seat) => new THREE.Vector3(seat.x - 1.18, 1.36, seat.z + 0.42);

const counterTex = (digits = 4) => { const t = canvasTex(48 * digits, 80, () => {}); return { tex: t, last: null, draw(n) { const s = n === null || n === undefined ? "".padStart(digits, " ") : String(Math.round(Number(n)) | 0).padStart(digits, "0").slice(-digits); if (s === this.last) return; this.last = s; const g = t.userData.ctx, c = t.userData.canvas; g.fillStyle = "#1b1b1b"; g.fillRect(0, 0, c.width, c.height); for (let i = 0; i < digits; i++) { g.fillStyle = "#efe6d0"; g.fillRect(i * 48 + 4, 5, 40, 70); g.fillStyle = "#1b1b1b"; g.fillRect(i * 48 + 4, 39, 40, 2); g.font = "bold 54px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(s[i], i * 48 + 24, 43); } t.needsUpdate = true; } }; };

function varObject(parent, v, x, z, front) {
  const g = new THREE.Group(); g.position.set(x, 0.8, z); parent.add(g);
  const label = plate(v.id, { w: 0.38, h: 0.075, bg: "#e9dcb4", font: "bold 36px 'DejaVu Sans Mono', monospace" }); label.position.set(0, -0.08, front - z + 0.006); g.add(label);
  const o = { g, type: v.type, id: v.id };
  if (v.type === "number") {
    const c = counterTex(4); block(g, 0.4, 0.15, 0.12, "#4a3b2b", 0, 0, 0); const f = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.11), new THREE.MeshLambertMaterial({ map: c.tex })); f.position.set(0, 0.075, 0.061); g.add(f);
    o.set = (val) => c.draw(typeof val === "number" ? val : val == null ? null : Array.isArray(val) ? val.length : typeof val === "object" ? Object.keys(val).length : Number(val) || 0);
  } else if (v.type === "boolean") {
    block(g, 0.22, 0.05, 0.16, "#333", 0, 0, 0); const sw = box(0.04, 0.12, 0.04, "#ddd"); sw.position.set(0.05, 0.08, 0); g.add(sw);
    const m = new THREE.MeshLambertMaterial({ color: "#555", emissive: "#ffcf3a", emissiveIntensity: 0 }); const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), m); b.position.set(-0.05, 0.11, 0); g.add(b);
    let last; o.set = (val) => { const on = !!val; if (on === last) return; last = on; m.emissiveIntensity = on ? 1.5 : 0; m.color.set(on ? "#fff2b0" : "#555"); sw.rotation.z = on ? -0.5 : 0.5; };
  } else if (v.type === "string") {
    const t = canvasTex(256, 128, () => {}); const card = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.19), new THREE.MeshLambertMaterial({ map: t })); card.position.set(0, 0.12, 0); card.rotation.x = -0.35; g.add(card); block(g, 0.3, 0.03, 0.08, WOOD_D, 0, 0, -0.03);
    let last; o.set = (val) => { const s = val == null ? "" : String(val); if (s === last) return; last = s; const c = t.userData.ctx; c.fillStyle = PAPER; c.fillRect(0, 0, 256, 128); c.fillStyle = "#2b2418"; c.font = "bold 30px 'DejaVu Sans Mono', monospace"; const lines = [s.slice(0, 13), s.slice(13, 26), s.length > 39 ? s.slice(26, 38) + "…" : s.slice(26, 39)]; lines.forEach((l, i) => c.fillText(l, 10, 38 + i * 36)); t.needsUpdate = true; card.visible = s !== ""; };
  } else if (v.type === "array") {
    block(g, 0.4, 0.02, 0.36, STEEL, 0, 0, 0); for (const sx of [-1, 1]) block(g, 0.02, 0.1, 0.36, STEEL, sx * 0.2, 0, 0); block(g, 0.4, 0.1, 0.02, STEEL, 0, 0, -0.18);
    const sheets = []; for (let i = 0; i < 12; i++) { const s = box(0.3, 0.022, 0.3, i % 2 ? "#fff3b0" : "#fde58a"); s.position.set((hash(i) - 0.5) * 0.04, 0.03 + i * 0.026, (hash(i + 5) - 0.5) * 0.04); s.rotation.y = (hash(i + 2) - 0.5) * 0.3; s.visible = false; g.add(s); sheets.push(s); }
    let last; o.set = (val) => { const n = Array.isArray(val) ? val.length : val && typeof val === "object" ? Object.keys(val).length : 0; if (n === last) return; last = n; sheets.forEach((s, i) => (s.visible = i < n)); };
  } else {
    block(g, 0.42, 0.02, 0.2, WOOD_D, 0, 0, 0); block(g, 0.42, 0.02, 0.2, WOOD_D, 0, 0.17, 0); block(g, 0.42, 0.02, 0.2, WOOD_D, 0, 0.34, 0); for (let i = 0; i < 4; i++) block(g, 0.02, 0.36, 0.2, WOOD_D, -0.2 + i * 0.133, 0, 0); block(g, 0.42, 0.36, 0.02, WOOD_D, 0, 0, -0.1);
    const cards = []; for (let i = 0; i < 6; i++) { const k = box(0.09, 0.13, 0.12, ["#3fcf7c", "#4aa3ff", "#ffb84a", "#ff6b9a", "#b07cff", "#5fd6d6"][i]); k.position.set(-0.133 + (i % 3) * 0.133, 0.085 + Math.floor(i / 3) * 0.17, 0.02); k.visible = false; g.add(k); cards.push(k); }
    let last; o.set = (val) => { const n = val && typeof val === "object" ? (Array.isArray(val) ? val.length : Object.keys(val).length) : 0; if (n === last) return; last = n; cards.forEach((k, i) => (k.visible = i < n)); };
  }
  return o;
}

export function buildDesks(scene, sim, plan, cfg = {}) {
  const root = new THREE.Group(); scene.add(root);
  const desks = new Map(); // seat key -> desk
  const varsOf = new Map();
  const chartVars = (chart) => { if (!varsOf.has(chart)) varsOf.set(chart, pickVariables(sim, chart, { max: 4, prefer: cfg.desk?.[chart] })); return varsOf.get(chart); };
  const keyOf = (s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`;
  for (const g of plan.groups) {
    const batch = new BoxBatch();
    const vars = chartVars(g.chart);
    for (let k = 0; k < g.slots; k++) {
      const s = plan.seats.get(`${g.id}#${k}`); if (!s) continue;
      const d = { seat: s, key: keyOf(s), chart: g.chart, hub: !!s.hub, spots: [] };
      if (s.hub) buildExchange(root, batch, d, plan, vars);
      else buildDesk(root, batch, d, vars, g);
      desks.set(d.key, d);
    }
    root.add(batch.mesh());
  }
  // visitor stools (invoked children sit across their parent's desk)
  const stools = new BoxBatch(); const done = new Set();
  for (const a of sim.actors) if (!a.external && plan.invokedBy.has(a.id) && plan.groupOf(a.id)?.startsWith("side:")) sim.lifetimes(a.id).forEach((_, i) => { const s = plan.seatOfLife(a.id, i); if (!s) return; const k = keyOf(s); if (done.has(k)) return; done.add(k); stools.add(0.42, 0.46, 0.42, "#6b4a2b", s.x, 0, s.z).add(0.06, 0.06, 0.06, "#3a2a1a", s.x, 0.46, s.z); });
  if (done.size) root.add(stools.mesh());

  function buildDesk(root, batch, d, vars, g) {
    const s = d.seat, dz = s.z + DESK_DZ;
    const fab = g.color || "#7d8a96";
    batch.add(0.12, 1.12, 2.4, "#7d8a96", s.x - 1.55, 0, s.z + 0.2).add(0.12, 1.12, 2.4, "#7d8a96", s.x + 1.55 + (s.machineX ? 1.1 : 0), 0, s.z + 0.2);
    batch.add(0.14, 0.06, 2.42, fab, s.x - 1.55, 1.12, s.z + 0.2).add(0.14, 0.06, 2.42, fab, s.x + 1.55 + (s.machineX ? 1.1 : 0), 1.12, s.z + 0.2);
    batch.add(2.2, 0.08, 0.95, WOOD_L, s.x, 0.72, dz).add(0.08, 0.72, 0.85, WOOD, s.x - 1.0, 0, dz).add(0.08, 0.72, 0.85, WOOD, s.x + 1.0, 0, dz).add(2.0, 0.55, 0.05, WOOD, s.x, 0.17, dz + 0.42);
    // chair, typewriter, phone base
    batch.add(0.62, 0.08, 0.6, "#3d4250", s.x, 0.44, s.z - 0.05).add(0.62, 0.7, 0.08, "#3d4250", s.x, 0.48, s.z - 0.38).add(0.08, 0.44, 0.08, "#222", s.x, 0, s.z - 0.05).add(0.6, 0.04, 0.08, "#222", s.x, 0, s.z - 0.05);
    batch.add(0.6, 0.06, 0.26, "#3b3b40", s.x, 0.8, dz - 0.25).add(0.56, 0.02, 0.2, "#d8d4cc", s.x, 0.86, dz - 0.26);
    batch.add(0.26, 0.08, 0.2, "#1d1d1d", s.x + 0.88, 0.8, dz - 0.2);
    // the tube mouth's wire basket
    const M = MOUTH(s); batch.add(0.5, 0.025, 0.28, STEEL, M.x, M.y - 0.46, M.z).add(0.5, 0.1, 0.02, STEEL, M.x, M.y - 0.46, M.z + 0.13).add(0.5, 0.1, 0.02, STEEL, M.x, M.y - 0.46, M.z - 0.13);
    const grp = new THREE.Group(); root.add(grp); d.group = grp;
    d.receiver = block(grp, 0.3, 0.05, 0.08, "#1d1d1d", s.x + 0.88, 0.89, dz - 0.2);
    // desk lamp: lit while someone sits here
    const lampG = new THREE.Group(); lampG.position.set(s.x - 0.78, 0.8, dz + 0.28); grp.add(lampG); block(lampG, 0.2, 0.04, 0.2, "#2d4a3a", 0, 0, 0); block(lampG, 0.04, 0.45, 0.04, "#2d4a3a", 0, 0.03, 0);
    d.shadeM = new THREE.MeshLambertMaterial({ color: "#3f7a5a", emissive: "#ffd66b", emissiveIntensity: 0 }); const shade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.2), d.shadeM); shade.position.set(0.08, 0.5, -0.04); shade.rotation.z = -0.4; lampG.add(shade);
    // desk timer (an egg timer): rings when a delayed send comes due for the occupant
    const tim = new THREE.Group(); tim.position.set(s.x - 0.92, 0.8, dz - 0.1); grp.add(tim); const tb = cyl(0.07, 0.05, "#c43b2e", 10); tim.add(tb); const tt = cyl(0.05, 0.12, "#f2f2f2", 10); tt.position.y = 0.08; tim.add(tt); const tk = box(0.03, 0.04, 0.03, "#222"); tk.position.y = 0.16; tim.add(tk); d.timer = tim;
    // the variables, along the front of the desk
    const xs = [-0.42, 0.02, 0.46, 0.9].slice(0, Math.max(0, vars.length)); const front = dz + 0.47;
    vars.forEach((v, i) => d.spots.push(varObject(grp, v, s.x + (vars.length > 3 ? [-0.5, -0.06, 0.38, 0.82][i] : [-0.3, 0.2, 0.7][i]), dz + 0.2, front)));
    if (vars.length > 3) d.receiver.position.z -= 0.0;
    d.mouth = M;
  }

  function buildExchange(root, batch, d, plan, vars) {
    const s = d.seat; const cx = s.x, cz = s.z + 0.2;
    for (let i = 0; i < 8; i++) { if (i === 4) continue; const a = (i / 8) * Math.PI * 2; const x = cx + Math.sin(a) * 1.9, z = cz + Math.cos(a) * 1.9; batch.add(1.5, 0.72, 0.45, WOOD, x, 0, z, a, x, z).add(1.6, 0.07, 0.6, WOOD_L, x, 0.72, z, a, x, z).add(1.4, 0.08, 0.05, BRASS, x + Math.sin(a) * 0.24, 0.6, z + Math.cos(a) * 0.24, a, x + Math.sin(a) * 0.24, z + Math.cos(a) * 0.24); }
    batch.add(0.62, 0.08, 0.6, "#7b2f2a", s.x, 0.44, s.z).add(0.62, 0.7, 0.08, "#7b2f2a", s.x, 0.48, s.z - 0.33).add(0.08, 0.44, 0.08, "#222", s.x, 0, s.z);
    batch.add(1.6, 0.06, 0.7, WOOD_L, cx, 0.74, cz + 0.95);
    batch.add(2.9, 2.1, 0.35, "#5a3b22", cx, 0, cz - 1.55).add(3.0, 0.12, 0.45, WOOD_D, cx, 2.1, cz - 1.55);
    const grp = new THREE.Group(); root.add(grp); d.group = grp;
    const rug = new THREE.Mesh(new THREE.CircleGeometry(3.4, 8), mat("#8c3b34")); rug.rotation.x = -Math.PI / 2; rug.rotation.z = Math.PI / 8; rug.position.set(cx, 0.012, cz); rug.receiveShadow = true; grp.add(rug);
    // the switchboard: a jack per partner (the ones it talks to most), a cord while it talks to one
    const partners = plan.partners(plan.hub).sort((a, b) => plan.weight(plan.hub, b) - plan.weight(plan.hub, a)).slice(0, 6);
    d.jacks = new Map(); const plugBase = new THREE.Vector3(cx, 0.95, cz - 1.35);
    partners.forEach((p, i) => { const x = cx - 1.15 + i * (2.3 / Math.max(1, partners.length - 1 || 1)); const a = sim.actor(p); const hole = cyl(0.06, 0.04, "#111"); hole.rotation.x = Math.PI / 2; hole.position.set(x, 1.15, cz - 1.36); grp.add(hole); const lm = new THREE.MeshLambertMaterial({ color: "#555", emissive: "#ffd36b", emissiveIntensity: 0 }); const lb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), lm); lb.position.set(x, 1.45, cz - 1.36); grp.add(lb); const pl = plate(String(cfg.names?.[p] || a?.label || p).replace(/^the /i, "").toUpperCase().slice(0, 14), { w: 0.44, h: 0.1, bg: "#e9dcb4" }); pl.position.set(x, 1.66, cz - 1.365); grp.add(pl);
      const jp = new THREE.Vector3(x, 1.15, cz - 1.33); const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(plugBase, new THREE.Vector3((x + cx) / 2, 0.55, cz - 1.0), jp), 16, 0.022, 6), mat("#2fa865")); cord.visible = false; grp.add(cord); d.jacks.set(p, { lm, cord }); });
    block(grp, 0.5, 0.18, 0.12, "#333", cx, 0.86, cz - 1.35);
    d.receiver = block(grp, 0.34, 0.06, 0.08, "#1d1d1d", cx + 0.5, 0.86, cz + 0.9);
    batch.add(0.3, 0.1, 0.22, "#1d1d1d", cx + 0.5, 0.78, cz + 0.9);
    const plateE = plate("EXCHANGE", { w: 1.1, h: 0.16 }); plateE.position.set(cx, 0.6, cz + 2.16); grp.add(plateE);
    d.shadeM = null; d.timer = null;
    vars.forEach((v, i) => d.spots.push(varObject(grp, v, cx - 0.78 + i * 0.52, cz + 1.88, cz + 2.16)));
    d.mouth = new THREE.Vector3(cx - 1.05, 1.35, cz - 0.55);
    batch.add(0.5, 0.025, 0.28, STEEL, d.mouth.x, d.mouth.y - 0.46, d.mouth.z);
  }

  function update(s, t, amb, occupantOf, ctx) {
    for (const d of desks.values()) {
      const occ = occupantOf(d.key, s);
      const here = occ && occ.present;
      const id = here ? occ.id : null;
      const v = id ? sim.valuesAt(id, t) : null;
      for (const sp of d.spots) sp.set(v ? v[sp.id] : null);
      if (d.shadeM) d.shadeM.emissiveIntensity = here && !ctx.dark ? 1.2 : 0;
      const sit = id ? ctx.situation(id) : null;
      d.receiver.visible = !(sit && sit.kind === "waiting" && sit.detail?.with && sim.actor(sit.detail.with)?.external);
      if (d.timer) { const r = id && ctx.timerRing(id); const set = id && ctx.timerSet(id); d.timer.rotation.z = r ? Math.sin(amb * 50) * 0.3 : 0; d.timer.rotation.y = set ? -amb * 1.5 : 0; d.timer.scale.setScalar(set || r ? 1.5 : 1); d.timer.position.y = 0.8 + (r ? Math.abs(Math.sin(amb * 25)) * 0.04 : 0); }
      if (d.jacks) for (const [p, j] of d.jacks) { const on = !!(sit && sit.detail?.with === p) || ctx.talking(plan.hub, p); j.cord.visible = on; j.lm.emissiveIntensity = on ? 1.4 : 0; j.lm.color.set(on ? "#fff2b0" : "#555"); }
    }
  }
  return { root, desks, update, keyOf, chartVars };
}
