// world/avatar.js: a blocky little person with a real joint hierarchy and a pose vocabulary.
//
//   root (the seat: position + facing; a pose's targets are in this frame, see world/layout.js)
//    └ body (turns in the chair)
//       └ hips ─ legs: thigh ─ knee ─ shin, shoe
//          └ torso (lean, twist) ─ body block, shoulder caps, belt, tie
//              ├ neck (a visible neck) ─ head (look-at, limited) ─ face, hair, the lid (a hinged hatch)
//              └ shoulder ─ upper arm ─ elbow ─ forearm ─ wrist ─ hand (prop)
//
// Arms are placed with two-bone IK onto hand targets and never stretch: limb lengths are fixed, a
// target out of reach first makes the torso lean and twist toward it (up to a limit), then the
// hand stops short. The head looks at a point with a limited neck (no roll), so the face stays
// toward what the person attends to. A pose is DATA (targets, angles); mixPose lerps two of them,
// so transitions are eased by the caller. tools/inspect.html checks every pose for intersections.
import * as THREE from "three";
import { box, mat, faceTex, lerp, clamp01 } from "./kit.js";
import { SPOT, CHAIR, MODEL, DESK } from "./layout.js";

export const RIG = {
  HS: 0.46, hipStand: 0.88, hipSit: 0.545, thigh: 0.38, shin: 0.46,
  shoulder: [0.355, 0.53, 0], upper: 0.3, fore: 0.27, hand: 0.06,
  neckY: 0.62, neckH: 0.07,
  get reach() { return this.upper + this.fore + this.hand; },
  yaw: 1.05, pitchUp: 0.45, pitchDown: 0.5, // neck limits
  leanMax: 0.42, twistMax: 0.6,
};
const K = SPOT.keyboard, BK = SPOT.basket, HT = SPOT.hatch, PH = SPOT.phone;
const screen = [MODEL.x - 0.34, DESK.topY + 0.3, MODEL.z - 0.06]; // eyes on their machines (the tabletop model, world/models.js), a little to the right, clear of the left arm reaching for the basket
// a pose: sit 0 standing .. 1 seated; turn = body yaw in the chair; lean, twist = torso; look = point
// (seat frame) or null (ahead); L/R = hand targets (seat frame; L is the person's left, on +x);
// pL/pR = elbow pole directions; shrug lifts the shoulders; eyes 0 closed; the rest drive loops.
const P = (o) => ({ sit: 1, turn: 0, lean: 0.04, twist: 0, look: [0, 1.45, 3], L: [0.16, 0.76, 0.4], R: [-0.16, 0.76, 0.4], pL: [1, -0.5, -0.3], pR: [-1, -0.5, -0.3], shrug: 0, eyes: 1, bob: 0, type: 0, walk: 0, wave: 0, crank: 0, chair: 0, alarm: 0, ...o });
const STAND = { sit: 0, chair: 1, lean: 0, L: [0.45, 0.83, 0.08], R: [-0.45, 0.83, 0.08], pL: [0.7, -0.2, -1], pR: [-0.7, -0.2, -1], look: [0, 1.75, 3] };
const KY = K[1] + 0.1;
export const POSES = {
  stand: P(STAND),
  walk: P({ ...STAND, walk: 1 }),
  // idle: leaning back, hands resting in the lap, looking up a little
  idle: P({ lean: -0.1, L: [0.18, 0.71, 0.3], R: [-0.18, 0.71, 0.3], pL: [1, -0.4, 0.2], pR: [-1, -0.4, 0.2], look: [0.3, 1.9, 3], bob: 0.3 }),
  // typing at the keyboard, eyes on the screen
  typing: P({ lean: 0.12, L: [K[0] + 0.14, KY, K[2] - 0.02], R: [K[0] - 0.14, KY, K[2] - 0.02], pL: [1, -0.15, -0.5], pR: [-1, -0.15, -0.5], look: screen, type: 1 }),
  watch: P({ lean: 0.12, L: [0.22, K[1] + 0.09, 0.52], R: [-0.22, K[1] + 0.09, 0.52], pL: [1, -0.15, -0.5], pR: [-1, -0.15, -0.5], look: screen, bob: 0.1 }),
  // waiting on another actor: turned to the in-basket, a hand on its rim, eyes on the hatch
  post: P({ lean: 0.1, twist: 0.3, L: [BK[0] - 0.14, BK[1] + 0.16, BK[2] - 0.13], R: [-0.34, 0.68, 0.12], pL: [1, -0.4, -0.3], pR: [-0.6, 0, -1], look: [HT[0], 1.38, HT[2]] }),
  // cranking the machine beside the desk (the crank's circle is added to L); the other hand on the thigh
  machine: P({ turn: 0.8, lean: 0.12, L: [0.62, 0.78, 0.05], R: [-0.14, 0.72, 0.34], pL: [0.2, -0.4, -1], pR: [-0.9, -0.3, 0.2], look: [0.85, 1.0, 0.05], crank: 1 }),
  shrug: P({ lean: -0.04, L: [0.46, 0.96, 0.3], R: [-0.46, 0.96, 0.3], pL: [1, -0.8, -0.3], pR: [-1, -0.8, -0.3], shrug: 1, look: [0, 1.5, 3] }),
  asleep: P({ lean: -0.1, L: [0.18, 0.71, 0.3], R: [-0.18, 0.71, 0.3], pL: [1, -0.4, 0.2], pR: [-1, -0.4, 0.2], look: [0, 0.75, 1.5], eyes: 0, bob: 0.4 }),
  // waiting on an external: the receiver at the right ear, the other hand on the desk
  phone: P({ lean: 0.04, R: [-0.33, 1.42, 0.1], L: [0.2, KY, 0.55], pR: [-1, -0.8, 0.1], pL: [1, -0.15, -0.5], look: [-0.4, 1.4, 3] }),
  phoneWrite: P({ lean: 0.12, R: [-0.33, 1.42, 0.12], L: [0.16, KY, 0.6], pR: [-1, -0.8, 0.1], pL: [1, -0.15, -0.5], look: [0.16, 0.76, 0.62], type: 0.6 }),
  // waiting on the clock: the left wrist raised in front of the chest, eyes on it; the other hand on the desk
  wristwatch: P({ lean: 0.02, L: [0.16, 1.12, 0.42], R: [-0.24, KY, 0.55], pL: [1, -0.6, -0.1], pR: [-1, -0.15, -0.5], look: [0.16, 1.12, 0.44] }),
  // an exception: leaning back, hands thrown up beside the head (palms out), face visible; the desk's red lamp is lit
  panic: P({ lean: -0.13, L: [0.46, 1.64, 0.16], R: [-0.46, 1.64, 0.16], pL: [1, -0.4, -0.3], pR: [-1, -0.4, -0.3], look: [0, 1.6, 3], shrug: 1, alarm: 1 }),
  doneWave: P({ ...STAND, R: [-0.44, 1.74, 0.12], pR: [-1, -0.3, -0.4], wave: 1 }),
  // a visitor's stool has no desk: work happens on a clipboard on the lap
  clipboard: P({ lean: 0.16, L: [0.16, 0.74, 0.32], R: [-0.1, 0.76, 0.32], pL: [1, -0.4, 0.2], pR: [-1, -0.4, 0.2], look: [0, 0.72, 0.36], type: 0.5 }),
};
// a capsule arrived: reach into the in-basket once, eyes on it
POSES.reach = P({ ...POSES.post, pL: [1, -0.7, -0.2], lean: 0.24, twist: 0.5, L: [BK[0] - 0.05, BK[1] + 0.12, BK[2] - 0.03], look: [BK[0], BK[1] + 0.3, BK[2] + 0.2] });
// names office.json may use from the earlier vocabulary
Object.assign(POSES, { doze: POSES.asleep, ledger: POSES.watch, writeLedger: POSES.typing, stamp: POSES.typing, switchboard: POSES.typing });

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export function makeAvatar(spec = {}) {
  // own materials, so a pooled avatar can be restyled for its next occupant
  const M = { shirt: new THREE.MeshLambertMaterial(), pants: new THREE.MeshLambertMaterial(), skin: new THREE.MeshLambertMaterial(), hair: new THREE.MeshLambertMaterial(), hat: new THREE.MeshLambertMaterial(), acc: new THREE.MeshLambertMaterial(), shoe: mat("#2a2420"), tie: mat("#b8322c") };
  const B = (w, h, d, m, name) => { const b = box(w, h, d, null, { material: m, cast: false }); if (name) b.name = name; return b; };
  const { HS } = RIG;
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); body.add(hips);
  const legs = [];
  for (const sx of [1, -1]) {
    const leg = new THREE.Group(); leg.position.set(sx * 0.13, 0, 0); hips.add(leg);
    const thigh = B(0.22, RIG.thigh + 0.06, 0.24, M.pants, "thigh"); thigh.position.y = -RIG.thigh / 2; leg.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -RIG.thigh; leg.add(knee);
    const shin = B(0.2, RIG.shin - 0.04, 0.22, M.pants, "shin"); shin.position.y = -(RIG.shin - 0.1) / 2; knee.add(shin);
    const shoe = B(0.22, 0.1, 0.3, M.shoe, "shoe"); shoe.position.set(0, -RIG.shin + 0.05, 0.04); knee.add(shoe);
    legs.push({ leg, knee, thigh, shin, shoe });
  }
  const torso = new THREE.Group(); hips.add(torso);
  const chest = B(0.54, 0.6, 0.3, M.shirt, "torso"); chest.position.y = 0.32; torso.add(chest);
  const belt = B(0.55, 0.06, 0.31, M.pants); belt.position.y = 0.04; torso.add(belt);
  const neck = new THREE.Group(); neck.position.y = RIG.neckY; torso.add(neck);
  const neckBlock = B(0.18, RIG.neckH + 0.04, 0.17, M.skin, "neck"); neckBlock.position.y = RIG.neckH / 2 - 0.02; neck.add(neckBlock);
  const headG = new THREE.Group(); headG.position.y = RIG.neckH; neck.add(headG);
  const faceM = new THREE.MeshLambertMaterial();
  // the top of the skull is its own face, hidden while the lid is open (you look INTO the head)
  const topM = new THREE.MeshLambertMaterial(); topM.color = M.skin.color;
  const head = new THREE.Mesh(new THREE.BoxGeometry(HS, HS, HS), [M.skin, M.skin, topM, M.skin, faceM, M.skin]); head.name = "head";
  const hollow = new THREE.Mesh(new THREE.BoxGeometry(HS - 0.02, HS - 0.02, HS - 0.02), new THREE.MeshLambertMaterial({ color: "#5a2a30", side: THREE.BackSide })); hollow.position.y = HS / 2; hollow.visible = false; hollow.name = "hollow";
  head.position.y = HS / 2; headG.add(head); headG.add(hollow);
  // the lid: the top of the hair, hinged at the back of the head; it swings open when someone looks inside
  const lid = new THREE.Group(); lid.position.set(0, HS, -HS / 2 - 0.02); headG.add(lid);
  const lidMesh = new THREE.Group(); lidMesh.position.set(0, 0, HS / 2 + 0.02); lid.add(lidMesh);
  const parts = {};
  parts.top = B(HS + 0.04, 0.1, HS + 0.04, M.hair); parts.top.position.set(0, 0.03, 0); lidMesh.add(parts.top);
  parts.backShort = B(HS + 0.04, 0.24, 0.06, M.hair); parts.backShort.position.set(0, HS - 0.1, -HS / 2 - 0.02); headG.add(parts.backShort);
  parts.backLong = B(HS + 0.04, 0.55, 0.06, M.hair); parts.backLong.position.set(0, HS - 0.25, -HS / 2 - 0.02); headG.add(parts.backLong);
  parts.sidesShort = []; parts.sidesLong = [];
  for (const sx of [-1, 1]) { const a = B(0.04, 0.14, 0.32, M.hair); a.position.set(sx * (HS / 2 + 0.015), HS - 0.08, -0.07); headG.add(a); parts.sidesShort.push(a); const b = B(0.05, 0.4, 0.3, M.hair); b.position.set(sx * (HS / 2 + 0.02), HS - 0.17, -0.08); headG.add(b); parts.sidesLong.push(b); }
  parts.beanie = new THREE.Group(); { const b = B(0.58, 0.2, 0.58, M.hat); b.position.y = 0.095; parts.beanie.add(b); const p = B(0.12, 0.08, 0.12, mat("#f4e0c0")); p.position.y = 0.24; parts.beanie.add(p); } lidMesh.add(parts.beanie);
  parts.cap = new THREE.Group(); { const b = B(0.58, 0.14, 0.58, M.hat); b.position.y = 0.065; parts.cap.add(b); const v = B(0.44, 0.04, 0.2, M.hat); v.position.set(0, 0.015, 0.385); parts.cap.add(v); } lidMesh.add(parts.cap);
  parts.headset = new THREE.Group(); parts.headsetBand = new THREE.Group(); lidMesh.add(parts.headsetBand); { const band = B(0.52, 0.1, 0.08, M.acc); band.position.y = 0.07; parts.headsetBand.add(band); /* the band rides on the lid, so an open head is open */ for (const sx of [-1, 1]) { const ear = B(0.06, 0.16, 0.16, M.acc); ear.position.set(sx * 0.26, HS / 2, 0); parts.headset.add(ear); const strap = B(0.03, 0.22, 0.05, M.acc); strap.position.set(sx * 0.26, HS - 0.1, 0); parts.headset.add(strap); } const mic = B(0.03, 0.03, 0.2, M.acc); mic.position.set(-0.25, 0.16, 0.12); parts.headset.add(mic); } headG.add(parts.headset);
  parts.tie = B(0.08, 0.36, 0.02, M.tie); parts.tie.position.set(0, 0.36, 0.155); torso.add(parts.tie);
  const arms = [];
  for (const sx of [1, -1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(sx * RIG.shoulder[0], RIG.shoulder[1], RIG.shoulder[2]); torso.add(shoulder);
    // a shoulder cap: overlaps the torso's top corner so there is never a seam at the joint
    const cap = B(0.2, 0.15, 0.24, M.shirt, "cap"); cap.position.set(sx * -0.02, 0.035, 0); torso.add(cap); cap.position.add(shoulder.position);
    const upper = B(0.17, RIG.upper + 0.06, 0.19, M.shirt, "upper"); upper.position.y = -RIG.upper / 2 + 0.01; shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.y = -RIG.upper; shoulder.add(elbow);
    const fore = B(0.155, RIG.fore + 0.05, 0.175, M.shirt, "fore"); fore.position.y = -RIG.fore / 2 + 0.01; elbow.add(fore);
    const cuff = B(0.165, 0.04, 0.185, M.skin); cuff.position.y = -RIG.fore + 0.015; cuff.visible = false; elbow.add(cuff);
    const wrist = new THREE.Group(); wrist.position.y = -RIG.fore; elbow.add(wrist);
    const hand = B(0.14, 0.12, 0.15, M.skin, "hand"); hand.position.y = -RIG.hand + 0.005; wrist.add(hand);
    const prop = new THREE.Group(); prop.position.y = -RIG.hand; wrist.add(prop);
    arms.push({ sx, shoulder, upper, elbow, fore, wrist, hand, prop });
  }
  const [armL, armR] = arms;
  // a soft round shadow under the person (instead of a shadow map that does not match a pose)
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.22, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.012; blob.renderOrder = 1; root.add(blob);
  const a = { root, body, hips, torso, neck, headG, head, topM, hollow, lid, lidMesh, legs, arms, armL, armR, prop: armR.prop, propL: armL.prop, faceM, faceMap: null, sleepMap: null, headSize: HS, M, parts, styleKey: null, blob, reached: [0, 0] };
  a.style = (sp) => styleAvatar(a, sp);
  a.style(spec);
  // open the head: 0 closed .. 1 the lid swung right back on its hinge
  a.setLid = (k) => { a.lid.rotation.x = -k * 1.95; const open = k > 0.02; a.topM.visible = !open; a.hollow.visible = open; };
  return a;
}

