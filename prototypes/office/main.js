// main.js: The Office. Scene, clock, camera, input, selection; mounts HEAD and BOARD.
// Everything visible is a function of (playS = playback second of the run, amb = ambient second,
// the visitor's selections and the camera). Film mode (?rec=1) drives all of it from film.js.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadSim, createSim } from "./core/sim.js";
import { buildOffice } from "./world/office.js";
import { buildTubes, makeSlip, KINDS } from "./world/tubes.js";
import { buildPeople } from "./world/people.js";
import { ease, clamp01, lerp, box, mat } from "./world/kit.js";
import * as L from "./world/layout.js";

const params = new URLSearchParams(location.search);
const REC = params.has("rec");
const sim = await loadSim(new URL("data/llm-chat/trace.json", location.href));
const LOOP = sim.playDuration;

// ---------------------------------------------------------------- renderer & scene
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: REC });
renderer.setPixelRatio(REC ? 1 : Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#c9d6dc");
scene.fog = new THREE.Fog("#c9d6dc", 55, 130);
{ // the lawn and the path around the building
  const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: "#8fae6a" })); g.rotation.x = -Math.PI / 2; g.position.y = -0.06; g.receiveShadow = true; scene.add(g);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(36, 30), new THREE.MeshLambertMaterial({ color: "#cdbf9f" })); path.rotation.x = -Math.PI / 2; path.position.set(0, -0.04, -0.6); path.receiveShadow = true; scene.add(path);
}
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 300);
camera.position.set(...L.HOME.pos);
const controls = new OrbitControls(camera, canvas);
controls.target.set(...L.HOME.target); if (camera.aspect < 1) camera.position.sub(controls.target).multiplyScalar(Math.min(2.2, 1.5 / camera.aspect)).add(controls.target); controls.enableDamping = !REC; controls.dampingFactor = 0.12;
controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.12; controls.maxDistance = 70;
controls.screenSpacePanning = false; controls.update();
if (REC) controls.enabled = false;

// light: warm sun through the north windows, a sky fill, lamps
scene.add(new THREE.HemisphereLight("#fff3dc", "#6b5a48", 1.35));
const sun = new THREE.DirectionalLight("#ffe2b8", 1.7);
sun.position.set(-14, 26, 16); sun.target.position.set(0, 0, 0); scene.add(sun.target);
sun.castShadow = true; sun.shadow.mapSize.set(REC ? 2048 : 2048, REC ? 2048 : 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 18, bottom: -18, near: 1, far: 80 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
scene.add(sun);
const fill = new THREE.DirectionalLight("#cfe0ff", 0.35); fill.position.set(20, 10, -10); scene.add(fill);

// ---------------------------------------------------------------- the world
const office = buildOffice(scene, sim);
const tubes = buildTubes(scene, sim);
const people = buildPeople(scene, sim);
const slip = makeSlip(); scene.add(slip);
const nameOf = (id) => { const a = sim.actor(id); if (!a) return id; if (id === "stage") return "the people"; if (id === "llm") return "the model"; if (id === "log") return "chat log"; if (id === "host") return "host"; if (id.startsWith("tools.")) return `${sim.actor(id.slice(6))?.label || id.slice(6)}'s tools`; return a.label; };

// spotlight rings (what the board asked to show)
const ringGeo = new THREE.RingGeometry(0.75, 0.95, 32);
const ringM = new THREE.MeshBasicMaterial({ color: "#ffe14d", transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
const rings = {};
const ringFor = (id) => { if (!rings[id]) { const r = new THREE.Mesh(ringGeo, ringM); r.rotation.x = -Math.PI / 2; r.renderOrder = 3; scene.add(r); rings[id] = r; } return rings[id]; };

// ---------------------------------------------------------------- the board on the west wall
const BOARD_W = 1600, BOARD_H = 900;
let board = null, boardTex = null;
const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(L.BOARD.w, L.BOARD.h), new THREE.MeshBasicMaterial({ color: "#111" }));
boardMesh.position.set(L.BOARD.center[0] + 0.07, L.BOARD.center[1], L.BOARD.center[2]); boardMesh.rotation.y = Math.PI / 2; scene.add(boardMesh);
const boardGlow = new THREE.PointLight("#9fc8ff", 3, 9, 1.5); boardGlow.position.set(L.BOARD.center[0] + 2, L.BOARD.center[1], L.BOARD.center[2]); scene.add(boardGlow);
let boardStatus = "missing";
try {
  const mod = await import("./board/board.js");
  board = mod.createBoard({ sim, width: BOARD_W, height: BOARD_H, createSim, now: () => amb * 1000 });
  boardTex = new THREE.CanvasTexture(board.canvas); boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = 8;
  boardMesh.material = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false });
  board.on("seek", ({ t }) => { playS = Math.min(LOOP - 0.01, sim.warp(t)); });
  board.on("select", ({ actorIds = [], messageIds = [] }) => { spot = { actors: new Set(actorIds), messages: new Set(messageIds), at: amb }; });
  board.on("world", () => {});
  boardStatus = "ok";
} catch (err) {
  console.error("board failed", err); boardStatus = "broken: " + err.message;
  const c = document.createElement("canvas"); c.width = 800; c.height = 450; const g = c.getContext("2d"); g.fillStyle = "#0b0f14"; g.fillRect(0, 0, 800, 450); g.fillStyle = "#8796ab"; g.font = "28px sans-serif"; g.fillText("telemetry board", 40, 60);
  boardMesh.material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) });
}

