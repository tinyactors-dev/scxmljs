// engine/player.js: the visitor as a first-person walker (Minecraft-like): a body of radius FP.radius that walks
// on the floor with acceleration and deceleration, slides along whatever it touches (boxes from the world, the
// room's own limit), looks with yaw and pitch, jumps a little, and bobs its head a little while it walks. Its eye
// is the camera. Nothing moves it but its input (keys, a look delta, a virtual stick), `place` (spawning, H, a
// door into another room) and the autopilot, which the tools use to walk the visitor up to something the way a
// visitor would: a path round the furniture on a grid, turning toward each waypoint, then facing the thing.
//
// Frame-rate independent: every motion is integrated with dt (capped by the caller), and the camera pose is a
// function of the state only (no smoothing that lags behind it).
//
// Owns: the walker's state and motion, collision against boxes, the autopilot's path. Must never know: the
// office, a machine room, what is clicked, the app's modes. The world it walks in is given as
// {boxes(): [[min, max] Vector3 pairs], limit(p, r): clamps p in place, rect: {x0, x1, z0, z1} for the autopilot,
// floor: its height}.
import * as THREE from "three";

export const FP = {
  eye: 1.62,        // a standing block person's eyes, metres at scale 1
  radius: 0.28,     // the body's footprint
  walk: 2.1, run: 4.4, // metres per second (Shift runs)
  accel: 12, decel: 16, // m/s² toward the wished velocity (speeding up, slowing down)
  jumpV: 3.0, gravity: 12, // a small hop
  bob: 0.022,       // head bob amplitude at full walking speed (m)
  pitchMax: 1.4,    // radians up or down
  fov: 72,          // vertical field of view (degrees)
  near: 0.06,       // the near plane: nothing within reach of the body is cut
  reach: 3.2,       // how far a hand reaches to press, pull or open something (m, from the eye)
  turn: 3.2,        // the autopilot's turning rate (rad/s)
};

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function createPlayer() {
  const pos = v3(), vel = new THREE.Vector2(); // feet on the floor; horizontal velocity (x, z)
  let yaw = 0, pitch = 0, hop = 0, vy = 0, scale = 1, phase = 0, walked = 0, speedK = 0, world = null, auto = null;
  const fwd = () => v3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = () => v3(Math.cos(yaw), 0, -Math.sin(yaw));

  /** the world to walk in, and the walker's scale there (a machine room is built at a larger scale) */
  function setWorld(w, s = 1) { world = w; scale = s; auto = null; }
  /** stand somewhere: feet at p (y ignored), looking along yaw with pitch; stops motion and the autopilot */
  function place(p, yw = yaw, pt = 0) { pos.set(p.x, 0, p.z); yaw = yw; pitch = pt; vel.set(0, 0); hop = 0; vy = 0; speedK = 0; if (auto && auto.done) auto.done(false); auto = null; if (world) collide(pos); }
  /** turn to look at a world point (no motion) */
  function face(p) { const e = eyeY(); yaw = Math.atan2(-(p.x - pos.x), -(p.z - pos.z)); pitch = clamp(Math.atan2(p.y - e, Math.hypot(p.x - pos.x, p.z - pos.z)), -FP.pitchMax, FP.pitchMax); }
  const floorY = () => (world && world.floor) || 0;
  const eyeY = () => floorY() + FP.eye * scale + hop;

  // ---- collision: a circle against boxes that overlap the body's height, pushed out along the shortest way
  // a box marked `soft` (a person) only stops the walker walking into it: one that walks into the walker passes
  // through them (nothing pushes the visitor but their own input)
  const overlaps = (q, b, r) => { const cx = clamp(q.x, b[0].x, b[1].x), cz = clamp(q.z, b[0].z, b[1].z); return (q.x - cx) ** 2 + (q.z - cz) ** 2 < r * r; };
  function collide(p, out = null, from = null) {
    if (!world) return p;
    const r = FP.radius * scale, lo = floorY() + hop + 0.25 * scale, hi = floorY() + hop + 1.75 * scale; const bs = world.boxes();
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (const b of bs) {
        const mn = b[0], mx = b[1]; if (mx.y < lo || mn.y > hi) continue;
        if (b.soft && (!from || overlaps(from, b, r))) continue;
        if (p.x < mn.x - r || p.x > mx.x + r || p.z < mn.z - r || p.z > mx.z + r) continue;
        const cx = clamp(p.x, mn.x, mx.x), cz = clamp(p.z, mn.z, mx.z); let dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) { const d = Math.sqrt(d2); p.x += (dx / d) * (r - d); p.z += (dz / d) * (r - d); }
        else { const c = [[mn.x - r - p.x, 0], [mx.x + r - p.x, 0], [mn.z - r - p.z, 1], [mx.z + r - p.z, 1]].sort((a, b2) => Math.abs(a[0]) - Math.abs(b2[0]))[0]; if (c[1]) p.z += c[0]; else p.x += c[0]; }
        moved = true; if (out) out.push(b);
      }
      if (!moved) break;
    }
    world.limit(p, r);
    return p;
  }

  /** one step: input {mx (strafe, right +), mz (forward +), run, jump, dyaw, dpitch} */
  function step(dt, input = {}) {
    if (dt <= 0) return { moved: 0 };
    let { mx = 0, mz = 0, run = false, jump = false, dyaw = 0, dpitch = 0 } = input;
    if (auto) { const a = steer(dt); if (a) { mx = 0; mz = a.mz; run = false; dyaw = a.dyaw; dpitch = a.dpitch; } }
    yaw = wrap(yaw + dyaw); pitch = clamp(pitch + dpitch, -FP.pitchMax, FP.pitchMax);
    // the wished velocity, and an acceleration toward it (so a key tap moves a little and stops smoothly)
    const wish = fwd().multiplyScalar(mz).add(right().multiplyScalar(mx)); if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar((run ? FP.run : FP.walk) * scale);
    const dvx = wish.x - vel.x, dvz = wish.z - vel.y, dv = Math.hypot(dvx, dvz);
    const rate = (wish.lengthSq() > vel.lengthSq() ? FP.accel : FP.decel) * scale * dt;
    if (dv <= rate) vel.set(wish.x, wish.z); else vel.set(vel.x + (dvx / dv) * rate, vel.y + (dvz / dv) * rate);
    const from = pos.clone();
    if (vel.lengthSq() > 1e-10) { pos.x += vel.x * dt; pos.z += vel.y * dt; }
    collide(pos, null, from);
    const moved = Math.hypot(pos.x - from.x, pos.z - from.z);
    // slide: what the walls took is gone from the velocity too (no pushing against a wall at full speed)
    if (dt > 0) { const ax = (pos.x - from.x) / dt, az = (pos.z - from.z) / dt; if (Math.hypot(ax, az) < vel.length() - 1e-6) vel.set(ax, az); }
    // a small hop
    if (jump && hop <= 0 && vy <= 0) vy = FP.jumpV * scale;
    if (hop > 0 || vy > 0) { hop += vy * dt; vy -= FP.gravity * scale * dt; if (hop <= 0) { hop = 0; vy = 0; } }
    // the head bob follows distance walked, so it stops when the feet stop
    const sp = moved / dt / scale; speedK += (clamp(sp / FP.walk, 0, 1.6) - speedK) * Math.min(1, dt * 10);
    phase += (moved / scale) * 2.4; walked += moved;
    return { moved };
  }
  const bobY = () => (hop > 0 ? 0 : Math.abs(Math.sin(phase)) * FP.bob * scale * Math.min(1, speedK));
  /** the camera at the eye */
  function apply(camera) { camera.position.set(pos.x, eyeY() + bobY(), pos.z); camera.rotation.set(pitch, yaw, 0, "YXZ"); camera.updateMatrixWorld(); }

  // ---- the autopilot (for the tools): a path on a grid round the boxes, then facing the target
  // goal: {look: Vector3 to face at the end, at?: Vector3 to stand near (default: look), dist: how far from it,
  // normal?: Vector3 the side to stand on (a control's face), through?: Vector3 a point to walk to and past (a door)}
  function approach(goal, done) {
    if (auto && auto.done) auto.done(false);
    auto = null; if (!world || !world.rect) { if (done) done(false); return false; }
    const path = plan(goal); if (!path) { if (done) done(false); return false; }
    auto = { goal, path, i: 0, done, best: Infinity, stuck: 0, replans: 0 };
    return true;
  }
  function plan(goal) {
    const cell = 0.25 * scale, R = world.rect, nx = Math.ceil((R.x1 - R.x0) / cell), nz = Math.ceil((R.z1 - R.z0) / cell);
    const P = (i, k) => v3(R.x0 + (i + 0.5) * cell, 0, R.z0 + (k + 0.5) * cell);
    const free = new Uint8Array(nx * nz); const q = v3();
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const p = P(i, k); q.copy(p); collide(q); free[k * nx + i] = q.distanceToSquared(p) < 1e-6 ? 1 : 0; }
    const cellOf = (p) => [clamp(Math.floor((p.x - R.x0) / cell), 0, nx - 1), clamp(Math.floor((p.z - R.z0) / cell), 0, nz - 1)];
    let [si, sk] = cellOf(pos); if (!free[sk * nx + si]) { let bd = Infinity; for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (free[k * nx + i]) { const d = (i - si) ** 2 + (k - sk) ** 2; if (d < bd) { bd = d; si = i; sk = k; } } }
    // Dijkstra from here over every free cell (a room is a few thousand cells)
    const cost = new Float64Array(nx * nz).fill(Infinity), from = new Int32Array(nx * nz).fill(-1);
    const heap = []; const push = (c, n) => { heap.push([c, n]); let j = heap.length - 1; while (j > 0) { const pj = (j - 1) >> 1; if (heap[pj][0] <= heap[j][0]) break; [heap[pj], heap[j]] = [heap[j], heap[pj]]; j = pj; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let j = 0; for (;;) { const l = 2 * j + 1, r2 = l + 1; let m = j; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r2 < heap.length && heap[r2][0] < heap[m][0]) m = r2; if (m === j) break; [heap[m], heap[j]] = [heap[j], heap[m]]; j = m; } } return top; };
    const s0 = sk * nx + si; cost[s0] = 0; push(0, s0);
    while (heap.length) { const [c, n] = pop(); if (c > cost[n]) continue; const i = n % nx, k = (n / nx) | 0;
      for (const [di, dk, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) { const a = i + di, b = k + dk; if (a < 0 || b < 0 || a >= nx || b >= nz) continue; const m = b * nx + a; if (!free[m]) continue; if (di && dk && (!free[k * nx + a] || !free[b * nx + i])) continue; const cc = c + w * cell; if (cc < cost[m]) { cost[m] = cc; from[m] = n; push(cc, m); } } }
    // where to stand: through a door, the far side of it; else a cell at about `dist` from the target, on its face side
    let goalN = -1;
    if (goal.through) { const [gi, gk] = cellOf(goal.through); let bd = Infinity; for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const n = k * nx + i; if (!Number.isFinite(cost[n])) continue; const d = P(i, k).distanceTo(goal.through); if (d < bd) { bd = d; goalN = n; } } void gi; void gk; }
    else {
      const at = goal.at || goal.look, dist = goal.dist ?? 1.4 * scale; let bd = Infinity;
      for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const n = k * nx + i; if (!Number.isFinite(cost[n])) continue; const p = P(i, k); const d = Math.hypot(p.x - at.x, p.z - at.z);
        let sc = cost[n] * 0.25 + Math.abs(d - dist) * 3; if (goal.normal) { const dot = ((p.x - at.x) * goal.normal.x + (p.z - at.z) * goal.normal.z) / Math.max(1e-6, d); sc += (1 - dot) * 4 * scale; }
        if (goal.maxDist && d > goal.maxDist) sc += 100; if (sc < bd) { bd = sc; goalN = n; } }
    }
    if (goalN < 0) return null;
    const cells = []; for (let n = goalN; n >= 0; n = from[n]) cells.push(n); cells.reverse();
    // pull the string: keep a waypoint only where the straight line from the last kept one leaves free cells
    const pts = cells.map((n) => P(n % nx, (n / nx) | 0)); const clear = (a, b) => { const L = a.distanceTo(b), st = Math.max(1, Math.ceil(L / (cell * 0.5))); for (let j = 1; j < st; j++) { const p = a.clone().lerp(b, j / st); const [i, k] = cellOf(p); if (!free[k * nx + i]) return false; } return true; };
    const out = []; let a = pos.clone(); let j = 0;
    while (j < pts.length - 1) { let far = j + 1; for (let m = pts.length - 1; m > j + 1; m--) if (clear(a, pts[m])) { far = m; break; } out.push(pts[far]); a = pts[far]; j = far; }
    if (goal.through) out.push(goal.through.clone()); else if (!out.length) out.push(pts[pts.length - 1] || pos.clone());
    return out;
  }
  function steer(dt) {
    const A = auto; const g = A.goal; const e = eyeY();
    if (A.i < A.path.length) {
      const wp = A.path[A.i]; const dx = wp.x - pos.x, dz = wp.z - pos.z, d = Math.hypot(dx, dz);
      const last = A.i === A.path.length - 1;
      if (d < (last ? 0.12 : 0.35) * scale) { A.i++; A.best = Infinity; A.stuck = 0; return { mz: 0, dyaw: 0, dpitch: 0 }; }
      // progress check: stuck behind someone for a while: plan again, then give up
      if (d < A.best - 0.02 * scale) { A.best = d; A.stuck = 0; } else A.stuck += dt;
      if (A.stuck > 1.6) { A.stuck = 0; if (A.replans++ < 3) { const p = plan(g); if (p) { A.path = p; A.i = 0; A.best = Infinity; return null; } } finish(false); return null; }
      const want = Math.atan2(-dx, -dz), err = wrap(want - yaw); const turn = clamp(err, -FP.turn * dt, FP.turn * dt);
      const lookY = g.look ? clamp(Math.atan2(g.look.y - e, Math.hypot(g.look.x - pos.x, g.look.z - pos.z)) * 0.4, -0.5, 0.5) : 0; // eyes a little toward what it walks to
      const pt = clamp(lookY - pitch, -1.5 * dt, 1.5 * dt);
      return { mz: clamp(1 - Math.abs(err) / 0.8, 0, 1) * (last && d < 0.6 * scale ? Math.max(0.3, d / (0.6 * scale)) : 1), dyaw: turn, dpitch: pt };
    }
    if (vel.lengthSq() > 0.01 * scale * scale) return { mz: 0, dyaw: 0, dpitch: 0 }; // stop first
    if (!g.look || g.through) { finish(true); return null; }
    const want = Math.atan2(-(g.look.x - pos.x), -(g.look.z - pos.z)), err = wrap(want - yaw);
    const wp = clamp(Math.atan2(g.look.y - e, Math.hypot(g.look.x - pos.x, g.look.z - pos.z)), -FP.pitchMax, FP.pitchMax), ep = wp - pitch;
    if (Math.abs(err) < 0.004 && Math.abs(ep) < 0.004) { yaw = want; pitch = wp; finish(true); return null; }
    return { mz: 0, dyaw: clamp(err, -FP.turn * dt, FP.turn * dt), dpitch: clamp(ep, -2 * dt, 2 * dt) };
  }
  function finish(ok) { const d = auto && auto.done; auto = null; if (d) d(ok); }

  return {
    setWorld, place, face, step, apply, approach, collide,
    stop: () => finish(false),
    get pos() { return pos; }, get yaw() { return yaw; }, get pitch() { return pitch; }, get scale() { return scale; },
    get speed() { return vel.length() / scale; }, get vel() { return vel; }, get phase() { return phase; }, get walked() { return walked; }, get auto() { return auto; },
    get eye() { return v3(pos.x, eyeY(), pos.z); }, get floor() { return floorY(); }, get forward() { return fwd(); },
    set yaw(v) { yaw = wrap(v); }, set pitch(v) { pitch = clamp(v, -FP.pitchMax, FP.pitchMax); },
  };
}
