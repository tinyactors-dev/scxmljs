// world/people.js: everyone who works here, pooled by seat. An actor's life takes a seat (plan),
// walks in from outside through the door (or, an invoked child, from its parent's desk to the visitor's stool),
// works there, and walks out when it ends; the next occupant of that seat reuses the avatar.
// Posture comes from core/situation.js (no per-system table); office.json may map states to poses.
// A mass end at one instant (a process kill) is a blackout: everyone vanishes in the dark, and the
// reborn walk back in.
import * as THREE from "three";
import { makeAvatar, applyPose, mixPose, POSES, generatedLook } from "./avatar.js";
import { SPOT, CHAIR } from "./layout.js";
import { box, ease, clamp01, lerp, hashStr, hueColor } from "./kit.js";
import { WALK, LEAVE } from "../core/plan.js";

const BLEND = 0.55;   // seconds to ease from one pose to the next
const REACT_GAP = 3.0; // a reaction plays once per event; events closer than this share one

export function buildPeople(scene, sim, plan, cfg = {}, stationById = new Map(), desks = null) {
  const keyOf = (s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`;
  const V = (x, z) => new THREE.Vector3(x, 0, z);
  // the door is a real opening in the south wall (world/building.js): people come from outside, straight through it,
  // and leave the same way; `doorTraffic(s)` says when the door should be open for them
  const dz = plan.door.z, dx = plan.door.x;
  const outside = V(dx, dz + 3.2), stepOut = V(dx, dz + 0.9), stepIn = V(dx, dz - 0.9), door = V(dx, dz - 1.9);
  const W = sim.warp;

  // ---- mass ends: blackouts (from the plan) ----
  const blackouts = plan.blackouts, killed = plan.killed;
  const darkAt = (s) => { for (const [a, b] of blackouts) { if (s >= a && s < b) return Math.min(1, (s - a) / 0.25, (b - s) / 0.4); } return 0; };

  // ---- occupancies per seat ----
  const seats = new Map(); // key -> {seat, occ:[], avatar}
  for (const a of sim.actors) {
    if (a.external) continue;
    sim.lifetimes(a.id).forEach(([b, e], i) => {
      const seat = plan.seatOfLife(a.id, i); if (!seat) return;
      const key = keyOf(seat);
      if (!seats.has(key)) seats.set(key, { key, seat, occ: [] });
      const bornS = b <= 0 ? -Infinity : W(b), endS = e === Infinity ? Infinity : W(e);
      const kill = plan.vanishes(a.id, i); const reason = plan.reasonOf(a.id, i);
      let path = null;
      if (seat.visitor && seat.parentSeat) path = curve([V(seat.parentSeat.x + 0.6, seat.parentSeat.z + 0.5), V(seat.x, seat.z - 0.7), V(seat.x, seat.z)]);
      else if (seat.hub) path = curve([outside, stepOut, stepIn, door, V(seat.x, door.z), V(seat.x, seat.z - 3.4), V(seat.x, seat.z - 1.0), V(seat.x, seat.z)]);
      else { // round the bay and along the aisle behind the row, not across the desks
        const g = plan.groups.find((x) => x.id === plan.groupOf(a.id)); const az = seat.z - 1.6;
        const side = g && g.kind === "bay" ? (dx > g.x ? g.x + g.w / 2 + 0.5 : g.x - g.w / 2 - 0.5) : null;
        path = curve(side === null ? [outside, stepOut, stepIn, door, V(seat.x, seat.z - 1.7), V(seat.x, seat.z - 0.6), V(seat.x, seat.z)] : [outside, stepOut, stepIn, door, V(side, Math.max(az, Math.min(door.z, g.z + g.d / 2 + 0.6))), V(side, az), V(seat.x, az), V(seat.x, seat.z - 0.6), V(seat.x, seat.z)]);
      }
      // done: tidy up and walk out; cancelled: fetched away by the parent (out past its desk)
      const ps = seat.parentSeat || (sim.actor(a.id).parent && plan.seatOf(sim.actor(a.id).parent, e === Infinity ? b : e - 1e-6));
      const outPath = reason === "cancelled" && ps && ps.x !== undefined ? curve([V(seat.x, seat.z), V(ps.x + 0.7, ps.z + 1.3), V(ps.x + 0.7, ps.z - 1.6), door, stepIn, stepOut, outside]) : seat.visitor ? curve([V(seat.x, seat.z), V(seat.x + 0.9, seat.z + 0.9), door, stepIn, stepOut, outside]) : null;
      seats.get(key).occ.push({ id: a.id, life: i, bornS, endS, kill, reason, path, outPath });
    });
  }
  function lerpAngle(a, b, f) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * clamp01(f); }
  function curve(pts) { const ded = pts.filter((q, i) => i === 0 || q.distanceTo(pts[i - 1]) > 0.3); if (ded.length < 2) ded.push(ded[0].clone().add(new THREE.Vector3(0.01, 0, 0.01))); return new THREE.CatmullRomCurve3(ded, false, "catmullrom", 0.1); }
  for (const s of seats.values()) {
    s.occ.sort((x, y) => x.bornS - y.bornS);
    const look = (id) => cfg.characters?.[id] || { ...generatedLook(id, sim.actor(id)?.chart, hashStr, hueColor), ...(id === plan.hub ? { accessory: "headset" } : {}) };
    s.avatar = makeAvatar(look(s.occ[0].id)); s.look = look;
    s.avatar.root.traverse((o) => { if (o.isMesh) o.userData.seatKey = s.key; });
    const rec = new THREE.Group(); { const h = box(0.07, 0.3, 0.07, "#1d1d1d"); h.position.set(0, 0.02, 0); rec.add(h); for (const y of [-0.12, 0.15]) { const c = box(0.1, 0.08, 0.1, "#1d1d1d"); c.position.set(0, y, 0.03); rec.add(c); } } rec.position.set(0, -0.01, 0.1); rec.visible = false; s.avatar.prop.add(rec); s.receiver = rec;
    const clip = new THREE.Group(); { const b = box(0.24, 0.015, 0.3, "#8a6a3a"); clip.add(b); const pp = box(0.2, 0.004, 0.25, "#f6f0de"); pp.position.y = 0.01; clip.add(pp); } clip.visible = false; scene.add(clip); s.clip = clip;
    s.desk = desks ? desks.desks.get(s.key) : null;
    scene.add(s.avatar.root);
  }

  // ---- pose from the situation (and office.json's state -> pose) ----
  const poseCfg = cfg.poses || {};
  function poseOf(id, t, s) {
    const a = sim.actor(id); const act = sim.activeAt(id, t);
    const map = { ...(poseCfg["*"] || {}), ...(poseCfg[a.chart] || {}) };
    for (const st of Object.keys(map)) if (act.includes(st)) return { pose: map[st], since: 0, sit: sim.situationAt(id, t) };
    const sit = sim.situationAt(id, t); const since = s - W(sit.since);
    let pose = "idle";
    if (sit.kind === "working") { const st = sit.detail?.with && stationById.get(sit.detail.with); pose = st && st.attachedTo === id && st.kind !== "user" ? "machine" : "typing"; }
    else if (sit.kind === "waiting") pose = sit.detail?.with === "timer" ? "wristwatch" : sim.actor(sit.detail?.with)?.external ? "phone" : since < 1.6 ? "post" : "wristwatch";
    else if (sit.kind === "exception") pose = "panic";
    else if (sit.kind === "done") pose = "doneWave";
    return { pose, since, sit };
  }

  // reactions: a reach when a capsule arrives, typing when the people at the keyboards hand work in,
  // a shrug when something comes back refused
  const arrivals = new Map(), typing = new Map(), refusals = new Map();
  const userish = (id) => /user|stage|input|keyboard|operator/i.test(`${sim.actor(id)?.kind || ""} ${id}`) && sim.actor(id)?.external;
  for (const m of sim.messagesBetween(-1, sim.duration + 1)) { const s1 = sim.flight(m)[1]; for (const to of sim.recipients(m)) { if (!sim.actor(to) || sim.actor(to).external) continue; if (userish(m.from)) (typing.get(to) || typing.set(to, []).get(to)).push(s1); else if (!/log/i.test(m.name)) (arrivals.get(to) || arrivals.set(to, []).get(to)).push(s1); if (/reject|refus|denied|forbidden/i.test(m.name)) (refusals.get(to) || refusals.set(to, []).get(to)).push(s1); } }
  const thin = (m) => { for (const [k, arr] of m) { arr.sort((a, b) => a - b); const kept = []; for (const x of arr) if (!kept.length || x - kept[kept.length - 1] >= REACT_GAP) kept.push(x); m.set(k, kept); } };
  thin(arrivals); thin(refusals);
  const lastBefore = (arr, s) => { let best = -Infinity; if (arr) for (const x of arr) { if (x <= s) best = x; else break; } return best; };

  const occAt = (seat, s) => { let cur = null; for (const o of seat.occ) { const start = o.bornS === -Infinity ? -Infinity : o.bornS; const stop = o.endS === Infinity ? Infinity : o.endS + (o.kill ? 0.3 : LEAVE); if (s >= start && s < stop) cur = o; } return cur; };
  // who is at a seat now (present = sitting there, not walking)
  function occupantOf(key, s) { const seat = seats.get(key); if (!seat) return null; const o = occAt(seat, s); if (!o) return null; const present = s >= (o.bornS === -Infinity ? -Infinity : o.bornS + (o.path ? WALK : 0)) && s < o.endS; return { id: o.id, present, o }; }

  // the pose a seat's furniture allows: a visitor's stool has no desk, a hub's exchange has a counter
  const REACH = POSES.reach;
  function adapt(pose, seat) { if (!seat.visitor) return pose; return { typing: "clipboard", watch: "clipboard", post: "idle", machine: "clipboard", phoneWrite: "phone" }[pose] || pose; }
  const V3 = new THREE.Vector3();
  function update(s, amb) {
    const t = sim.unwarp(s); const dark = darkAt(s);
    for (const seat of seats.values()) {
      const av = seat.avatar; const o = occAt(seat, s); const S = seat.seat;
      const chairAside = (k, turn = 0) => { const ch = seat.desk && seat.desk.chair; if (!ch) return; const f = S.facing || 0, c = Math.cos(f), sn = Math.sin(f); const x = CHAIR.aside[0] * k, z = CHAIR.aside[1] * k; ch.position.set(S.x + x * c + z * sn, 0, S.z - x * sn + z * c); ch.rotation.y = f + k * 0.5 + turn; }; // a swivel chair: it turns with its sitter
      if (!o || (o.kill && s >= o.endS + 0.25)) { av.root.visible = false; seat.current = null; seat.clip.visible = false; chairAside(1); continue; }
      if (seat.current !== o) { seat.current = o; av.style(seat.look(o.id)); av.root.traverse((m) => { if (m.isMesh) m.userData.actorId = o.id; }); }
      av.root.visible = true;
      let pos = V(S.x, S.z), facing = S.facing || 0, walking = 0;
      if (o.bornS > -Infinity && s < o.bornS + WALK) { const f = clamp01((s - o.bornS) / WALK); const u = ease(f); pos = o.path.getPointAt(u); const tg = o.path.getTangentAt(Math.min(0.999, u)); facing = Math.atan2(tg.x, tg.z); walking = f < 0.97 ? 1 : 0; if (!walking) facing = lerpAngle(facing, S.facing || 0, (f - 0.97) / 0.03); }
      else if (s >= o.endS && !o.kill) {
        const f = clamp01((s - o.endS - 0.6) / (LEAVE - 0.8)); const p = o.outPath || o.path; const reverse = !o.outPath; const u = reverse ? 1 - ease(f) : ease(f);
        if (f > 0) { pos = p.getPointAt(u); const tg = p.getTangentAt(Math.min(0.999, Math.max(0.001, u))); facing = reverse ? Math.atan2(-tg.x, -tg.z) : Math.atan2(tg.x, tg.z); walking = 1; }
      }
      const tt = Math.min(t, o.endS === Infinity ? t : sim.unwarp(o.endS) - 1e-6);
      let { pose, since, sit } = poseOf(o.id, tt, s); pose = adapt(pose, S);
      let P = POSES[pose] || POSES.idle;
      if (since < BLEND) { const prev = adapt(poseOf(o.id, sim.unwarp(Math.max(0, s - since - 0.05)), s - since - 0.05).pose, S); if (POSES[prev] && prev !== pose) P = mixPose(POSES[prev], P, ease(since / BLEND)); }
      // arriving: walk, then stand at the desk, then sit down (the chair comes in under them)
      if (walking) P = POSES.walk;
      else if (o.bornS > -Infinity && s < o.bornS + WALK + 0.9) { const k = (s - o.bornS - WALK) / 0.9; P = mixPose(POSES.stand, P, ease(k)); }
      else if (s >= o.endS && !o.kill) P = mixPose(P, POSES.stand, ease(clamp01((s - o.endS) / 0.6))); // leaving: stand up first
      if (!walking && pose !== "asleep" && s < o.endS) {
        const ty = s - lastBefore(typing.get(o.id), s); if (ty >= 0 && ty < 1.2 && !S.visitor) P = mixPose(P, POSES.typing, ease(Math.min(1, ty / 0.3)) * (ty > 0.9 ? 1 - ease((ty - 0.9) / 0.3) : 1));
        const ar = s - lastBefore(arrivals.get(o.id), s); if (ar >= 0 && ar < 1.4 && !S.visitor && REACH) { const k = ar < 0.45 ? ease(ar / 0.45) : ar > 0.95 ? 1 - ease((ar - 0.95) / 0.45) : 1; P = mixPose(P, { ...REACH, sit: P.sit, chair: P.chair }, k); }
        const rf = s - lastBefore(refusals.get(o.id), s); if (rf >= 0 && rf < 1.8) P = mixPose(P, POSES.shrug, ease(Math.min(1, rf / 0.3)) * ease(Math.min(1, (1.8 - rf) / 0.4)));
      }
      if (S.visitor && !walking) P = { ...P, sit: Math.max(P.sit, s >= o.endS ? P.sit : 1), chair: 0 };
      seat.receiver.visible = (pose === "phone" || pose === "phoneWrite") && !walking;
      av.root.position.copy(pos); av.root.rotation.y = facing;
      applyPose(av, P, amb, hashStr(o.id) % 7);
      chairAside(walking ? 1 : clamp01(P.chair), walking ? 0 : P.turn || 0);
      seat.clip.visible = pose === "clipboard" && !walking; if (seat.clip.visible) { av.root.localToWorld(seat.clip.position.set(0, 0.7, 0.33)); seat.clip.rotation.set(0, facing, 0); }
      seat.pose = pose; seat.sit = sit; seat.P = P;
    }
    return dark;
  }
  // where an occupant is at s while walking in or out (null: seated, or not walking)
  function walkPos(o, s) {
    if (o.bornS > -Infinity && o.path && s >= o.bornS && s < o.bornS + WALK) return o.path.getPointAt(ease(clamp01((s - o.bornS) / WALK)));
    if (s >= o.endS && !o.kill && s < o.endS + LEAVE) { const f = clamp01((s - o.endS - 0.6) / (LEAVE - 0.8)); if (f <= 0) return null; const p = o.outPath || o.path; return p.getPointAt(o.outPath ? ease(f) : 1 - ease(f)); }
    return null;
  }
  /** is anyone at the door now or about to be (within `ahead` playback seconds): the door opens ahead of them */
  function doorTraffic(s, ahead = 0.9, r = 2.0) {
    for (const seat of seats.values()) for (const o of seat.occ) {
      if (!(s >= o.bornS - ahead && s < o.bornS + WALK) && !(s >= o.endS && s < o.endS + LEAVE)) continue;
      for (const k of [0, ahead / 2, ahead]) { const p = walkPos(o, s + k); if (p && Math.hypot(p.x - dx, p.z - dz) < r) return true; }
    }
    return false;
  }
  // what the camera keeps out of: a box round everyone in the room now
  function boxes(skipId) { const out = []; for (const seat of seats.values()) { const r = seat.avatar.root; if (!r.visible || !seat.current || seat.current.id === skipId) continue; const h = seat.P && seat.P.sit > 0.5 ? 1.95 : 2.35; /* head top plus a hand's width */ out.push([new THREE.Vector3(r.position.x - 0.36, 0, r.position.z - 0.36), new THREE.Vector3(r.position.x + 0.36, h, r.position.z + 0.36)]); } return out; }
  const seatOfActor = (id, s) => { for (const seat of seats.values()) { const o = occAt(seat, s); if (o && o.id === id) return seat; } return null; };
  function headCenter(id, s, out = new THREE.Vector3()) { const seat = seatOfActor(id, s); if (!seat) return null; seat.avatar.head.updateWorldMatrix(true, false); return seat.avatar.head.getWorldPosition(out); }
  function facingOf(id, s) { const seat = seatOfActor(id, s); return seat ? seat.avatar.root.rotation.y + (seat.avatar.body.rotation.y || 0) : 0; }
  return { seats, update, occupantOf, headCenter, facingOf, seatOfActor, boxes, doorTraffic, blackouts, darkAt, roots: () => [...seats.values()].map((x) => x.avatar.root) };
}