// ---------------------------------------------------------------- heads (HEAD's machines, or a placeholder)
let createHead = null, headStatus = "missing";
try { createHead = (await import("./head/head.js")).createHead; headStatus = "ok"; } catch (err) { console.error("head failed", err); headStatus = "broken: " + err.message; }
const HEAD_SCALE = 0.042; // HEAD's 10-unit box inside a 0.46 m head
const heads = new Map();
function headFor(id) {
  if (heads.has(id)) return heads.get(id);
  let h;
  if (createHead && sim.chartOf(id)) { try { h = createHead({ THREE, sim, actorId: id }); } catch (err) { console.error("createHead", id, err); headStatus = "broken: " + err.message; } }
  if (!h) { const group = new THREE.Group(); const b = box(6, 6, 6, "#c86b5a"); group.add(b); for (let i = 0; i < 3; i++) { const g = box(1.5, 1.5, 0.4, "#c9a14a"); g.position.set(-2 + i * 2, 4, 3.2); group.add(g); } h = { group, update(t, dt) { group.children.slice(1).forEach((g, i) => (g.rotation.z += dt * (i + 1))); }, setDetail() {}, pick: () => null, focus() {}, dispose() {}, placeholder: true }; }
  h.group.scale.setScalar(HEAD_SCALE); h.group.visible = false; scene.add(h.group);
  // the inside of the skull, a warm room around the machines
  const skull = new THREE.Mesh(new THREE.BoxGeometry(14.5, 12.5, 14.5), new THREE.MeshLambertMaterial({ color: "#6a3a40", side: THREE.BackSide, emissive: "#2a1214", emissiveIntensity: 0.6 }));
  skull.position.y = 0.5; h.group.add(skull); h.skull = skull;
  const glow = new THREE.PointLight("#fff0d8", 1.2, 1.6, 1.2); glow.position.set(0, 4, 4); h.group.add(glow);
  heads.set(id, h); return h;
}

// ---------------------------------------------------------------- the clock of the run
let playS = REC ? 0 : 1.2;    // playback seconds within the loop
let amb = 0;                  // ambient seconds (little loops, camera flights)
let paused = false, speedIndex = 1, displayPaused = null; const SPEEDS = [0.5, 1, 2];
const tNow = () => sim.unwarp(playS);

// ---------------------------------------------------------------- visitor state
let sel = null;     // {id, at, lid, skinHidden, focusId}
let slipMsg = null; // {id, at}
let spot = null;    // {actors:Set, messages:Set, at}
let flight = null;  // {p0,t0,p1,t1, start, dur}
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function flyTo(pos, tgt, dur = 1.4) {
  flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: tgt.clone(), start: amb, dur };
}
const homePos = () => { const t = v3(L.HOME.target), p = v3(L.HOME.pos); const k = Math.min(2.2, Math.max(1, 1.5 / camera.aspect)); return p.sub(t).multiplyScalar(k).add(t); };
function home(dur = 1.6) { flyTo(homePos(), v3(L.HOME.target), dur); }

