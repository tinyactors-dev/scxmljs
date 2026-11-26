// world/people.js: the people of the office, where they are and what they do at playback time s.
import * as THREE from "three";
import { makeAvatar, applyPose, mixPose, POSES } from "./avatar.js";
import { poseFor } from "./poses.js";
import { box, mat, ease, clamp01, lerp } from "./kit.js";
import * as L from "./layout.js";

const WALK = 3.0;   // playback seconds to walk between the door and a desk
const BLEND = 0.35; // playback seconds to change pose

export function buildPeople(scene, sim) {
  const people = {};
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const add = (id, spec) => {
    const a = makeAvatar(spec); a.root.userData.actorId = id; scene.add(a.root);
    a.root.traverse((o) => { if (o.isMesh) o.userData.actorId = id; });
    people[id] = { id, a, ...spec };
    return people[id];
  };
  for (const [id, c] of Object.entries(L.CLIENTS)) add(id, { ...c, face: { glasses: !!c.glasses }, seat: V(L.clientSeat(id)), facing: 0, chart: "client" });
  add("host", { shirt: "#c8b27a", pants: "#4a3b2a", hair: "#4a2f1c", skin: "#eab38c", accessory: "headset", hat: null, seat: V([0, 0, -1.25]), facing: 0, chart: "host" });
  add("director", { shirt: "#e9e4d8", pants: "#2c2f3a", hair: "#7a5a3a", skin: "#f1c7a1", accessory: "tie", seat: V(L.DIRECTOR.stand), facing: Math.PI / 2, chart: "scenario", standing: true });
  add("workspace", { shirt: "#5b6f8a", pants: "#3e5a7a", hair: "#3a3a3a", skin: "#c98e6a", hat: "cap", seat: V(L.STORE.keeper), facing: Math.PI / 2 + 0.5, chart: "workspace", face: { beard: "#5a4030" } });
  add("log", { shirt: "#8a5a6a", pants: "#3a3a3a", hair: "#d8d8d8", skin: "#f0c8a0", seat: V(L.ARCHIVE.seat), facing: -Math.PI / 2, external: true, face: { glasses: true } });

  // props
  const receiver = box(0.1, 0.34, 0.08, "#1d1d1d"); receiver.position.set(0, -0.05, 0.08); people.host.a.propL.add(receiver);
  const clip = new THREE.Group(); clip.position.set(0.05, 0.0, 0.12); clip.rotation.x = -1.2; people.director.a.propL.add(clip);
  clip.add(box(0.36, 0.46, 0.03, "#8a6436")); const page = box(0.3, 0.38, 0.01, "#f6f0de"); page.position.z = 0.02; clip.add(page);
  const pen = box(0.03, 0.03, 0.2, "#2b4a8a"); pen.position.set(0, -0.02, 0.1); people.log.a.prop.add(pen);
  const hostPen = box(0.03, 0.03, 0.2, "#8a2b2b"); hostPen.position.set(0, -0.02, 0.1); people.host.a.prop.add(hostPen);

  // pose timelines: [s, pose] at each configuration change
  const timeline = {}; const confTimes = {};
  for (const e of sim.eventsBetween(-1, sim.duration + 1)) {
    if (e.type !== "config" || !people[e.actor]) continue;
    const p = people[e.actor]; const pose = poseFor(p.chart, e.active);
    if (!pose) continue;
    (timeline[e.actor] ||= []).push([sim.warp(e.at), pose]);
  }
  // reactions: typing when the people at the keyboards hand work in; a reach when a capsule arrives
  const typing = {}, arrivals = {}, logWrites = [], departures = {}, refusals = {};
  for (const m of sim.messagesBetween(-1, sim.duration + 1)) {
    const [s0, s1] = sim.flight(m);
    if (m.from === "stage" && people[m.to]) (typing[m.to] ||= []).push(s1);
    if (people[m.to] && m.name !== "log.batch" && m.from !== "stage") (arrivals[m.to] ||= []).push(s1);
    if (m.to === "log") logWrites.push(s1);
    if (people[m.to] && /rejected/.test(m.name)) (refusals[m.to] ||= []).push(s1);
    if (people[m.from] && m.to !== "log" && m.name !== "log.batch") (departures[m.from] ||= []).push(s0);
  }
  const lastBefore = (arr, s) => { let best = -Infinity; if (arr) for (const x of arr) { if (x <= s) best = x; else break; } return best; };

  // where someone is: walking in after they are spawned, out after they leave
  const door = V(L.DOOR);
  function walkPath(p) {
    const s = p.seat; const pts = [door.clone(), new THREE.Vector3(door.x + 1.2, 0, L.AISLE_Z)];
    if (p.id === "director") pts.push(new THREE.Vector3(s.x, 0, L.AISLE_Z), s.clone());
    else pts.push(new THREE.Vector3(s.x, 0, L.AISLE_Z), new THREE.Vector3(s.x, 0, s.z - 0.6), s.clone());
    const ded = pts.filter((q, i) => i === 0 || q.distanceTo(pts[i - 1]) > 0.3);
    return new THREE.CatmullRomCurve3(ded, false, "catmullrom", 0.1);
  }
  for (const p of Object.values(people)) {
    const a = sim.actor(p.id);
    p.bornS = a && !a.external && a.bornAt > 0 ? sim.warp(a.bornAt) : -Infinity;
    const leaveConf = (timeline[p.id] || []).find(([, pose]) => pose === "leave");
    p.leaveS = leaveConf ? leaveConf[0] : a && a.diedAt != null ? sim.warp(a.diedAt) : Infinity;
    if (p.bornS > -Infinity || p.leaveS < Infinity) p.path = walkPath(p);
  }

  const tmpTarget = new THREE.Vector3();
  function poseAt(p, s) {
    const tl = timeline[p.id];
    if (!tl || !tl.length) return { pose: p.external ? "ledger" : "idle", since: 1e9, prev: null };
    let i = -1; for (let k = 0; k < tl.length; k++) { if (tl[k][0] <= s) i = k; else break; }
    if (i < 0) return { pose: tl[0][1], since: 1e9, prev: null };
    // the time this pose began (skip repeats)
    let j = i; while (j > 0 && tl[j - 1][1] === tl[i][1]) j--;
    return { pose: tl[i][1], since: s - tl[j][0], prev: j > 0 ? tl[j - 1][1] : null };
  }

  function update(s, amb, sel) {
    const info = {};
    for (const p of Object.values(people)) {
      const { a } = p;
      let visible = true, pos = p.seat.clone(), facing = p.facing, walking = 0;
      if (s < p.bornS) visible = false;
      else if (s < p.bornS + WALK && p.path) { const f = clamp01((s - p.bornS) / WALK); pos = p.path.getPointAt(ease(f)); const tg = p.path.getTangentAt(Math.min(0.999, ease(f))); facing = Math.atan2(tg.x, tg.z); walking = f < 0.97 ? 1 : 0; }
      else if (s >= p.leaveS + 0.5 && p.path) {
        const f = clamp01((s - p.leaveS - 0.5) / WALK); if (f >= 1) visible = false; else { const u = 1 - ease(f); pos = p.path.getPointAt(u); const tg = p.path.getTangentAt(Math.min(0.999, Math.max(0.001, u))); facing = Math.atan2(-tg.x, -tg.z); walking = 1; }
      }
      a.root.visible = visible;
      info[p.id] = { visible, pose: null };
      if (!visible) continue;
      // pose
      let { pose, since, prev } = poseAt(p, s);
      if (pose === "leave") { pose = "stand"; }
      let P = POSES[pose] || POSES.idle;
      if (prev && since < BLEND && POSES[prev] && prev !== "leave") P = mixPose(POSES[prev], P, ease(since / BLEND));
      // just after a walk-in the person sits down
      if (walking) P = mixPose(P, POSES.walk, 1);
      else if (p.path && s >= p.bornS && s < p.bornS + WALK + BLEND) P = mixPose(POSES.walk, P, ease((s - p.bornS - WALK) / BLEND));
      if (p.standing && !walking) P = { ...P, sit: 0 };
      // reactions layered on top
      if (!walking && pose !== "asleep") {
        const ty = s - lastBefore(typing[p.id], s);
        if (ty >= 0 && ty < 1.0) P = mixPose(P, POSES.typing, Math.min(1, ty / 0.15) * (ty > 0.8 ? (1 - ty) / 0.2 : 1));
        const ar = s - lastBefore(arrivals[p.id], s);
        if (ar >= 0 && ar < 0.55) { const k = Math.sin((ar / 0.55) * Math.PI); P = { ...P, aRx: lerp(P.aRx, -2.1, k), aRz: lerp(P.aRz, 0.35, k), headY: lerp(P.headY, -0.6, k * 0.7) }; }
        const rf = s - lastBefore(refusals[p.id], s);
        if (rf >= 0 && rf < 1.8) P = mixPose(P, POSES.shrug, Math.min(1, rf / 0.2) * Math.min(1, (1.8 - rf) / 0.3));
        if (p.id === "log") { const lw = s - lastBefore(logWrites, s); P = mixPose(POSES.ledger, POSES.writeLedger, lw >= 0 && lw < 0.7 ? 1 : 0); }
      }
      applyPose(a, P, amb, p.id.length * 1.3);
      // the host turns to the switchboard behind him while he plugs calls through
      const turn = walking ? 0 : P.turn || 0;
      a.root.position.copy(pos); a.root.rotation.y = facing + turn;
      // the lid lifts when the visitor goes into this head
      const lift = sel && sel.id === p.id ? sel.lid : 0;
      a.lid.position.y = a.headSize + lift * 0.28; a.lid.rotation.x = -lift * 0.9; a.lid.position.z = -lift * 0.12;
      const hide = sel && sel.id === p.id && sel.skinHidden;
      a.head.visible = !hide; a.lidMesh.visible = !hide; a.hips.visible = !hide;
      info[p.id].pose = pose;
    }
    return info;
  }
  function headCenter(id, out = new THREE.Vector3()) { const p = people[id]; if (!p) return null; p.a.head.updateWorldMatrix(true, false); return p.a.head.getWorldPosition(out); }
  return { people, update, headCenter, timeline };
}