const faceCache = new Map();
function faces(skin, face) { const k = skin + JSON.stringify(face || {}); if (!faceCache.has(k)) faceCache.set(k, [faceTex({ skin, ...face }), faceTex({ skin, ...face, closed: true })]); return faceCache.get(k); }
export function styleAvatar(a, { shirt = "#5b7bd5", pants = "#3a3f55", skin = "#f0c8a0", hair = "#3b2a20", hairStyle = "short", hat = null, hatColor = null, accessory = null, face = {} } = {}) {
  const key = JSON.stringify([shirt, pants, skin, hair, hairStyle, hat, hatColor, accessory, face]); if (a.styleKey === key) return; a.styleKey = key;
  a.M.shirt.color.set(shirt); a.M.pants.color.set(pants); a.M.skin.color.set(skin); a.M.hair.color.set(hair);
  a.M.hat.color.set(hatColor || (hat === "cap" ? "#2d4e8a" : "#e0663a")); a.M.acc.color.set(accessory === "headphones" ? "#1f8a5a" : "#222");
  const P = a.parts; const bald = hairStyle === "bald", long = hairStyle === "long";
  // a bald head still has a lid: a skin-coloured cap (so opening the head looks the same for everyone)
  P.top.visible = true; P.top.material = bald ? a.M.skin : a.M.hair; P.top.scale.y = bald ? 0.04 : 0.1;
  P.backShort.visible = !bald && !long; P.backLong.visible = long; P.sidesShort.forEach((x) => (x.visible = !bald && !long)); P.sidesLong.forEach((x) => (x.visible = long));
  P.beanie.visible = hat === "beanie"; P.cap.visible = hat === "cap"; P.headset.visible = P.headsetBand.visible = accessory === "headset" || accessory === "headphones"; P.tie.visible = accessory === "tie";
  const [f, sl] = faces(skin, face); a.faceMap = f; a.sleepMap = sl; a.faceM.map = f; a.faceM.needsUpdate = true;
}