const personFacing = (id) => { const p = people.people[id]; return p ? p.a.root.rotation.y : 0; };
function select(id) {
  if (!id) return;
  if (sel && sel.id === id) return;
  const p = people.people[id];
  if (board) board.highlight({ actorId: id });
  if (p && sim.chartOf(id)) {
    const h = headFor(id); heads.forEach((o) => (o.group.visible = false)); h.focus(null);
    sel = { id, at: amb, lid: 0, skinHidden: false, focusId: null, head: h, stage: "approach" };
    const c = people.headCenter(id); const f = personFacing(id);
    const dir = new THREE.Vector3(Math.sin(f), 0.42, Math.cos(f)).normalize();
    flyTo(c.clone().addScaledVector(dir, 2.4), c, 1.3);
  } else {
    // an external or a machine: come up close and watch it work
    sel = { id, at: amb, lid: 0, skinHidden: false, focusId: null, head: null, stage: "close" };
    const at = closeUpOf(id); if (at) flyTo(at.pos, at.tgt, 1.4);
  }
}
function closeUpOf(id) {
  const p = people.people[id];
  if (p) { const c = people.headCenter(id); const f = personFacing(id); return { tgt: c.clone().add(new THREE.Vector3(0, -0.3, 0)), pos: c.clone().add(new THREE.Vector3(Math.sin(f) * 3.2, 1.2, Math.cos(f) * 3.2)) }; }
  if (id === "llm") return { tgt: v3([0, 1.6, -10.4]), pos: v3([2.6, 2.6, -3.8]) };
  if (id.startsWith("tools.")) { const k = id.slice(6); const [x, , z] = L.toolMachine(k); return { tgt: v3([x, 0.8, z]), pos: v3([x + 1.6, 2.0, z + 3.0]) }; }
  if (id === "stage") return { tgt: v3([-13.0, 1.2, 8.8]), pos: v3([-9.0, 3.2, 12.8]) };
  if (id === "timers") return { tgt: v3([8.5, 2.6, -12.5]), pos: v3([8.5, 2.6, -7.5]) };
  if (id.startsWith("package:")) return { tgt: v3([-13.6, 1.3, -11.5]), pos: v3([-10.0, 3.4, -6.0]) };
  return null;
}
function enterHead() { if (!sel || !sel.head) return; sel.stage = "inside"; const c = people.headCenter(sel.id); const off = camera.position.clone().sub(c).normalize(); flyTo(c.clone().addScaledVector(off, 0.6), c, 1.5); }
function focusHead(stateId, worldPoint) {
  if (!sel || !sel.head) return;
  sel.focusId = stateId; sel.head.focus(stateId);
  const c = worldPoint || people.headCenter(sel.id);
  const off = camera.position.clone().sub(controls.target).normalize();
  const r = sel.head.focusBounds ? sel.head.focusBounds.radius * HEAD_SCALE : 0.05;
  flyTo(c.clone().addScaledVector(off, Math.max(0.09, Math.min(0.35, r * 2.0))), c, 1.2);
  sel.focusPoint = c.clone();
}
function back() {
  if (slipMsg) { slipMsg = null; return; }
  if (sel && sel.focusId) { sel.focusId = null; sel.head.focus(null); sel.focusPoint = null; const c = people.headCenter(sel.id); const off = camera.position.clone().sub(controls.target).normalize(); flyTo(c.clone().addScaledVector(off, 0.6), c, 1.1); return; }
  if (sel && sel.stage === "inside") { sel.stage = "approach"; const c = people.headCenter(sel.id); const f = personFacing(sel.id); flyTo(c.clone().addScaledVector(new THREE.Vector3(Math.sin(f), 0.42, Math.cos(f)).normalize(), 2.4), c, 1.3); return; }
  if (sel) { const id = sel.id; sel = null; heads.forEach((o) => (o.group.visible = false)); if (board) board.highlight({}); const p = people.people[id]; if (p) { const c = people.headCenter(id); flyTo(c.clone().add(new THREE.Vector3(3.5, 4.5, 7.5)), c.clone().add(new THREE.Vector3(0, -0.8, 0)), 1.3); return; } }
  spot = null; home();
}
function openCapsule(id) { slipMsg = { id, at: amb }; const m = tubes.byId.get(id); slip.userData.draw(m, nameOf); if (board) board.highlight({ messageId: id }); }
function walkTo(point) {
  const off = camera.position.clone().sub(controls.target);
  const tgt = new THREE.Vector3(point.x, 0.6, point.z);
  if (off.length() > 16) off.setLength(11);
  flyTo(tgt.clone().add(off), tgt, 1.1);
}
function togglePause() { paused = !paused; }
function setSpeed(i) { speedIndex = (i + 3) % 3; }

