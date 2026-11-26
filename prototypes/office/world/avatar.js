// world/avatar.js: a blocky little person with a pose vocabulary. The world decides WHICH pose
// (from the actor's active states, see world/poses.js); this file only knows how a pose looks.
import * as THREE from "three";
import { box, mat, faceTex, lerp, clamp01 } from "./kit.js";

// Pose = joint targets. Angles in radians. sit: 0 standing .. 1 seated.
const P = (o) => ({ sit: 1, lean: 0, headX: 0, headY: 0, aLx: 0, aLz: 0.08, aRx: 0, aRz: -0.08, lLx: 0, lRx: 0, bob: 0, type: 0, eyes: 1, ...o });
export const POSES = {
  stand: P({ sit: 0 }),
  walk: P({ sit: 0, walk: 1 }),
  wave: P({ sit: 0, aRx: -2.6, aRz: -0.3, wave: 1 }),
  idle: P({ lean: -0.32, headX: -0.15, aLx: -2.7, aLz: 0.5, aRx: -2.7, aRz: -0.5, lLx: -1.25, lRx: -1.25, bob: 0.3 }), // leaning back, hands behind head
  typing: P({ lean: 0.18, headX: 0.2, aLx: -1.2, aRx: -1.2, aLz: 0.18, aRz: -0.18, type: 1 }),
  watch: P({ lean: 0.3, headX: 0.05, aLx: -0.9, aRx: -0.9, aLz: 0.35, aRz: -0.35, bob: 0.1 }),          // elbows on desk, watching the screen
  post: P({ turn: -0.45, lean: 0.05, headY: -0.5, headX: -0.25, aRx: -2.2, aRz: 0.2, aLx: -0.5 }),               // reaching to the tube mouth, eyes on the tube
  machine: P({ turn: 0.85, lean: 0.1, headY: 0.35, aLx: -1.3, aRx: -1.5, aRz: 0.1, crank: 1 }),                 // turned to the tool machine, cranking it
  shrug: P({ lean: -0.05, headX: -0.1, aLx: -0.6, aLz: 1.0, aRx: -0.6, aRz: -1.0, shrug: 1 }),
  asleep: P({ lean: 0.65, headX: 0.55, aLx: -1.5, aRx: -1.5, aLz: 0.5, aRz: -0.5, eyes: 0, bob: 0.4 }),
  phone: P({ lean: 0.05, headY: -0.25, aLx: -2.6, aLz: 0.9, aRx: -0.4 }),                          // receiver at the ear, waiting
  phoneWrite: P({ lean: 0.2, headX: 0.25, aLx: -2.6, aLz: 0.9, aRx: -1.15, aRz: -0.1, type: 0.6 }), // receiver at the ear, writing it down
  switchboard: P({ turn: Math.PI, lean: 0.15, headX: -0.1, aLx: -1.9, aRx: -2.2, aLz: 0.25, aRz: -0.25, plug: 1 }), // plugging cables
  wristwatch: P({ lean: -0.05, headX: 0.35, headY: 0.3, aLx: -1.4, aLz: -0.7, aRx: -0.3 }),
  stamp: P({ lean: 0.25, headX: 0.3, aRx: -1.6, aRz: -0.1, stampIt: 1 }),
  clipboard: P({ sit: 0, headX: 0.35, aLx: -1.2, aLz: -0.4, aRx: -0.9, aRz: 0.4 }),
  doze: P({ lean: -0.1, headX: 0.45, aLx: -0.4, aLz: 0.7, aRx: -0.4, aRz: -0.7, eyes: 0, bob: 0.5 }),
  ledger: P({ lean: 0.25, headX: 0.35, aLx: -1.0, aLz: 0.2, aRx: -1.15, aRz: -0.15 }),
  writeLedger: P({ lean: 0.3, headX: 0.4, aLx: -1.0, aLz: 0.2, aRx: -1.25, aRz: -0.1, type: 0.8 }),
};

