// world/models.js: each person's marble machines, also standing as a live tabletop model on their desk.
// The model IS the head (head/head.js createHead with {desk: true}): the same machines, marbles and motion,
// refreshed in place as a live run grows, never a second implementation. It stands on a dark board on the back
// half of the desk (the visitor's side), where the monitor, the desk lamp and the extra value objects stood
// (world/desks.js: they gave way), facing the visitor.
//
//   size     the model is scaled to fit the desk's MODEL zone (world/layout.js);
//   levels   the deepest level of machines that opens is the deepest whose state names are still legible
//            from where a visitor stands at the desk (a font of at least FONT_MIN metres); deeper machines stay
//            closed and their window says what runs in them. A big parallel chart shows its regions closed, each
//            with its current state; any other big chart its top machine open; the walk-in head carries the detail;
//   LOD      models are built only for people near the camera and in front of it, or selected: at most MAX at
//            once, one new model a frame; one out of view is hidden (its update skipped), one far away is
//            disposed (at most KEEP kept).
//
// Owns: the desk models' life and placement. Must never know: a system, a chart, the modes.
import * as THREE from "three";
import { seatPoint } from "./desks.js";
import { DESK, MODEL } from "./layout.js";

const FONT_MIN = 0.028;  // metres: the smallest state-name font a desk model may have (about 10 px from 2.6 m at 720 px)
const NEAR = 11, FAR = 22; // metres from the camera: build within NEAR (and in view), dispose beyond FAR
const MAX = 6, KEEP = 12;  // shown at once; kept (built) at most (a model is 40 to 90 draw calls)
const BASE_H = 0.03;     // the board the model stands on