// ---------------------------------------------------------------- picking
const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2();
function rayAt(x, y) { ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera); return raycaster; }
function pickAt(x, y) {
  const rc = rayAt(x, y);
  if (sel && sel.head && sel.stage === "inside") { const hp = sel.head.pick(rc); if (hp) return { kind: "head", hit: hp }; }
  const cands = [boardMesh, ...tubes.active.map((a) => a.group.userData.hit), ...Object.values(people.people).filter((p) => p.a.root.visible).map((p) => p.a.root), ...Object.values(office.stations), ...office.pick.map((p) => p.object)];
  const hits = rc.intersectObjects(cands, true);
  for (const h of hits) {
    const o = h.object;
    if (o === boardMesh) return { kind: "board", uv: h.uv, point: h.point };
    if (o.parent && o.parent.userData.msgId && o === o.parent.userData.hit) return { kind: "capsule", id: o.parent.userData.msgId, point: h.point };
    let a = o; while (a && !a.userData.actorId) a = a.parent; if (a) return { kind: "actor", id: a.userData.actorId, point: h.point };
    for (const [sid, g] of Object.entries(office.stations)) { let p = o; while (p && p !== g) p = p.parent; if (p === g) { if (sid === "workspaceStore") return { kind: "actor", id: "workspace", point: h.point }; if (sid === "archive") return { kind: "actor", id: "log", point: h.point }; if (sid === "hatch") return { kind: "actor", id: "stage", point: h.point }; return { kind: "actor", id: sid, point: h.point }; } }
    const pk = office.pick.find((p) => p.object === o); if (pk) return { kind: pk.kind, point: h.point };
  }
  return null;
}
function click(x, y) {
  const p = pickAt(x, y);
  if (!p) return null;
  if (p.kind === "head") { if (p.hit.kind === "state") { const wp = new THREE.Vector3(); p.hit.object.getWorldPosition(wp); focusHead(p.hit.id === sel.focusId ? null : p.hit.id, p.hit.id === sel.focusId ? null : (p.hit.point || wp)); } return p; }
  if (p.kind === "board") { board && board.pointer("down", p.uv.x, 1 - p.uv.y); board && board.pointer("up", p.uv.x, 1 - p.uv.y); return p; }
  if (p.kind === "capsule") { openCapsule(p.id); return p; }
  if (p.kind === "actor") { if (sel && sel.id === p.id && sel.head && sel.stage !== "inside") enterHead(); else select(p.id); return p; }
  if (p.kind === "clock") { togglePause(); return p; }
  if (p.kind === "lever") { setSpeed(speedIndex + 1); return p; }
  if (p.kind === "floor") { if (sel) { sel = null; heads.forEach((o) => (o.group.visible = false)); } walkTo(p.point); return p; }
  return p;
}
window.__pick = pickAt;

