// world/people.js: everyone who works here, pooled by seat. An actor's life takes a seat (plan),
// walks in from the door (or, an invoked child, from its parent's desk to the visitor's stool),
// works there, and walks out when it ends; the next occupant of that seat reuses the avatar.
// Posture comes from core/situation.js (no per-system table); office.json may map states to poses.
// A mass end at one instant (a process kill) is a blackout: everyone vanishes in the dark, and the
// reborn walk back in.
import * as THREE from "three";
import { makeAvatar, applyPose, mixPose, POSES, generatedLook } from "./avatar.js";
import { box, ease, clamp01, lerp, hashStr, hueColor } from "./kit.js";
import { WALK, LEAVE } from "../core/plan.js";

const BLEND = 0.35;

export function buildPeople(scene, sim, plan, cfg = {}, stationById = new Map()) {
  const keyOf = (s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`;
  const V = (x, z) => new THREE.Vector3(x, 0, z);
  const door = V(plan.door.x + 0.3, plan.door.z);
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
      else if (seat.hub) path = curve([door, V(door.x + 1.4, door.z), V(seat.x, door.z), V(seat.x, seat.z - 3.4), V(seat.x, seat.z - 1.0), V(seat.x, seat.z)]);
      else path = curve([door, V(door.x + 1.4, door.z), V(seat.x, seat.z - 1.7), V(seat.x, seat.z - 0.6), V(seat.x, seat.z)]);
      // done: tidy up and walk out; cancelled: fetched away by the parent (out past its desk)
      const ps = seat.parentSeat || (sim.actor(a.id).parent && plan.seatOf(sim.actor(a.id).parent, e === Infinity ? b : e - 1e-6));
      const outPath = reason === "cancelled" && ps && ps.x !== undefined ? curve([V(seat.x, seat.z), V(ps.x + 0.7, ps.z + 1.3), V(ps.x + 0.7, ps.z - 1.6), V(door.x + 1.4, door.z), door]) : seat.visitor ? curve([V(seat.x, seat.z), V(seat.x + 0.9, seat.z + 0.9), V(door.x + 1.4, door.z), door]) : null;
      seats.get(key).occ.push({ id: a.id, life: i, bornS, endS, kill, reason, path, outPath });
    });
  }
  function curve(pts) { const ded = pts.filter((q, i) => i === 0 || q.distanceTo(pts[i - 1]) > 0.3); if (ded.length < 2) ded.push(ded[0].clone().add(new THREE.Vector3(0.01, 0, 0.01))); return new THREE.CatmullRomCurve3(ded, false, "catmullrom", 0.1); }
  for (const s of seats.values()) {
    s.occ.sort((x, y) => x.bornS - y.bornS);
    const look = (id) => cfg.characters?.[id] || { ...generatedLook(id, sim.actor(id)?.chart, hashStr, hueColor), ...(id === plan.hub ? { accessory: "headset" } : {}) };
    s.avatar = makeAvatar(look(s.occ[0].id)); s.look = look;
    s.avatar.root.traverse((o) => { if (o.isMesh) o.userData.seatKey = s.key; });
    const rec = box(0.1, 0.34, 0.08, "#1d1d1d"); rec.position.set(0, -0.05, 0.08); rec.visible = false; s.avatar.propL.add(rec); s.receiver = rec;
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
    if (sit.kind === "working") pose = sit.detail?.with && stationById.get(sit.detail.with)?.attachedTo === id ? "machine" : "typing";
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
  const lastBefore = (arr, s) => { let best = -Infinity; if (arr) for (const x of arr) { if (x <= s) best = x; else break; } return best; };

  const occAt = (seat, s) => { let cur = null; for (const o of seat.occ) { const start = o.bornS === -Infinity ? -Infinity : o.bornS; const stop = o.endS === Infinity ? Infinity : o.endS + (o.kill ? 0.3 : LEAVE); if (s >= start && s < stop) cur = o; } return cur; };
  // who is at a seat now (present = sitting there, not walking)
  function occupantOf(key, s) { const seat = seats.get(key); if (!seat) return null; const o = occAt(seat, s); if (!o) return null; const present = s >= (o.bornS === -Infinity ? -Infinity : o.bornS + (o.path ? WALK : 0)) && s < o.endS; return { id: o.id, present, o }; }

  function update(s, amb, sel) {
    const t = sim.unwarp(s); const dark = darkAt(s);
    for (const seat of seats.values()) {
      const av = seat.avatar; const o = occAt(seat, s);
      if (!o || (o.kill && s >= o.endS + 0.25)) { av.root.visible = false; seat.current = null; continue; }
      if (seat.current !== o) { seat.current = o; av.style(seat.look(o.id)); av.root.traverse((m) => { if (m.isMesh) m.userData.actorId = o.id; }); }
      av.root.visible = true;
      const S = seat.seat; let pos = V(S.x, S.z), facing = S.facing || 0, walking = 0;
      if (o.bornS > -Infinity && s < o.bornS + WALK) { const f = clamp01((s - o.bornS) / WALK); const u = ease(f); pos = o.path.getPointAt(u); const tg = o.path.getTangentAt(Math.min(0.999, u)); facing = Math.atan2(tg.x, tg.z); walking = f < 0.97 ? 1 : 0; }
      else if (s >= o.endS && !o.kill) {
        const f = clamp01((s - o.endS - 0.4) / (LEAVE - 0.6)); const p = o.outPath || o.path; const reverse = !o.outPath; const u = reverse ? 1 - ease(f) : ease(f);
        if (f > 0) { pos = p.getPointAt(u); const tg = p.getTangentAt(Math.min(0.999, Math.max(0.001, u))); facing = reverse ? Math.atan2(-tg.x, -tg.z) : Math.atan2(tg.x, tg.z); walking = 1; }
      }
      const tt = Math.min(t, o.endS === Infinity ? t : sim.unwarp(o.endS) - 1e-6);
      let { pose, since, sit } = poseOf(o.id, tt, s);
      let P = POSES[pose] || POSES.idle;
      if (since < BLEND) { const prev = poseOf(o.id, sim.unwarp(Math.max(0, s - since - 0.05)), s - since - 0.05).pose; if (POSES[prev] && prev !== pose) P = mixPose(POSES[prev], P, ease(since / BLEND)); }
      if (walking) P = POSES.walk;
      else if (o.bornS > -Infinity && s < o.bornS + WALK + BLEND) P = mixPose(POSES.walk, P, ease((s - o.bornS - WALK) / BLEND));
      else if (s >= o.endS && !o.kill) P = mixPose(P, POSES.stand, clamp01((s - o.endS) / 0.4));
      if (!walking && pose !== "asleep" && s < o.endS) {
        const ty = s - lastBefore(typing.get(o.id), s); if (ty >= 0 && ty < 1.0) P = mixPose(P, POSES.typing, Math.min(1, ty / 0.15) * (ty > 0.8 ? (1 - ty) / 0.2 : 1));
        const ar = s - lastBefore(arrivals.get(o.id), s); if (ar >= 0 && ar < 0.55) { const k = Math.sin((ar / 0.55) * Math.PI); P = { ...P, aRx: lerp(P.aRx, -2.1, k), aRz: lerp(P.aRz, 0.35, k), headY: lerp(P.headY, -0.6, k * 0.7) }; }
        const rf = s - lastBefore(refusals.get(o.id), s); if (rf >= 0 && rf < 1.8) P = mixPose(P, POSES.shrug, Math.min(1, rf / 0.2) * Math.min(1, (1.8 - rf) / 0.3));
      }
      seat.receiver.visible = pose === "phone" && !walking;
      applyPose(av, P, amb, hashStr(o.id) % 7);
      av.root.position.copy(pos); av.root.rotation.y = facing + (walking ? 0 : P.turn || 0);
      const lift = sel && sel.id === o.id ? sel.lid : 0;
      av.lid.position.y = av.headSize + lift * 0.28; av.lid.rotation.x = -lift * 0.9; av.lid.position.z = -lift * 0.12;
      const hide = sel && sel.id === o.id && sel.skinHidden; av.hips.visible = !hide;
      seat.pose = pose; seat.sit = sit;
    }
    return dark;
  }
  const seatOfActor = (id, s) => { for (const seat of seats.values()) { const o = occAt(seat, s); if (o && o.id === id) return seat; } return null; };
  function headCenter(id, s, out = new THREE.Vector3()) { const seat = seatOfActor(id, s); if (!seat) return null; seat.avatar.head.updateWorldMatrix(true, false); return seat.avatar.head.getWorldPosition(out); }
  function facingOf(id, s) { const seat = seatOfActor(id, s); return seat ? seat.avatar.root.rotation.y : 0; }
  return { seats, update, occupantOf, headCenter, facingOf, seatOfActor, blackouts, darkAt, roots: () => [...seats.values()].map((x) => x.avatar.root) };
}