export function makeAvatar({ shirt = "#5b7bd5", pants = "#3a3f55", skin = "#f0c8a0", hair = "#3b2a20", hairStyle = "short", hat = null, accessory = null, face = {} } = {}) {
  const root = new THREE.Group();
  const hips = new THREE.Group(); root.add(hips);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.13, 0, 0); legR.position.set(0.13, 0, 0);
  for (const [g, x] of [[legL, 0], [legR, 0]]) {
    const thigh = box(0.22, 0.42, 0.24, pants); thigh.position.set(x, -0.21, 0); g.add(thigh);
    const shin = box(0.21, 0.36, 0.22, pants); shin.position.set(x, -0.6, 0); g.add(shin); g.userData.shin = shin;
    const shoe = box(0.23, 0.1, 0.3, "#2a2420"); shoe.position.set(x, -0.8, 0.04); g.add(shoe); g.userData.shoe = shoe;
    hips.add(g);
  }
  const torso = new THREE.Group(); hips.add(torso);
  const body = box(0.54, 0.6, 0.3, shirt); body.position.y = 0.32; torso.add(body);
  const belt = box(0.55, 0.06, 0.31, pants); belt.position.y = 0.04; torso.add(belt);
  const neck = new THREE.Group(); neck.position.y = 0.64; torso.add(neck);
  const headGeoSize = 0.46;
  const faceMap = faceTex({ skin, ...face }), sleepMap = faceTex({ skin, ...face, closed: true });
  const skinM = mat(skin);
  const faceM = new THREE.MeshLambertMaterial({ map: faceMap });
  const head = new THREE.Mesh(new THREE.BoxGeometry(headGeoSize, headGeoSize, headGeoSize), [skinM, skinM, skinM, skinM, faceM, skinM]);
  head.castShadow = true; head.position.y = headGeoSize / 2; neck.add(head);
  // the lid: hair or hat on top. It lifts when you go into this person's head.
  const lid = new THREE.Group(); lid.position.y = headGeoSize; neck.add(lid);
  const lidMesh = new THREE.Group(); lid.add(lidMesh);
  if (hairStyle !== "bald") {
    const top = box(headGeoSize + 0.04, 0.1, headGeoSize + 0.04, hair); top.position.set(0, 0.03, 0); lidMesh.add(top);
    const back = box(headGeoSize + 0.04, hairStyle === "long" ? 0.55 : 0.22, 0.08, hair); back.position.set(0, hairStyle === "long" ? -0.25 : -0.1, -headGeoSize / 2 - 0.02); neck.add(back);
    if (hairStyle === "long") { for (const sx of [-1, 1]) { const side = box(0.06, 0.4, 0.3, hair); side.position.set(sx * (headGeoSize / 2 + 0.03), -0.17 + headGeoSize, -0.08); neck.add(side); } }
    else { for (const sx of [-1, 1]) { const side = box(0.05, 0.14, 0.32, hair); side.position.set(sx * (headGeoSize / 2 + 0.02), headGeoSize - 0.08, -0.07); neck.add(side); } }
  }
  if (hat === "beanie") { const b = box(0.52, 0.2, 0.52, "#e0663a"); b.position.y = 0.1; lidMesh.add(b); const p = box(0.12, 0.08, 0.12, "#f4e0c0"); p.position.y = 0.24; lidMesh.add(p); }
  if (hat === "cap") { const b = box(0.5, 0.14, 0.5, "#2d4e8a"); b.position.y = 0.07; lidMesh.add(b); const v = box(0.4, 0.04, 0.22, "#2d4e8a"); v.position.set(0, 0.02, 0.33); lidMesh.add(v); }
  if (accessory === "headset") { const band = box(0.52, 0.05, 0.08, "#222"); band.position.y = 0.12; lidMesh.add(band); for (const sx of [-1, 1]) { const ear = box(0.08, 0.16, 0.16, "#333"); ear.position.set(sx * 0.27, headGeoSize / 2, 0); neck.add(ear); } const mic = box(0.03, 0.03, 0.22, "#333"); mic.position.set(-0.24, 0.12, 0.16); neck.add(mic); }
  if (accessory === "headphones") { const band = box(0.54, 0.06, 0.1, "#1f8a5a"); band.position.y = 0.1; lidMesh.add(band); for (const sx of [-1, 1]) { const ear = box(0.1, 0.2, 0.2, "#1f8a5a"); ear.position.set(sx * 0.28, headGeoSize / 2, 0); neck.add(ear); } }
  if (accessory === "tie") { const t = box(0.08, 0.36, 0.02, "#b8322c"); t.position.set(0, 0.36, 0.16); torso.add(t); }
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.36, 0.56, 0); armR.position.set(0.36, 0.56, 0);
  for (const g of [armL, armR]) {
    const upper = box(0.17, 0.32, 0.19, shirt); upper.position.y = -0.14; g.add(upper);
    const lower = box(0.16, 0.26, 0.18, shirt); lower.position.y = -0.42; g.add(lower);
    const hand = box(0.15, 0.12, 0.16, skin); hand.position.y = -0.6; g.add(hand); g.userData.hand = hand;
    torso.add(g);
  }
  // a prop the person holds in the right hand (receiver, pen, clipboard); set by the world
  const prop = new THREE.Group(); prop.position.y = -0.66; armR.add(prop);
  const propL = new THREE.Group(); propL.position.y = -0.66; armL.add(propL);

  const a = { root, hips, torso, neck, head, lid, lidMesh, armL, armR, legL, legR, prop, propL, faceM, faceMap, sleepMap, headSize: headGeoSize, cur: { ...POSES.stand } };
  return a;
}