// ---------------------------------------------------------------- live input
if (!REC) {
  let down = null; const pointers = new Map();
  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    down = { x: e.clientX, y: e.clientY, at: performance.now(), n: pointers.size };
    const p = pickAt(e.clientX, e.clientY);
    if (p && p.kind === "board" && pointers.size === 1) { controls.enabled = false; down.board = true; board && board.pointer("down", p.uv.x, 1 - p.uv.y); }
    if (flight) flight = null;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const p = (down && down.board) || !down ? pickAt(e.clientX, e.clientY) : null;
    if (p && p.kind === "board" && board) board.pointer("move", p.uv.x, 1 - p.uv.y); else if (board && !down) board.pointer("leave", 0, 0);
    canvas.style.cursor = p && p.kind !== "floor" ? "pointer" : "default";
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (!down) return; const d = down; down = null; controls.enabled = true;
    if (d.board) { const p = pickAt(e.clientX, e.clientY); if (board) board.pointer("up", p && p.uv ? p.uv.x : 0, p && p.uv ? 1 - p.uv.y : 0); return; }
    if (d.n === 1 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 7 && performance.now() - d.at < 600) click(e.clientX, e.clientY);
  };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); down = null; controls.enabled = true; });
  canvas.addEventListener("wheel", (e) => { if (board) { const p = pickAt(e.clientX, e.clientY); if (p && p.kind === "board") { e.preventDefault(); e.stopImmediatePropagation(); board.pointer("wheel", p.uv.x, 1 - p.uv.y, { dy: e.deltaY, dx: e.deltaX }); } } }, { capture: true, passive: false });
  const keys = new Set();
  addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); togglePause(); }
    else if (e.key === "Escape") back();
    else if (e.key === "]" || e.key === "+") setSpeed(speedIndex + 1);
    else if (e.key === "[" || e.key === "-") setSpeed(speedIndex - 1);
    else if (e.key === "," || e.key === "<") playS = Math.max(0, playS - 3);
    else if (e.key === "." || e.key === ">") playS = Math.min(LOOP - 0.01, playS + 3);
    else if (e.key === "h" || e.key === "Home") { sel = null; slipMsg = null; heads.forEach((o) => (o.group.visible = false)); home(); }
    else keys.add(e.key.toLowerCase());
  });
  addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.__keys = keys;
  addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
}
function walkKeys(dt) {
  const keys = window.__keys; if (!keys || !keys.size) return;
  const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize(); const r = new THREE.Vector3(-f.z, 0, f.x);
  const v = new THREE.Vector3(); const sp = Math.max(3, camera.position.distanceTo(controls.target) * 0.8) * dt;
  if (keys.has("w") || keys.has("arrowup")) v.add(f); if (keys.has("s") || keys.has("arrowdown")) v.sub(f);
  if (keys.has("d") || keys.has("arrowright")) v.add(r); if (keys.has("a") || keys.has("arrowleft")) v.sub(r);
  if (v.lengthSq()) { v.normalize().multiplyScalar(sp); camera.position.add(v); controls.target.add(v); flight = null; if (sel && sel.stage !== "close") { sel = null; heads.forEach((o) => (o.group.visible = false)); } }
}