export function createModels({ scene, sim, createHead }) {
  const root = new THREE.Group(); root.name = "desk-models"; scene.add(root);
  const models = new Map(); // actor id -> {id, head, holder, base, levels, scale, seen}
  const fr = new THREE.Frustum(), pv = new THREE.Matrix4(), tmp = new THREE.Vector3(), bx = new THREE.Box3();
  const baseMat = new THREE.MeshLambertMaterial({ color: "#3a2a1e" });
  const rimMat = new THREE.MeshLambertMaterial({ color: "#c9a14a" });
  let builtThisFrame = false;

  // the font of a plate, in the head group's units: its height times its glyph's share
  function fontOf(mesh) { mesh.updateWorldMatrix(true, false); const sy = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld).y; return sy * (mesh.userData.plate?.glyph ?? 0.6); }
  // the content's box in the head group's units (the group at the origin, unscaled)
  function contentBox(h) { const g = h.group; const p = g.position.clone(), q = g.quaternion.clone(), s = g.scale.clone(), par = g.parent; if (par) par.remove(g); g.position.set(0, 0, 0); g.quaternion.identity(); g.scale.setScalar(1); g.updateMatrixWorld(true); const b = h.boundsOf(null).box.clone(); g.position.copy(p); g.quaternion.copy(q); g.scale.copy(s); if (par) par.add(g); return b; }
  // the scale that fits a box into the desk's model zone
  // (the head's boxes reach well above the machines, for their funnels and pipes: height is a looser bound)
  const fitScale = (b) => { const sz = b.getSize(tmp); return Math.min(MODEL.w / Math.max(1e-3, sz.x), MODEL.d / Math.max(1e-3, sz.z), (MODEL.h * 1.7) / Math.max(1e-3, sz.y)); };
  /** the deepest level whose state names stay legible at the model's size (closed machines' names count too: a
   *  machine closed at one level is open and larger at the next), and that level's scale; none: the top level closed */
  function chooseLevels(h, t) {
    let best = null; const top = Math.min(h.levels, h.states().length > 80 ? 1 : 3);
    for (let L = h.topKind === "bench" ? 0 : Math.min(1, h.levels); L <= top; L++) {
      h.setLevels(L); h.update(t, 0);
      const b = contentBox(h); const s = fitScale(b);
      const names = h.plates().filter((p) => p.kind === "state" || p.kind === "machine" || p.kind === "window");
      const g0 = h.group.parent; if (g0) g0.remove(h.group); h.group.position.set(0, 0, 0); h.group.quaternion.identity(); h.group.scale.setScalar(1); h.group.updateMatrixWorld(true);
      const fonts = names.map((p) => fontOf(p.mesh)).sort((a, b2) => a - b2);
      if (g0) g0.add(h.group);
      const small = fonts.length ? fonts[Math.floor(fonts.length * 0.1)] * s : Infinity; // the smallest names, but a stray plate does not decide
      // the least a model shows: a parallel chart's regions closed, each saying what runs in it; any other chart its top
      // machine open (its marble moving among its parts) even when their names are small
      const floor = h.topKind === "bench" ? 0 : Math.min(1, h.levels);
      if (L >= floor && (!best || small >= FONT_MIN)) best = { L, s, font: small };
    }
    h.setLevels(best.L); h.update(t, 0);
    return best;
  }
  function build(id, seat, t) {
    let h = null;
    try { h = createHead({ THREE, sim, actorId: id, options: { desk: true, room: false } }); } catch (err) { console.warn("desk model", id, err.message); return null; }
    const holder = new THREE.Group(); holder.name = `desk-model:${id}`; root.add(holder);
    holder.add(h.group);
    const pick = chooseLevels(h, t);
    const b = contentBox(h); const s = pick.s;
    h.group.scale.setScalar(s);
    // stand it on its board, centred in the zone, its front to the visitor
    h.group.position.set(-((b.min.x + b.max.x) / 2) * s, BASE_H - b.min.y * s, -((b.min.z + b.max.z) / 2) * s);
    const sz = b.getSize(new THREE.Vector3());
    const base = new THREE.Mesh(new THREE.BoxGeometry(sz.x * s + 0.06, BASE_H, sz.z * s + 0.06), baseMat); base.position.y = BASE_H / 2; base.receiveShadow = true; holder.add(base);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(sz.x * s + 0.08, 0.012, 0.012), rimMat); rim.position.set(0, BASE_H - 0.004, (sz.z * s) / 2 + 0.036); holder.add(rim);
    const m = { id, head: h, holder, base, rim, levels: pick.L, scale: s, font: pick.font, size: [sz.x * s, sz.y * s, sz.z * s], seat: null, lastUse: 0 };
    models.set(id, m); place(m, seat);
    return m;
  }
  function place(m, seat) {
    if (m.seat === seat) return; m.seat = seat;
    const p = seatPoint(seat, [MODEL.x, DESK.topY, MODEL.z]); m.holder.position.copy(p); m.holder.rotation.y = seat.facing || 0;
  }
  function dispose(m) { m.holder.removeFromParent(); try { m.head.dispose(); } catch {} m.base.geometry.dispose(); m.rim.geometry.dispose(); models.delete(m.id); }

  /**
   * each frame: who has a model, where, and its marbles at t.
   * world: {people, playS, t, dt, camera, selected (actor id or null), moving (live: the room plays)}
   */
  function update({ people, playS, t, dt, camera, selected = null, frame = 0 }) {
    builtThisFrame = false;
    camera.updateMatrixWorld(); pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); fr.setFromProjectionMatrix(pv);
    // the people at desks now, nearest first
    const cands = [];
    for (const ps of people.seats.values()) {
      const seat = ps.seat; // the plan's seat (x, z, facing)
      if (seat.visitor || !ps.current || !ps.avatar.root.visible) continue;
      const id = ps.current.id; if (!sim.chartOf(id)) continue;
      const p = seatPoint(seat, [MODEL.x, DESK.topY + 0.15, MODEL.z]); const d = p.distanceTo(camera.position);
      bx.setFromCenterAndSize(p, tmp.set(MODEL.w + 0.4, 0.8, MODEL.w + 0.4));
      cands.push({ id, seat, d, inView: fr.intersectsBox(bx), sel: id === selected });
    }
    cands.sort((a, b) => (b.sel - a.sel) || (b.inView - a.inView) || a.d - b.d);
    const want = new Set(cands.filter((c) => c.sel || (c.inView && c.d < NEAR)).slice(0, MAX).map((c) => c.id));
    const byId = new Map(cands.map((c) => [c.id, c]));
    for (const c of cands) {
      if (!want.has(c.id)) continue;
      let m = models.get(c.id);
      if (!m) { if (builtThisFrame) continue; builtThisFrame = true; m = build(c.id, c.seat, t); if (!m) continue; }
      place(m, c.seat); m.lastUse = frame;
    }
    for (const m of [...models.values()]) {
      const c = byId.get(m.id); const on = want.has(m.id) && !!c;
      m.holder.visible = on;
      if (on) m.head.update(t, dt, playS);
      else if (!c || c.d > FAR) dispose(m);
    }
    if (models.size > KEEP) for (const m of [...models.values()].filter((x) => !x.holder.visible).sort((a, b) => a.lastUse - b.lastUse).slice(0, models.size - KEEP)) dispose(m);
  }
  /** a live run grew: each model's moves again, in place (a model that cannot is built again) */
  function refresh() { for (const m of [...models.values()]) { let ok = false; try { ok = m.head.refresh() !== false; } catch {} if (!ok) dispose(m); } }
  /** after the world was rebuilt: seats are new objects; models find theirs at the next update */
  function reseat() { for (const m of models.values()) m.seat = null; }
  function clear() { for (const m of [...models.values()]) dispose(m); }
  /** the engraved plates of the models shown (for the view sampler) */
  function plates() { const out = []; for (const m of models.values()) if (m.holder.visible) for (const p of m.head.plates()) out.push(p.mesh); return out; }
  function boxOf(id) { const m = models.get(id); if (!m || !m.holder.visible) return null; return new THREE.Box3().setFromObject(m.holder); }
  const stats = () => ({ built: models.size, shown: [...models.values()].filter((m) => m.holder.visible).length, models: [...models.values()].map((m) => ({ id: m.id, levels: m.levels, of: m.head.levels, scale: +m.scale.toFixed(4), font: m.font ? +m.font.toFixed(4) : null, size: m.size.map((x) => +x.toFixed(2)) })) });
  return { root, update, refresh, reseat, clear, plates, boxOf, stats, get: (id) => models.get(id) || null };
}