// a stable, friendly look for anyone without a character: from a hash of their id (and chart)
const SKINS = ["#f1c7a1", "#e2ae86", "#d9a47e", "#9c6b4a", "#c98e6a", "#f0c8a0", "#7a5236"];
const HAIRS = ["#2a1d18", "#6b4426", "#1d1d22", "#bfc5cf", "#7a5a3a", "#3a3a3a", "#a0522d", "#d8b66a"];
export function generatedLook(id, chart, hashStr, hueColor) {
  const h = hashStr(id);
  return { shirt: hueColor(chart || id, 0.5, 0.5), pants: ["#36324a", "#3b3a33", "#22252e", "#2f4d7a", "#4a3b2a"][h % 5], skin: SKINS[(h >> 3) % SKINS.length], hair: HAIRS[(h >> 6) % HAIRS.length],
    hairStyle: ["short", "long", "short", "bald", "short"][(h >> 9) % 5], hat: [null, null, null, "beanie", "cap", null][(h >> 12) % 6], hatColor: hueColor(id, 0.6, 0.5), accessory: [null, null, "headphones", null, "tie"][(h >> 15) % 5], face: { glasses: ((h >> 18) % 4) === 0 } };
}

const NUM = ["sit", "turn", "lean", "twist", "shrug", "eyes", "bob", "type", "walk", "wave", "crank", "chair", "alarm"];
const VEC = ["look", "L", "R", "pL", "pR"];
export function mixPose(p, q, f) {
  if (f <= 0) return p; if (f >= 1) return q;
  const o = {}; for (const k of NUM) o[k] = lerp(p[k] || 0, q[k] || 0, f);
  for (const k of VEC) { const a = p[k] || q[k], b = q[k] || p[k]; o[k] = [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)]; }
  // hands travel in an arc, not a straight line (so lap -> desk goes over the desk's edge, not through it)
  for (const k of ["L", "R"]) { const a = p[k], b = q[k]; if (!a || !b) continue; const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); o[k][1] += Math.sin(Math.PI * f) * 0.14 * Math.min(1, d / 0.2); }
  return o;
}