// ---------------------------------------------------------------- one frame
const tmp = new THREE.Vector3();
let lastHeadTarget = null;
function step(dt) {
  if (!paused) { playS += dt * SPEEDS[speedIndex]; if (playS >= LOOP) playS -= LOOP; }
  amb += dt;
  const t = tNow();
  office.update(playS, t, amb, { paused: displayPaused ?? paused, speedIndex });
  const info = people.update(playS, amb, sel);
  const hl = spot && spot.messages.size ? spot.messages : null;
  const active = tubes.update(playS, hl);
  if (board) { board.update(t); if (board.dirty) { boardTex.needsUpdate = true; board.dirty = false; } }
  // spotlights from the board
  for (const [id, r] of Object.entries(rings)) r.visible = false;
  if (spot) for (const id of spot.actors) { const p = people.people[id]; let pos = null; if (p && p.a.root.visible) pos = p.a.root.position; else if (id === "llm") pos = v3(L.MODEL.at); else if (id.startsWith("tools.")) pos = v3(L.toolMachine(id.slice(6))); if (!pos) continue; const r = ringFor(id); r.visible = true; r.position.set(pos.x, 0.03, pos.z); r.scale.setScalar(1 + 0.08 * Math.sin(amb * 5)); }
  // camera flight
  if (flight) { const f = clamp01((amb - flight.start) / flight.dur), k = ease(f); camera.position.lerpVectors(flight.p0, flight.p1, k); controls.target.lerpVectors(flight.t0, flight.t1, k); if (f >= 1) flight = null; }
  walkKeys(dt);
  // the selected person: follow their head, lift the lid, and the HEAD inside
  if (sel && sel.head) {
    const c = people.headCenter(sel.id);
    const tgtWanted = sel.focusPoint || c;
    if (!flight && lastHeadTarget && !sel.focusPoint) { tmp.copy(c).sub(lastHeadTarget); camera.position.add(tmp); controls.target.add(tmp); }
    lastHeadTarget = c.clone();
    const dist = camera.position.distanceTo(c);
    const since = amb - sel.at;
    sel.lid = clamp01(Math.max(sel.stage === "inside" || sel.focusId ? 1 : 0, (since - 1.0) / 0.6) );
    if (sel.stage === "approach" && since > 1.7 && !flight && sel.autoEnter !== false && REC === false && sel.autoEntered !== true) { /* live: wait for a second click or the wheel */ }
    sel.skinHidden = dist < 0.95;
    const h = sel.head; h.group.visible = true; h.group.position.copy(c); h.group.rotation.y = personFacing(sel.id);
    const d = clamp01((1.0 - dist) / (1.0 - 0.3));
    h.setDetail(sel.focusId ? Math.max(d, 0.9) : d); h.skull.visible = sel.skinHidden;
    h.update(t, dt);
    camera.near = Math.max(0.004, Math.min(0.05, dist * 0.05));
  } else { lastHeadTarget = null; camera.near = 0.05; }
  camera.updateProjectionMatrix();
  // the slip: unrolled above its capsule (or the one lying in the basket)
  if (slipMsg) {
    const a = active.find((x) => x.msg.id === slipMsg.id);
    if (a) { slip.visible = true; slip.position.copy(a.pos).add(new THREE.Vector3(0, 0.62, 0)); slip.quaternion.copy(camera.quaternion); const k = ease(clamp01((amb - slipMsg.at) / 0.35)); slip.scale.set(k * slipScale(), k * slipScale(), 1); }
    else if (slip.visible && amb - slipMsg.at > 0.4) { /* keep it where it was */ } else slip.visible = false;
  } else slip.visible = false;
  if (!REC) controls.update();
}
const slipScale = () => { const d = camera.position.distanceTo(slip.position); return Math.max(0.55, Math.min(1.6, d / 5)); };

// ---------------------------------------------------------------- live loop / film hooks
window.DURATION = LOOP * 1000;
window.state = () => ({ playS, t: tNow(), paused, speedIndex, sel: sel && { id: sel.id, stage: sel.stage, focusId: sel.focusId }, slip: slipMsg, boardStatus, headStatus, loop: LOOP });
window.api = { clearSpot: () => (spot = null), scene, setPaused: (b) => (paused = b), setDisplayPaused: (b) => (displayPaused = b), reset: () => { sel = null; slipMsg = null; spot = null; flight = null; heads.forEach((o) => (o.group.visible = false)); board && board.highlight({}); }, getActive: () => tubes.active, tick: (sec) => { for (let i = 0; i < Math.round(sec * 30); i++) step(1 / 30); }, select, enterHead, focusHead, back, openCapsule, walkTo, flyTo, home, togglePause, setSpeed, click, pickAt, camera, controls, sim, tubes, people, office, board: () => board, setPlay: (s) => (playS = s), heads, headFor, HEAD_SCALE };
let film = null;
if (REC) {
  const { makeFilm } = await import("./film.js");
  film = makeFilm({ THREE, api: window.api, sim, L, step, render: () => renderer.render(scene, camera), setPlayS: (s) => (playS = s), getPlayS: () => playS, setAmb: (a) => (amb = a), camera, controls });
  window.DURATION = film.duration * 1000;
  window.setTime = (ms) => film.setTime(ms / 1000);
  window.ready = true;
} else {
  let last = performance.now();
  renderer.setAnimationLoop(() => { const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now; step(dt); renderer.render(scene, camera); });
  window.ready = true;
}
