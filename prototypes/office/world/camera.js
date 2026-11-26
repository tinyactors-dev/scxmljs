// world/camera.js: where the visitor's camera may be, and how it moves.
//   - flights follow a smooth path through key points (a curve, eased), the look target along with
//     them; a flight can carry a progress callback (the head's lid is tied to it) and a follow-up;
//   - resolve(p) keeps a point out of furniture, walls and people: a sphere against boxes (pushed out
//     along the shortest axis), inside the room below the ceiling, above the floor;
//   - frame(...) finds a conversational view of a seat: 2.5-3 m away, a little above eye level, the
//     person and their desk in frame, from the side that puts the board behind them when it can.
// Nothing here moves the camera on its own: only a flight (started by input or the film) does.
import * as THREE from "three";
import { ease, clamp01 } from "./kit.js";

export function makeCameraRig(env) {
  const { camera, controls, wallH, colliders, people } = env; // env.room is read each time (it may be rebuilt)
  const R = 0.28; // the camera's sphere
  let flight = null;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);

  function fly(points, targets, dur = 1.4, opts = {}) {
    const P = [camera.position.clone(), ...points.map((p) => p.clone())], T = [controls.target.clone(), ...targets.map((p) => p.clone())];
    const dedup = (A) => A.filter((p, i) => i === 0 || p.distanceTo(A[i - 1]) > 1e-3);
    const pc = dedup(P), tc = dedup(T);
    const curve = (A) => (A.length < 2 ? { getPoint: () => A[0].clone() } : A.length === 2 ? new THREE.LineCurve3(A[0], A[1]) : new THREE.CatmullRomCurve3(A, false, "centripetal"));
    // a flight replaced mid-way still finishes what it promised (a lid closes, a stage ends)
    const old = flight; flight = null; if (old) { if (old.onProgress) old.onProgress(1); if (old.onDone) old.onDone(); }
    flight = { pc: curve(pc), tc: curve(tc), start: null, dur, kind: opts.kind || "move", onProgress: opts.onProgress, onDone: opts.onDone, t: 0 };
    return flight;
  }
  // advance the flight by dt seconds (film-deterministic: no wall clock)
  function update(dt) {
    if (!flight) return null;
    const f = flight; f.t += dt; const k = clamp01(f.t / f.dur), e = ease(k);
    camera.position.copy(f.pc.getPoint(e)); controls.target.copy(f.tc.getPoint(e));
    if (f.onProgress) f.onProgress(k);
    if (k >= 1) { flight = null; if (f.onDone) f.onDone(); }
    return f;
  }
  const stop = () => { flight = null; };

  // the boxes: static (desks, partitions, stations) plus everyone standing or sitting now
  function boxes(skipId) {
    const out = colliders();
    for (const b of people.boxes(skipId)) out.push(b);
    return out;
  }
  function resolve(p, opts = {}) {
    const q = p.clone(); const room = env.room;
    q.y = Math.max(0.3, q.y);
    // inside the room and below the ceiling: keep off the walls and under the ceiling
    const inRoom = q.x > room.x0 - 0.5 && q.x < room.x1 + 0.5 && q.z > room.z0 - 0.5 && q.z < room.z1 + 0.5;
    if (inRoom && q.y < wallH - 0.25) { q.x = Math.min(room.x1 - 0.4, Math.max(room.x0 + 0.4, q.x)); q.z = Math.min(room.z1 - 0.4, Math.max(room.z0 + 0.4, q.z)); q.y = Math.min(wallH - 0.35, q.y); }
    if (opts.free) return q;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const [lo, hi] of boxes(opts.skip)) {
        if (q.x < lo.x - R || q.x > hi.x + R || q.y < lo.y - R || q.y > hi.y + R || q.z < lo.z - R || q.z > hi.z + R) continue;
        // shortest way out (never down through the floor)
        const c = [[lo.x - R - q.x, 0], [hi.x + R - q.x, 0], [hi.y + R - q.y, 1], [lo.z - R - q.z, 2], [hi.z + R - q.z, 2]];
        if (lo.y - R > 0.3) c.push([lo.y - R - q.y, 1]);
        c.sort((a, b) => Math.abs(a[0]) - Math.abs(b[0])); const [d, ax] = c[0];
        if (ax === 0) q.x += d; else if (ax === 1) q.y += d; else q.z += d; moved = true;
      }
      if (!moved) break;
    }
    return q;
  }
  const inside = (p, skip) => boxes(skip).some(([lo, hi]) => p.x > lo.x - R && p.x < hi.x + R && p.y > lo.y - R && p.y < hi.y + R && p.z > lo.z - R && p.z < hi.z + R);

  // does the segment a -> b (shortened at b by 0.45 m: the subject's own space) cross any box?
  function clear(a, b, skip) {
    const d = b.clone().sub(a); const L = d.length(); if (L < 0.5) return true; d.multiplyScalar((L - 0.45) / L);
    for (const [lo, hi] of boxes(skip)) { let t0 = 0, t1 = 1; let hit = true;
      for (const ax of ["x", "y", "z"]) { if (Math.abs(d[ax]) < 1e-9) { if (a[ax] < lo[ax] || a[ax] > hi[ax]) { hit = false; break; } continue; } let u0 = (lo[ax] - a[ax]) / d[ax], u1 = (hi[ax] - a[ax]) / d[ax]; if (u0 > u1) [u0, u1] = [u1, u0]; t0 = Math.max(t0, u0); t1 = Math.min(t1, u1); if (t0 > t1) { hit = false; break; } }
      if (hit) return false; }
    return true;
  }
  // a conversational view of someone at a seat frame (x, z, facing); side +1 = on the sitter's left
  function frame({ x, z, facing = 0, standing = false }, prefSide = 1, skip = null) {
    const c = Math.cos(facing), s = Math.sin(facing);
    const W = (px, py, pz) => v(x + px * c + pz * s, py, z - px * s + pz * c);
    const tgt = W(0, standing ? 1.35 : 1.08, standing ? 0.3 : 0.6);
    const tries = [];
    for (const [d, h, sx] of [[2.75, 2.05, 1.0], [3.0, 2.25, 0.6], [2.6, 2.0, 1.5], [3.2, 2.45, 0.2], [2.5, 2.1, 2.0], [2.6, 2.85, 0.9], [3.0, 3.05, 0.3], [2.2, 2.2, 2.4], [3.4, 2.6, 0], [1.6, 2.3, 2.6]]) for (const side of [prefSide, -prefSide]) tries.push(W(side * sx, h, d));
    // a view is good when nothing stands in the way: the camera is not pushed by furniture or people, and the
    // line to the face crosses no one else and no furniture (a visitor on a stool, a neighbour's partition)
    const face = W(0, standing ? 1.75 : 1.45, standing ? 0.05 : 0.08);
    // ... and no one else's head is right in front of the lens (a visitor on a stool, a neighbour)
    // (nobody else nearer the camera than 90 % of the subject's distance: no head looms over the frame)
    const roomy = (q) => { const df = Math.hypot(face.x - q.x, face.z - q.z); return people.boxes(skip).every(([lo, hi]) => { const cx = (lo.x + hi.x) / 2, cz = (lo.z + hi.z) / 2; return Math.hypot(cx - face.x, cz - face.z) < 0.5 || (Math.hypot(cx - q.x, cz - q.z) > Math.max(1.6, 0.9 * df)) || q.y - hi.y > 0.85; }); };
    for (const p of tries) { const q = resolve(p, { skip }); if (q.distanceTo(p) < 0.05 && clear(q, face, skip) && roomy(q)) return { pos: q, tgt }; }
    for (const p of tries) { const q = resolve(p, { skip }); if (q.distanceTo(p) < 0.05 && clear(q, face, skip)) return { pos: q, tgt }; }
    for (const p of tries) { const q = resolve(p, { skip }); if (q.distanceTo(p) < 0.05) return { pos: q, tgt }; }
    return { pos: resolve(tries[0], { skip }), tgt };
  }
  return { fly, update, stop, resolve, frame, inside, clear, get flight() { return flight; }, R };
}
