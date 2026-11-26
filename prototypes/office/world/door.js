// world/door.js: a real door in a framed opening: two jambs, a lintel, a threshold, and a panelled leaf on two
// hinges that swings OUT of the room (away from whoever walks in) with an eased motion. Closed by default; the
// caller says each frame whether anyone wants through (`update(dt, want)`), and the door opens in about 0.7 s and
// closes again in about 0.9 s once nobody does.
//
// Local frame: the opening is centred on x = 0 in the wall's plane (z = 0), the floor at y = 0, the room on -z,
// outside on +z. The wall around it is the caller's: it must leave a hole of `w` x `h` (the frame covers its
// edges). One door unit is one metre at scale 1; a machine room builds it scaled up with its visitor.
//
// Owns: the door's geometry, its swing and the box a closed leaf blocks. Must never know: who walks through, the
// room it is in, the app's modes.
import * as THREE from "three";

const WOOD = "#7a5232", WOOD_D = "#4e321c", WOOD_L = "#a8743f", BRASS = "#c9a14a";

export function buildDoor({ w = 1.3, h = 2.45, wallT = 0.3, leafColor = WOOD, frameColor = WOOD_D, swing = 1.75, sign = null } = {}) {
  const group = new THREE.Group(); group.name = "door";
  const M = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
  const B = (bw, bh, bd, m, x, y, z, parent = group) => { const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; parent.add(b); return b; };
  const frameM = M(frameColor), leafM = M(leafColor), panelM = M(WOOD_L), brassM = M(BRASS, { emissive: "#3a2a0a", emissiveIntensity: 0.2 });
  const J = 0.1, depth = wallT + 0.08; // jamb width, frame depth (proud of the wall on both faces)
  // the frame: jambs, lintel, a threshold strip and the stop the leaf closes against
  B(J, h + J, depth, frameM, -w / 2 - J / 2, (h + J) / 2, 0); B(J, h + J, depth, frameM, w / 2 + J / 2, (h + J) / 2, 0);
  B(w + 2 * J, J, depth, frameM, 0, h + J / 2, 0);
  B(w + 0.06, 0.03, depth, M("#3b2a1c"), 0, 0.015, 0);
  // architraves (casing) on both faces: a wider flat trim round the opening
  for (const sz of [-1, 1]) { const z = sz * (wallT / 2 + 0.012); B(0.09, h + 0.19, 0.024, frameM, -w / 2 - J - 0.045, (h + 0.19) / 2, z); B(0.09, h + 0.19, 0.024, frameM, w / 2 + J + 0.045, (h + 0.19) / 2, z); B(w + 2 * J + 0.18, 0.1, 0.024, frameM, 0, h + J + 0.05, z); }
  // the leaf: hinged on the -x jamb at the outer face, so it swings out (+z) and never into the room
  const hinge = new THREE.Group(); hinge.position.set(-w / 2, 0, wallT / 2 - 0.03); group.add(hinge);
  const lt = 0.05, lw = w - 0.012, lh = h - 0.02;
  const leaf = new THREE.Group(); hinge.add(leaf);
  B(lw, lh, lt, leafM, lw / 2, lh / 2 + 0.01, -lt / 2, leaf);
  // raised panels on both faces (two tall, one short), like a real four-panel door
  for (const sz of [-1, 1]) {
    const z = -lt / 2 + sz * (lt / 2 + 0.008);
    for (const [px, py, pw, ph] of [[0.27, 0.62, 0.36, 0.95], [0.73, 0.62, 0.36, 0.95], [0.27, 1.7, 0.36, 0.95], [0.73, 1.7, 0.36, 0.95]]) B(pw * lw, ph * (lh / 2.45), 0.016, panelM, px * lw, py * (lh / 2.45), z, leaf);
  }
  // hinges and a brass knob with its plate on each face
  for (const y of [0.35, lh - 0.35]) B(0.04, 0.14, 0.07, brassM, 0.01, y, -lt / 2, leaf);
  for (const sz of [-1, 1]) { const z = -lt / 2 + sz * (lt / 2 + 0.02); B(0.06, 0.2, 0.012, brassM, lw - 0.09, 1.0, z, leaf); const k = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), brassM); k.position.set(lw - 0.09, 1.0, z + sz * 0.035); leaf.add(k); }
  if (sign) { sign.position.set(0, h + J + 0.32, -(depth / 2 + 0.03)); sign.rotation.y = Math.PI; group.add(sign); } // a sign over the door, facing the room

  let u = 0, k = 0, want = false; // u: progress 0..1 along the swing (linear in time), k: the eased angle share
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  /** advance the swing by dt seconds; `open` says whether anyone wants through now. Returns true while it moves */
  function update(dt, open) {
    want = !!open; const u0 = u;
    u = Math.max(0, Math.min(1, u + (want ? dt / 0.7 : -dt / 0.9)));
    k = ease(u); hinge.rotation.y = -swing * k; // out of the room
    return u !== u0;
  }
  /** jump to a state (a rebuild, a replay seek) */
  function set(open) { u = open ? 1 : 0; update(0, open); }
  const tmp = new THREE.Vector3();
  /** the opening's centre in world coordinates, and the outward normal */
  function where() { group.updateWorldMatrix(true, false); const c = group.localToWorld(tmp.set(0, 0, 0)).clone(); const n = new THREE.Vector3(0, 0, 1).transformDirection(group.matrixWorld); return { c, n }; }
  update(0, false);
  return { group, leaf, hinge, update, set, where, w, h, get k() { return k; }, get open() { return u > 0.6; }, get moving() { return u > 0 && u < 1; }, get wanted() { return want; } };
}