// ---------------------------------------------------------------- applying a pose
const _t = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0); const _q3 = new THREE.Quaternion(), _eu = new THREE.Euler();
const wrap = (x) => { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
// a hand target never lies inside the body: in the torso's frame, a target inside the chest (grown by a
// hand's half-size) moves out the front; one inside the head's box moves out to its side. This keeps a
// blend between two poses (whose targets are lerped) from passing a hand through the person.
const HEADC = () => RIG.neckY + RIG.neckH + RIG.HS / 2;
function keepOut(T, sx) {
  const hx = 0.27 + 0.09, hz = 0.15 + 0.1;
  if (T.y > -0.05 && T.y < 0.64 && Math.abs(T.x) < hx && Math.abs(T.z) < hz) { if (hx - Math.abs(T.x) < hz - T.z) T.x = Math.sign(T.x || sx) * hx; else T.z = hz; } // out the nearer side
  const hc = HEADC(), hh = RIG.HS / 2 + 0.1;
  if (Math.abs(T.y - hc) < hh && Math.abs(T.x) < hh && Math.abs(T.z) < hh) T.x = sx * hh;
  return T;
}

// the procedural loops: where a hand target is at ambient time `amb`
function loopTargets(p, amb, seed) {
  let L = p.L, R = p.R;
  if (p.type) { const a = Math.sin(amb * 22 + seed), b = Math.sin(amb * 22 + 1.7 + seed); L = [L[0] + a * 0.012 * p.type, L[1] + Math.max(0, a) * 0.025 * p.type, L[2]]; R = [R[0] + b * 0.012 * p.type, R[1] + Math.max(0, b) * 0.025 * p.type, R[2]]; }
  if (p.wave) { const w = Math.sin(amb * 8) * 0.13 * p.wave; R = [R[0] + w, R[1], R[2]]; }
  if (p.crank) { const c = crankAngle(amb); L = [L[0], L[1] + Math.cos(c) * 0.13 * p.crank, L[2] + Math.sin(c) * 0.13 * p.crank]; /* the crank's knob (world/stations.js) */ }
  if (p.walk) { const w = Math.sin(amb * 9) * 0.16 * p.walk; L = [L[0], L[1], L[2] - w]; R = [R[0], R[1], R[2] + w]; }
  return [L, R];
}
export const crankAngle = (amb) => amb * 7;

// two-bone IK in the shoulder's parent frame: S shoulder, T target, pole direction; writes the
// shoulder's and the elbow's quaternions. Returns how far short of the target the hand stays.
function twoBone(arm, T, pole) {
  const a = RIG.upper, b = RIG.fore + RIG.hand;
  _s.copy(arm.shoulder.position); _d.subVectors(T, _s); let d = _d.length();
  const short = Math.max(0, d - (a + b) * 0.995); d = Math.min(Math.max(d, Math.abs(a - b) + 0.02), (a + b) * 0.995); _d.normalize();
  const cosA = clamp(-1, 1, (a * a + d * d - b * b) / (2 * a * d)); const sinA = Math.sqrt(1 - cosA * cosA);
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)); if (_p.lengthSq() < 1e-6) _p.set(0, 0, -1).addScaledVector(_d, -_d.z); _p.normalize();
  _e.copy(_s).addScaledVector(_d, a * cosA).addScaledVector(_p, a * sinA); // the elbow
  const up = _t.subVectors(_e, _s).normalize(); arm.shoulder.quaternion.setFromUnitVectors(DOWN, up);
  // the forearm from the elbow toward the (clamped) hand, in the upper arm's frame
  const H = _p.copy(_s).addScaledVector(_d, d); const f = H.sub(_e).normalize(); _q.copy(arm.shoulder.quaternion).invert(); f.applyQuaternion(_q);
  arm.elbow.quaternion.setFromUnitVectors(DOWN, f);
  return short;
}
const clamp = (lo, hi, x) => (x < lo ? lo : x > hi ? hi : x);