const KEYS = ["turn", "sit", "lean", "headX", "headY", "aLx", "aLz", "aRx", "aRz", "lLx", "lRx", "bob", "type", "eyes", "walk", "wave", "crank", "shrug", "plug", "stampIt"];
export function mixPose(p, q, f) { const o = {}; for (const k of KEYS) o[k] = lerp(p[k] || 0, q[k] || 0, f); return o; }

// apply a (mixed) pose at ambient time `amb` (seconds, drives the little loops)
export function applyPose(a, p, amb, seed = 0) {
  const sit = p.sit;
  const hipY = lerp(0.86, 0.6, sit);
  const breathe = Math.sin(amb * 1.7 + seed) * 0.012;
  a.hips.position.y = hipY + breathe * 0.5;
  // legs: standing straight, sitting thighs forward
  let lL = lerp(0, -1.45, sit) + (p.lLx || 0) * sit * 0.2, lR = lerp(0, -1.45, sit) + (p.lRx || 0) * sit * 0.2;
  const w = p.walk || 0;
  if (w > 0) { const ph = Math.sin(amb * 9); lL += ph * 0.6 * w; lR -= ph * 0.6 * w; a.hips.position.y += Math.abs(Math.cos(amb * 9)) * 0.04 * w; }
  a.legL.rotation.x = lL; a.legR.rotation.x = lR;
  // shins bend down when seated
  for (const g of [a.legL, a.legR]) { const s = g.userData.shin, sh = g.userData.shoe; const k = sit; s.position.set(0, lerp(-0.6, -0.42, k), lerp(0, 0.17, k)); s.rotation.x = lerp(0, 1.45, k); sh.position.set(0, lerp(-0.8, -0.58, k), lerp(0.04, 0.42, k)); sh.rotation.x = lerp(0, 1.45, k); }
  const bob = Math.sin(amb * 0.9 + seed) * 0.05 * (p.bob || 0);
  a.torso.rotation.x = p.lean + bob * 0.5 + breathe;
  a.neck.rotation.x = p.headX + bob;
  a.neck.rotation.y = p.headY + (p.shrug ? Math.sin(amb * 2) * 0.08 * p.shrug : 0);
  const type = p.type || 0;
  const tL = Math.sin(amb * 22 + seed) * 0.12 * type, tR = Math.sin(amb * 22 + 1.7 + seed) * 0.12 * type;
  let aLx = p.aLx + tL, aRx = p.aRx + tR, aLz = p.aLz, aRz = p.aRz;
  if (p.wave) aRz += Math.sin(amb * 8) * 0.35 * p.wave;
  if (p.crank) { aRx += Math.sin(amb * 7) * 0.35 * p.crank; aRz += Math.cos(amb * 7) * 0.15 * p.crank; }
  if (p.plug) { aLx += Math.sin(amb * 3.1) * 0.25 * p.plug; aRx += Math.sin(amb * 2.3 + 1) * 0.3 * p.plug; }
  if (p.stampIt) aRx += Math.max(0, Math.sin(amb * 5)) * 0.5 * p.stampIt;
  if (p.shrug) { a.armL.position.y = 0.56 + 0.05 * p.shrug; a.armR.position.y = 0.56 + 0.05 * p.shrug; } else { a.armL.position.y = 0.56; a.armR.position.y = 0.56; }
  a.armL.rotation.set(aLx, 0, aLz); a.armR.rotation.set(aRx, 0, aRz);
  const eyesOpen = (p.eyes ?? 1) > 0.5 && !(Math.sin(amb * 0.7 + seed * 3) > 0.985);
  const want = eyesOpen ? a.faceMap : a.sleepMap;
  if (a.faceM.map !== want) { a.faceM.map = want; a.faceM.needsUpdate = true; }
}
