// world/stations.js: every external endpoint as a thing on the wall or beside a desk, by kind:
//   model   an oracle cabinet behind glass (reels, a field of lamps, an eye, a printout slot)
//   service a big machine (gear window, chimney, lamp): invokers, I/O processors, APIs
//   tool    a small machine of the same family (beside its owner's desk when it has one)
//   log     an archive: filing cabinets and a ledger whose pile grows with every entry
//   user    the hatch where the people at the keyboards hand work in (bell, silhouettes)
//   timer   the wall clock (built with the room; its bells ring)
//   unknown a grey cabinet with a slot and a lamp
// A station is busy from a request's arrival until it answers that requester.
import * as THREE from "three";
import { box, block, cyl, mat, plate, canvasTex } from "./kit.js";

const WOOD = "#a8743f", WOOD_D = "#7d5330", WOOD_L = "#c99a62", BRASS = "#c9a14a", PAPER = "#f6f0de";

export function busySpans(sim, id) {
  const ms = sim.messagesBetween(-1, sim.duration + 1); const spans = [];
  for (let i = 0; i < ms.length; i++) { const m = ms[i]; if (m.to !== id) continue; for (let j = i + 1; j < ms.length; j++) { const x = ms[j]; if (x.from === id && x.to === m.from) { if (x.at - m.at < 8000) spans.push([sim.flight(m)[1], sim.flight(x)[0]]); break; } } }
  return spans;
}