// apply a (mixed) pose at ambient time `amb` (seconds; drives the little loops). Targets are in the
// root's frame. Requires the root's parent chain to be in the scene graph (uses world matrices).
export function applyPose(a, p, amb, seed = 0) {
  const sit = p.sit;
  const breathe = Math.sin(amb * 1.7 + seed) * 0.01;
  const bob = Math.sin(amb * 0.9 + seed) * 0.04 * (p.bob || 0);
  a.body.rotation.y = p.turn || 0;
  a.hips.position.y = lerp(RIG.hipStand, RIG.hipSit, sit) + breathe * 0.3;
  // legs: standing straight, seated the thighs forward and the shins down
  const w = p.walk || 0, ph = Math.sin(amb * 9);
  a.legs.forEach((g, i) => { const sw = (i ? -1 : 1) * ph * 0.55 * w; g.leg.rotation.x = lerp(0, -Math.PI / 2, sit) + sw; g.knee.rotation.x = lerp(0, Math.PI / 2, sit) + (w ? Math.max(0, -sw) * 0.8 : 0); });
  if (w) a.hips.position.y += Math.abs(Math.cos(amb * 9)) * 0.03 * w;
  a.torso.rotation.set(p.lean + bob * 0.5 + breathe, p.twist || 0, 0, "YXZ");
  const lift = 0.05 * (p.shrug || 0) * (1 + 0.3 * Math.sin(amb * 2));
  for (const arm of a.arms) arm.shoulder.position.y = RIG.shoulder[1] + lift;
  a.root.updateMatrixWorld(true);
  const [L, R] = loopTargets(p, amb, seed);
  // out of reach? lean (and twist) toward the farther target, a few times, before any arm moves
  const far = (arm, T) => { a.root.localToWorld(_t.set(T[0], T[1], T[2])); arm.shoulder.getWorldPosition(_s); return _t.distanceTo(_s); };
  for (let it = 0; it < 4; it++) {
    const dl = far(a.armL, L), dr = far(a.armR, R); const worst = Math.max(dl, dr);
    if (worst <= RIG.reach * 0.97) break;
    const T = dl > dr ? L : R; const over = worst - RIG.reach * 0.97;
    a.torso.rotation.x = Math.min(RIG.leanMax, a.torso.rotation.x + over * 0.9);
    const yaw = Math.atan2(T[0], T[2]) - (p.turn || 0); a.torso.rotation.y = clamp(-RIG.twistMax, RIG.twistMax, a.torso.rotation.y + clamp(-0.25, 0.25, yaw * 0.3));
    a.root.updateMatrixWorld(true);
  }
  // arms: targets into the torso's frame, then IK
  _m.copy(a.torso.matrixWorld).invert();
  const toTorso = (T, out) => a.root.localToWorld(out.set(T[0], T[1], T[2])).applyMatrix4(_m);
  const poleTorso = (v, out) => { a.root.getWorldQuaternion(_q2); a.torso.getWorldQuaternion(_q); _q.invert(); return out.set(v[0], v[1], v[2]).applyQuaternion(_q2).applyQuaternion(_q); };
  const tL = keepOut(toTorso(L, new THREE.Vector3()), 1), tR = keepOut(toTorso(R, new THREE.Vector3()), -1);
  a.reached[0] = twoBone(a.armL, tL, poleTorso(p.pL, new THREE.Vector3()).normalize());
  a.reached[1] = twoBone(a.armR, tR, poleTorso(p.pR, new THREE.Vector3()).normalize());
  // the hands follow the forearms; the waving hand turns its palm out
  for (const arm of a.arms) arm.wrist.rotation.set(0, 0, 0);
  // head: look at the point within the neck's limits, with NO roll: the head's orientation is built
  // in the root's frame (yaw about the vertical, then pitch), then shared between neck and head
  const look = p.look || [0, 1.5, 3];
  a.neck.rotation.set(0, 0, 0); a.headG.rotation.set(0, 0, 0); a.neck.updateMatrixWorld(true);
  a.headG.getWorldPosition(_e); a.root.worldToLocal(_e); _e.y += RIG.HS / 2;           // the head's centre, root frame
  _t.set(look[0], look[1], look[2]).sub(_e);
  const bodyYaw = (p.turn || 0) + a.torso.rotation.y;
  let yaw = Math.atan2(_t.x, _t.z); yaw = bodyYaw + clamp(-RIG.yaw, RIG.yaw, wrap(yaw - bodyYaw));
  const pitch = clamp(-RIG.pitchUp, RIG.pitchDown, -Math.atan2(_t.y, Math.hypot(_t.x, _t.z)) + bob);
  _q.setFromEuler(_eu.set(pitch, yaw, 0, "YXZ")); a.root.getWorldQuaternion(_q2); _q.premultiply(_q2);   // wanted, world
  a.torso.getWorldQuaternion(_q2); _q3.copy(_q2).invert().multiply(_q); a.neck.quaternion.identity().slerp(_q3, 0.35); a.neck.updateMatrixWorld(true);
  a.neck.getWorldQuaternion(_q2); a.headG.quaternion.copy(_q2.invert().multiply(_q));
  // the blob shadow follows the hips
  a.blob.scale.setScalar(lerp(0.75, 1.05, sit)); a.blob.position.z = lerp(0.02, 0.12, sit);
  const eyesOpen = (p.eyes ?? 1) > 0.5 && !(Math.sin(amb * 0.7 + seed * 3) > 0.985);
  const want = eyesOpen ? a.faceMap : a.sleepMap;
  if (a.faceM.map !== want) { a.faceM.map = want; a.faceM.needsUpdate = true; }
}

// the boxes the intersection check tests (name -> mesh), for tools/inspect.html
export function bodyParts(a) {
  const out = []; const add = (name, mesh) => out.push({ name, mesh });
  add("torso", a.torso.children.find((m) => m.name === "torso")); add("head", a.head); add("neck", a.neck.children.find((m) => m.name === "neck"));
  a.arms.forEach((arm) => { const s = arm.sx > 0 ? "L" : "R"; add("upper" + s, arm.upper); add("fore" + s, arm.fore); add("hand" + s, arm.hand); });
  a.legs.forEach((g, i) => { const s = i ? "R" : "L"; add("thigh" + s, g.thigh); add("shin" + s, g.shin); });
  return out;
}