export function buildStations(scene, sim, plan, cfg = {}) {
  const root = new THREE.Group(); scene.add(root);
  const list = [];
  const lamp = (parent, x, y, z, color = "#ffd36b") => { const m = new THREE.MeshLambertMaterial({ color: "#555", emissive: color, emissiveIntensity: 0 }); const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), m); b.position.set(x, y, z); parent.add(b); return { set(on) { m.emissiveIntensity = on ? 1.4 : 0; m.color.set(on ? color : "#555"); } }; };
  const nameplate = (parent, text, y, z, w = 1.2) => { const p = plate(text, { w, h: 0.2 }); p.position.set(0, y, z); parent.add(p); return p; };

  function machine(g, size, color, label) {
    const k = size;
    block(g, 0.75 * k, 1.05 * k, 0.7 * k, color, 0, 0, 0); block(g, 0.8 * k, 0.08 * k, 0.75 * k, "#2b2b2b", 0, 1.05 * k, 0);
    const gear = new THREE.Group(); gear.position.set(0, 0.62 * k, 0.36 * k); g.add(gear);
    const disc = cyl(0.2 * k, 0.03, "#e8d9a8", 16); disc.rotation.x = Math.PI / 2; disc.position.z = -0.01; gear.add(disc);
    for (let i = 0; i < 6; i++) { const tooth = box(0.07 * k, 0.4 * k, 0.04, BRASS); tooth.rotation.z = (i * Math.PI) / 6; gear.add(tooth); }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22 * k, 0.03 * k, 6, 16), mat("#2b2b2b")); rim.position.set(0, 0.62 * k, 0.37 * k); g.add(rim);
    block(g, 0.16 * k, 0.35 * k, 0.16 * k, "#2b2b2b", 0.22 * k, 1.13 * k, -0.15 * k);
    const crank = new THREE.Group(); crank.position.set(-0.4 * k, 0.6 * k, 0); g.add(crank); const arm = box(0.04, 0.3 * k, 0.04, "#8d96a3"); arm.position.y = 0.13 * k; crank.add(arm); const knob = box(0.09, 0.09, 0.09, "#c43b2e"); knob.position.set(-0.05, 0.27 * k, 0); crank.add(knob);
    const lp = lamp(g, 0.24 * k, 1.13 * k + 0.07, 0.22 * k, "#5cff9c");
    const p = plate(label.toUpperCase(), { w: 0.62 * k, h: 0.13 * k, bg: "#d6c18a" }); p.position.set(0, 0.25 * k, 0.356 * k); g.add(p);
    const puffs = [0, 1, 2].map(() => { const s = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshLambertMaterial({ color: "#eeeeee", transparent: true, opacity: 0.8 })); s.visible = false; g.add(s); return s; });
    return { mouth: new THREE.Vector3(0, 1.25 * k, 0), update(busy, amb) { gear.rotation.z = busy ? amb * 6 : 0.3; crank.rotation.x = busy ? amb * 7 : 0; lp.set(busy); puffs.forEach((pf, i) => { pf.visible = busy; const f = (amb * 0.8 + i / 3) % 1; pf.position.set(0.22 * k + Math.sin(i * 3 + amb) * 0.05, 1.5 * k + f * 0.9, -0.15 * k); pf.scale.setScalar(0.6 + f * 1.4); pf.material.opacity = 0.8 * (1 - f); }); } };
  }

  function build(s, attachedTo) {
    const g = new THREE.Group(); g.position.set(s.x, 0, s.z); g.rotation.y = s.facing || 0; root.add(g);
    const label = s.label.replace(/^the /i, "");
    let mouthLocal = new THREE.Vector3(0, 2.2, 0.4), update = () => {};
    if (s.kind === "model") {
      const or = new THREE.Group(); g.add(or);
      block(or, 3.0, 2.3, 1.1, "#3f3a5c", 0, 0, 0); block(or, 3.2, 0.15, 1.25, "#2a2640", 0, 2.3, 0); block(or, 3.2, 0.3, 1.25, "#2a2640", 0, 0, 0);
      const reels = [-0.75, 0.75].map((x) => { const r = new THREE.Group(); r.position.set(x, 1.6, 0.57); or.add(r); const d = cyl(0.38, 0.06, "#d8d8d8", 20); d.rotation.x = Math.PI / 2; r.add(d); for (let i = 0; i < 3; i++) { const sp = box(0.06, 0.64, 0.02, "#555"); sp.position.z = 0.04; sp.rotation.z = (i * Math.PI) / 3; r.add(sp); } return r; });
      const lamps = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) lamps.push(lamp(or, -0.9 + c * 0.3, 0.6 + r * 0.22, 0.58, ["#ff6b6b", "#ffd36b", "#7dffb0"][r]));
      const eyeM = new THREE.MeshLambertMaterial({ color: "#222", emissive: "#b98cff", emissiveIntensity: 0.2 }); const eye = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), eyeM); eye.position.set(-0.9, 2.7, 0.1); or.add(eye);
      const light = new THREE.PointLight("#b98cff", 0, 8, 1.4); light.position.set(0, 2.2, 1.6); or.add(light);
      const pp = plate(label.toUpperCase(), { w: 1.4, h: 0.24 }); pp.position.set(0, 2.15, 0.56); or.add(pp);
      mouthLocal = new THREE.Vector3(0.6, 2.65, 0.2);
      update = (busy, amb) => { reels.forEach((r, i) => (r.rotation.z = busy ? amb * (i ? 3.1 : 2.3) : 0)); lamps.forEach((l, i) => l.set(busy && Math.sin(amb * (3 + (i % 5)) + i * 1.7) > 0.1)); eyeM.emissiveIntensity = busy ? 1.2 + Math.sin(amb * 4) * 0.4 : 0.15; light.intensity = busy ? 5 : 0; };
    } else if (s.kind === "log") {
      for (let i = 0; i < 3; i++) { const cab = new THREE.Group(); cab.position.set(-1.2 + i * 0.95, 0, -0.5); g.add(cab); block(cab, 0.9, 1.6, 0.7, "#6d7a6a", 0, 0, 0); for (let d = 0; d < 4; d++) { block(cab, 0.8, 0.34, 0.04, "#7f8d7b", 0, 0.06 + d * 0.38, 0.36); block(cab, 0.22, 0.05, 0.05, BRASS, 0, 0.2 + d * 0.38, 0.39); } }
      block(g, 1.7, 0.08, 0.8, WOOD_L, 0.1, 0.74, 0.55); block(g, 0.08, 0.74, 0.7, WOOD, -0.65, 0, 0.55); block(g, 0.08, 0.74, 0.7, WOOD, 0.85, 0, 0.55);
      block(g, 0.6, 0.04, 0.44, "#6b2b2b", -0.2, 0.82, 0.55); block(g, 0.26, 0.03, 0.4, PAPER, -0.34, 0.86, 0.55); block(g, 0.26, 0.03, 0.4, PAPER, -0.06, 0.86, 0.55);
      const pile = []; for (let i = 0; i < 12; i++) { const p = box(0.32, 0.03, 0.4, PAPER); p.position.set(0.55, 0.84 + i * 0.032, 0.55); p.rotation.y = (i % 3 - 1) * 0.08; p.visible = false; g.add(p); pile.push(p); }
      const binders = []; for (let i = 0; i < 10; i++) { const b = box(0.08, 0.3, 0.26, ["#2b5a8a", "#8a2b2b", "#2b8a5a", "#8a7a2b"][i % 4]); b.position.set(-1.55 + i * 0.1, 1.75, -0.5); b.visible = false; g.add(b); binders.push(b); }
      const pp = plate(label.toUpperCase(), { w: 1.3, h: 0.2 }); pp.position.set(0.1, 0.5, 0.96); g.add(pp);
      mouthLocal = new THREE.Vector3(0.9, 1.4, 0.4);
      update = (busy, amb, n) => { pile.forEach((p, i) => (p.visible = i < n % 13)); binders.forEach((b, i) => (b.visible = i < Math.floor(n / 13))); };
    } else if (s.kind === "user") {
      // the hatch in the west wall: the people at the keyboards hand their typing in here
      block(g, 1.7, 1.2, 0.1, "#3d2a1a", 0, 1.0, -0.98);
      const win = block(g, 1.5, 1.0, 0.12, "#ffe7a8", 0, 1.1, -0.96, { mat: { emissive: "#ffcf6a", emissiveIntensity: 0.35 } });
      const people = []; for (let i = 0; i < 3; i++) { const ph = new THREE.Group(); ph.position.set(-0.5 + i * 0.5, 1.15, -0.95); g.add(ph); const hd = box(0.26, 0.26, 0.04, "#6a4a3a"); hd.position.y = 0.5; ph.add(hd); const bd = box(0.36, 0.4, 0.04, ["#3c6aa8", "#a83c5a", "#3ca87a"][i]); bd.position.y = 0.17; ph.add(bd); people.push(ph); }
      block(g, 2.2, 1.0, 0.6, "#6d4a8a", 0, 0, -0.2); block(g, 2.4, 0.08, 0.76, WOOD_L, 0, 1.0, -0.2);
      const bell = new THREE.Group(); bell.position.set(0.6, 1.1, -0.1); g.add(bell); { const b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(BRASS)); bell.add(b); const base = cyl(0.15, 0.03, "#333"); bell.add(base); }
      const pp = plate(label.toUpperCase(), { w: 1.7, h: 0.18, bg: "#ffe7a8", fg: "#4a2a10" }); pp.position.set(0, 2.0, -0.9); g.add(pp);
      mouthLocal = new THREE.Vector3(-0.8, 1.45, 0.1);
      update = (busy, amb, n, rang) => { bell.rotation.z = rang ? Math.sin(amb * 55) * 0.25 : 0; people.forEach((p, i) => (p.position.y = 1.15 + (rang ? Math.abs(Math.sin(amb * 9 + i)) * 0.05 : 0))); };
    } else if (s.kind === "timer") {
      return null; // the wall clock is part of the room
    } else if (s.kind === "service" || s.kind === "tool") {
      const m = machine(g, s.kind === "service" ? 1.5 : 1.0, s.kind === "service" ? "#5a4a6a" : "#4b5b4a", label);
      mouthLocal = m.mouth; update = (busy, amb) => m.update(busy, amb);
    } else {
      block(g, 1.0, 1.7, 0.7, "#7f8794", 0, 0, 0); block(g, 0.6, 0.06, 0.1, "#111", 0, 1.2, 0.36);
      const lp = lamp(g, 0, 1.5, 0.36, "#ffd36b");
      const pp = plate(label.toUpperCase(), { w: 0.9, h: 0.16, bg: "#d6d0c0" }); pp.position.set(0, 0.6, 0.36); g.add(pp);
      mouthLocal = new THREE.Vector3(0.3, 1.9, 0.1); update = (busy) => lp.set(busy);
    }
    g.updateMatrixWorld(true);
    const st = { id: s.id, kind: s.kind, group: g, mouth: g.localToWorld(mouthLocal.clone()), spans: busySpans(sim, s.id), update, attachedTo };
    g.traverse((o) => { if (o.isMesh) o.userData.stationId = s.id; });
    list.push(st); return st;
  }
  for (const s of plan.stations) build(s, null);
  for (const m of plan.machines) build({ ...m, facing: 0 }, m.owner);
  const byId = new Map(list.map((s) => [s.id, s]));
  // arrivals per station (for logs' piles and the hatch's bell)
  const msgs = sim.messagesBetween(-1, sim.duration + 1);
  const arrivals = new Map(), departs = new Map();
  for (const m of msgs) { const [s0, s1] = sim.flight(m); if (byId.has(m.to)) (arrivals.get(m.to) || arrivals.set(m.to, []).get(m.to)).push(s1); if (byId.has(m.from)) (departs.get(m.from) || departs.set(m.from, []).get(m.from)).push(s0); }
  const countBefore = (arr, s) => { let n = 0; if (arr) for (const x of arr) { if (x <= s) n++; else break; } return n; };
  const recent = (arr, s, w) => { if (!arr) return false; for (const x of arr) { if (x > s) break; if (s - x < w) return true; } return false; };
  function update(s, amb) {
    for (const st of list) {
      const busy = st.spans.some(([a, b]) => s >= a && s <= b);
      st.update(busy, amb, countBefore(arrivals.get(st.id), s), recent(departs.get(st.id), s, 0.6));
    }
  }
  return { root, list, byId, update };
}
