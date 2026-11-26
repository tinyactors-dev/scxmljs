// main.js: The Office for ANY system of statecharts. ?system=<name> loads data/<name>/trace.json
// (and data/<name>/office.json when there is one); data/index.json lists the systems, which the
// directory by the door switches between. Everything visible is a function of (playS = playback
// second of the run, amb = ambient second, the visitor's selections, the camera). Film mode
// (?rec=1) drives it from film.js.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createSim } from "./core/sim.js";
import { makePlan } from "./core/plan.js";
import { buildBuilding } from "./world/building.js";
import { buildStations } from "./world/stations.js";
import { buildDesks } from "./world/desks.js";
import { buildPeople } from "./world/people.js";
import { buildTubes, makeSlip, family } from "./world/tubes.js";
import { ease, clamp01, box } from "./world/kit.js";

const params = new URLSearchParams(location.search);
const REC = params.has("rec");
const getJSON = async (url, fallback) => { try { const r = await fetch(url); if (!r.ok) return fallback; return await r.json(); } catch { return fallback; } };
const index = await getJSON("data/index.json", { systems: [{ id: "llm-chat", title: "llm-chat" }] });
const systems = index.systems || [];
const SYSTEM = params.get("system") || index.default || systems[0]?.id || "llm-chat";
const base = `data/${encodeURIComponent(SYSTEM)}/`;
const trace = await getJSON(base + "trace.json", null);
if (!trace) throw new Error(`no trace for system ${SYSTEM}`);
const entry = systems.find((x) => x.id === SYSTEM) || {};
const cfg = entry.office ? await getJSON(base + "office.json", {}) : {}; // listed in index.json, so no 404 for systems without one
const sim = createSim(trace);
const LOOP = sim.playDuration;
const plan = makePlan(sim, { ...(cfg.plan || {}), names: cfg.names });

// ---------------------------------------------------------------- renderer & scene
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: REC });
renderer.setPixelRatio(REC ? 1 : Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const SKY = new THREE.Color("#c9d6dc"), NIGHT = new THREE.Color("#1a1d26");
scene.background = SKY.clone(); scene.fog = new THREE.Fog(SKY.clone(), 70, 170);
const R = plan.room, RW = R.x1 - R.x0, RD = R.z1 - R.z0, RC = new THREE.Vector3((R.x0 + R.x1) / 2, 0, (R.z0 + R.z1) / 2);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 400);
// home: frame whatever was built, from the south-east
function homeView() {
  const tgt = RC.clone().add(new THREE.Vector3(0, 0.3, 0.6));
  const vfov = (camera.fov * Math.PI) / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const need = Math.max((RD * 0.62 + 2) / Math.tan(vfov / 2), (RW * 0.56 + 2) / Math.tan(hfov / 2)) * 0.82;
  const dir = new THREE.Vector3(0.36, 0.58, 0.73).normalize();
  return { pos: tgt.clone().addScaledVector(dir, need), tgt };
}
const H0 = homeView(); camera.position.copy(H0.pos);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(H0.tgt); controls.enableDamping = !REC; controls.dampingFactor = 0.12;
controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.12; controls.maxDistance = 160; controls.update();
if (REC) controls.enabled = false;

const hemi = new THREE.HemisphereLight("#fff3dc", "#6b5a48", 1.35); scene.add(hemi);
const sun = new THREE.DirectionalLight("#ffe2b8", 1.7);
const span = Math.max(RW, RD) * 0.62 + 4;
sun.position.set(RC.x - 14, 26, RC.z + 16); sun.target.position.copy(RC); scene.add(sun.target);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 90 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
scene.add(sun);
const fill = new THREE.DirectionalLight("#cfe0ff", 0.35); fill.position.set(RC.x + 20, 10, RC.z - 10); scene.add(fill);

// ---------------------------------------------------------------- the world
const building = buildBuilding(scene, plan, { systems, current: SYSTEM });
const stations = buildStations(scene, sim, plan, cfg);
const desks = buildDesks(scene, sim, plan, cfg);
const people = buildPeople(scene, sim, plan, cfg, stations.byId);
const tubes = buildTubes(scene, sim, plan, { desks, stations, clockMouth: building.clockMouth, cfg, people });
const slip = makeSlip(); scene.add(slip);
const nameOf = (id) => { if (id === "*") return "everyone"; const a = sim.actor(id); return String(cfg.names?.[id] || a?.label || id); };
const timerRings = new Map(); let clockRings = [];
for (const f of tubes.flights) { if (/timer|clock|delay/i.test(`${sim.actor(f.m.from)?.kind || ""} ${f.m.from}`) && sim.actor(f.m.from)?.external) { clockRings.push(f.s0); (timerRings.get(f.to) || timerRings.set(f.to, []).get(f.to)).push(f.s0); } }
// delayed sends: a desk timer is wound when one is set, rings when it comes due (unless cancelled)
const timerPending = new Map();
{ const tev = sim.eventsBetween(-1, sim.duration + 1).filter((e) => e.type === "timer");
  for (const e of tev) if (e.action === "set") { const stop = tev.find((x) => x.timer === e.id && x.action !== "set"); const due = e.due ?? e.t + (e.delay || 0); const end = Math.min(due, stop ? stop.at : Infinity); (timerPending.get(e.actor) || timerPending.set(e.actor, []).get(e.actor)).push([sim.warp(e.at), sim.warp(end)]); if (!stop || stop.action === "fired" || stop.action === "fire") (timerRings.get(e.actor) || timerRings.set(e.actor, []).get(e.actor)).push(sim.warp(due)); } }
for (const v of timerRings.values()) v.sort((a, b) => a - b);
const recentIn = (arr, s, w) => { if (!arr) return false; for (const x of arr) { if (x > s) break; if (s - x < w) return true; } return false; };
const talkSpans = new Map(); for (const f of tubes.flights) { const k = [f.m.from, f.to].sort().join("|"); (talkSpans.get(k) || talkSpans.set(k, []).get(k)).push(f.s1); }

// spotlight rings (what the board asked to show)
const ringGeo = new THREE.RingGeometry(0.75, 0.95, 32);
const ringM = new THREE.MeshBasicMaterial({ color: "#ffe14d", transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
const rings = {}; const ringFor = (id) => { if (!rings[id]) { const r = new THREE.Mesh(ringGeo, ringM); r.rotation.x = -Math.PI / 2; r.renderOrder = 3; scene.add(r); rings[id] = r; } return rings[id]; };

// ---------------------------------------------------------------- the board on the west wall
const BOARD_W = 1600, BOARD_H = 900;
let board = null, boardTex = null, boardStatus = "missing";
const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(plan.board.w, plan.board.h), new THREE.MeshBasicMaterial({ color: "#111" }));
boardMesh.position.set(plan.board.x + 0.1, 2.45, plan.board.z); boardMesh.rotation.y = Math.PI / 2; scene.add(boardMesh);
try {
  const mod = await import("./board/board.js");
  board = mod.createBoard({ sim, width: BOARD_W, height: BOARD_H, createSim, baseUrl: base, now: () => amb * 1000 });
  boardTex = new THREE.CanvasTexture(board.canvas); boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = 8;
  boardMesh.material = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false });
  board.on("seek", ({ t }) => { playS = Math.min(LOOP - 0.01, sim.warp(t)); });
  board.on("select", ({ actorIds = [], messageIds = [] }) => { spot = { actors: new Set(actorIds), messages: new Set(messageIds), at: amb }; });
  board.on("world", () => {});
  boardStatus = "ok";
} catch (err) {
  console.warn("board unavailable:", err.message); boardStatus = "broken: " + err.message;
  const c = document.createElement("canvas"); c.width = 800; c.height = 450; const g = c.getContext("2d"); g.fillStyle = "#0b0f14"; g.fillRect(0, 0, 800, 450);
  boardMesh.material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) });
}

// ---------------------------------------------------------------- heads (HEAD's machines, or a placeholder)
let createHead = null, headStatus = "missing";
try { createHead = (await import("./head/head.js")).createHead; headStatus = "ok"; } catch (err) { console.warn("head unavailable:", err.message); headStatus = "broken: " + err.message; }
const HEAD_SCALE = 0.042;
const heads = new Map();
function headFor(id) {
  if (heads.has(id)) return heads.get(id);
  let h;
  if (createHead && sim.chartOf(id)) { try { h = createHead({ THREE, sim, actorId: id }); } catch (err) { console.warn("createHead", id, err.message); } }
  if (!h) { const group = new THREE.Group(); group.add(box(6, 6, 6, "#c86b5a")); h = { group, update() {}, setDetail() {}, pick: () => null, focus() {}, dispose() {}, placeholder: true }; }
  h.group.scale.setScalar(HEAD_SCALE); h.group.visible = false; scene.add(h.group);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(14.5, 12.5, 14.5), new THREE.MeshLambertMaterial({ color: "#6a3a40", side: THREE.BackSide, emissive: "#2a1214", emissiveIntensity: 0.6 }));
  skull.position.y = 0.5; h.group.add(skull); h.skull = skull;
  const glow = new THREE.PointLight("#fff0d8", 1.2, 1.6, 1.2); glow.position.set(0, 4, 4); h.group.add(glow);
  heads.set(id, h); return h;
}

// ---------------------------------------------------------------- the clock of the run
let playS = REC ? 0 : Math.min(1.2, LOOP * 0.02);
let amb = 0;
let paused = false, speedIndex = 1, displayPaused = null; const SPEEDS = [0.5, 1, 2];
const tNow = () => sim.unwarp(playS);

// ---------------------------------------------------------------- visitor state
let sel = null, slipMsg = null, spot = null, flight = null;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
function flyTo(pos, tgt, dur = 1.4) { flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: tgt.clone(), start: amb, dur }; }
function home(dur = 1.6) { const h = homeView(); flyTo(h.pos, h.tgt, dur); }
const headPos = (id) => people.headCenter(id, playS);
const facing = (id) => people.facingOf(id, playS);
const hideHeads = () => heads.forEach((o) => (o.group.visible = false));
function select(id) {
  if (!id || (sel && sel.id === id)) return;
  if (board) board.highlight({ actorId: id });
  const a = sim.actor(id);
  if (a && !a.external && headPos(id)) {
    const h = headFor(id); hideHeads(); h.focus(null);
    sel = { id, at: amb, lid: 0, skinHidden: false, focusId: null, head: h, stage: "approach" };
    const c = headPos(id); const f = facing(id);
    flyTo(c.clone().addScaledVector(new THREE.Vector3(Math.sin(f), 0.42, Math.cos(f)).normalize(), 2.4), c, 1.3);
  } else {
    sel = { id, at: amb, lid: 0, skinHidden: false, focusId: null, head: null, stage: "close" };
    const st = stations.byId.get(id);
    if (st) { const p = st.group.getWorldPosition(new THREE.Vector3()); const fwd = new THREE.Vector3(Math.sin(st.group.rotation.y), 0, Math.cos(st.group.rotation.y)); flyTo(p.clone().addScaledVector(fwd, 4.2).add(v3(1.2, 2.4, 0)), p.clone().add(v3(0, 1.3, 0)), 1.4); }
    else if (/timer|clock/i.test(`${a?.kind} ${id}`)) flyTo(v3(plan.clock.x, 2.6, R.z0 + 5), v3(plan.clock.x, 2.6, R.z0), 1.4);
  }
}
function enterHead() { if (!sel || !sel.head) return; sel.stage = "inside"; const c = headPos(sel.id); const f = facing(sel.id); flyTo(c.clone().addScaledVector(new THREE.Vector3(Math.sin(f), 0.3, Math.cos(f)).normalize(), 0.6), c, 1.5); }
function focusHead(stateId, worldPoint) {
  if (!sel || !sel.head) return;
  sel.focusId = stateId; sel.head.focus(stateId);
  const c = worldPoint || headPos(sel.id); const off = camera.position.clone().sub(controls.target).normalize();
  const r = sel.head.focusBounds ? sel.head.focusBounds.radius * HEAD_SCALE : 0.05;
  flyTo(c.clone().addScaledVector(off, Math.max(0.09, Math.min(0.35, r * 2.0))), c, 1.2); sel.focusPoint = stateId ? c.clone() : null;
}
function back() {
  if (slipMsg) { slipMsg = null; return; }
  if (sel && sel.focusId) { sel.focusId = null; sel.head.focus(null); sel.focusPoint = null; const c = headPos(sel.id); if (c) { const f = facing(sel.id); flyTo(c.clone().addScaledVector(new THREE.Vector3(Math.sin(f), 0.3, Math.cos(f)).normalize(), 0.6), c, 1.1); } return; }
  if (sel && sel.stage === "inside") { sel.stage = "approach"; const c = headPos(sel.id); if (c) { const f = facing(sel.id); flyTo(c.clone().addScaledVector(new THREE.Vector3(Math.sin(f), 0.42, Math.cos(f)).normalize(), 2.4), c, 1.3); } return; }
  if (sel) { const id = sel.id; sel = null; hideHeads(); if (board) board.highlight({}); const c = headPos(id); if (c) { flyTo(c.clone().add(v3(3.5, 4.5, 7.5)), c.clone().add(v3(0, -0.8, 0)), 1.3); return; } }
  spot = null; home();
}
function openCapsule(id) { const a = tubes.active.find((x) => x.msg.id === id); slipMsg = { id, at: amb }; const m = a ? a.msg : sim.messagesBetween(-1, sim.duration + 1).find((x) => x.id === id); if (!m) return; slip.userData.draw(m, nameOf, a ? "#" + a.f.color.getHexString() : null); if (board) board.highlight({ messageId: id }); }
function walkTo(point) { const off = camera.position.clone().sub(controls.target); const tgt = new THREE.Vector3(point.x, 0.6, point.z); if (off.length() > 16) off.setLength(11); flyTo(tgt.clone().add(off), tgt, 1.1); }
function togglePause() { paused = !paused; }
function setSpeed(i) { speedIndex = (i + 3) % 3; }
function goSystem(id) { if (id && id !== SYSTEM) { const u = new URL(location.href); u.searchParams.set("system", id); location.href = u.toString(); } }

// ---------------------------------------------------------------- picking
const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2();
function pickAt(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera);
  if (sel && sel.head && sel.stage === "inside") { const hp = sel.head.pick(raycaster); if (hp) return { kind: "head", hit: hp }; }
  const cands = [boardMesh, tubes.caps, ...people.roots().filter((r) => r.visible), ...stations.list.map((s) => s.group), ...building.pick.map((p) => p.object)];
  for (const h of raycaster.intersectObjects(cands, true)) {
    const o = h.object;
    if (o === boardMesh) return { kind: "board", uv: h.uv, point: h.point };
    if (o === tubes.caps) { const a = tubes.active.find((x) => x.index === h.instanceId); if (a) return { kind: "capsule", id: a.msg.id, point: h.point }; continue; }
    if (o.userData.actorId) return { kind: "actor", id: o.userData.actorId, point: h.point };
    if (o.userData.stationId) return { kind: "actor", id: o.userData.stationId, point: h.point };
    const pk = building.pick.find((p) => p.object === o); if (pk) return { kind: pk.kind, id: pk.id, point: h.point };
  }
  return null;
}
function click(x, y) {
  const p = pickAt(x, y); if (!p) return null;
  if (p.kind === "head") { if (p.hit.kind === "state") { const same = p.hit.id === sel.focusId; const wp = new THREE.Vector3(); p.hit.object.getWorldPosition(wp); focusHead(same ? null : p.hit.id, same ? null : p.hit.point || wp); } return p; }
  if (p.kind === "board") { if (board) { board.pointer("down", p.uv.x, 1 - p.uv.y); board.pointer("up", p.uv.x, 1 - p.uv.y); } return p; }
  if (p.kind === "capsule") { openCapsule(p.id); return p; }
  if (p.kind === "actor") { if (sel && sel.id === p.id && sel.head && sel.stage !== "inside") enterHead(); else select(p.id); return p; }
  if (p.kind === "clock") { togglePause(); return p; }
  if (p.kind === "lever") { setSpeed(speedIndex + 1); return p; }
  if (p.kind === "system") { if (!REC) goSystem(p.id); return p; }
  if (p.kind === "floor") { if (sel) { sel = null; hideHeads(); } walkTo(p.point); return p; }
  return p;
}

// ---------------------------------------------------------------- live input
if (!REC) {
  let down = null; const pointers = new Map();
  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]); down = { x: e.clientX, y: e.clientY, at: performance.now(), n: pointers.size };
    const p = pickAt(e.clientX, e.clientY);
    if (p && p.kind === "board" && pointers.size === 1) { controls.enabled = false; down.board = true; board && board.pointer("down", p.uv.x, 1 - p.uv.y); }
    flight = null;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const p = (down && down.board) || !down ? pickAt(e.clientX, e.clientY) : null;
    if (p && p.kind === "board" && board) board.pointer("move", p.uv.x, 1 - p.uv.y); else if (board && !down) board.pointer("leave", 0, 0);
    canvas.style.cursor = p && p.kind !== "floor" ? "pointer" : "default";
  });
  const end = (e) => {
    pointers.delete(e.pointerId); if (!down) return; const d = down; down = null; controls.enabled = true;
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
    else if (e.key === "h" || e.key === "Home") { sel = null; slipMsg = null; hideHeads(); home(); }
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
  if (v.lengthSq()) { v.normalize().multiplyScalar(sp); camera.position.add(v); controls.target.add(v); flight = null; if (sel && sel.stage !== "close") { sel = null; hideHeads(); } }
}

// ---------------------------------------------------------------- one frame
const tmp = new THREE.Vector3(); let lastHeadTarget = null;
const sitCache = new Map();
function step(dt) {
  if (!paused) { playS += dt * SPEEDS[speedIndex]; if (playS >= LOOP) playS -= LOOP; }
  amb += dt;
  const t = tNow(); sitCache.clear();
  const dark = people.update(playS, amb, sel);
  // a blackout (everyone ended at once): the lights go out
  const k = 1 - 0.85 * dark; hemi.intensity = 1.35 * k; sun.intensity = 1.7 * k; fill.intensity = 0.35 * k; scene.background.copy(SKY).lerp(NIGHT, dark); scene.fog.color.copy(scene.background);
  building.update(playS, t, amb, { paused: displayPaused ?? paused, speedIndex, duration: sim.duration, clockRing: recentIn(clockRings, playS, 0.9) });
  stations.update(playS, amb);
  desks.update(playS, t, amb, people.occupantOf, { dark: dark > 0.3, situation: (id) => sitCache.get(id) || sitCache.set(id, sim.situationAt(id, t)).get(id), timerRing: (id) => recentIn(timerRings.get(id), playS, 0.9), timerSet: (id) => (timerPending.get(id) || []).some(([a, b]) => playS >= a && playS < b), talking: (a, b) => recentIn(talkSpans.get([a, b].sort().join("|")), playS, 0.8) });
  const active = tubes.update(playS, spot && spot.messages.size ? spot.messages : null);
  if (board) { board.update(t); if (board.dirty) { boardTex.needsUpdate = true; board.dirty = false; } }
  for (const r of Object.values(rings)) r.visible = false;
  if (spot) for (const id of spot.actors) { let pos = null; const seat = people.seatOfActor(id, playS); if (seat && seat.avatar.root.visible) pos = seat.avatar.root.position; else { const st = stations.byId.get(id); if (st) pos = st.group.position; } if (!pos) continue; const r = ringFor(id); r.visible = true; r.position.set(pos.x, 0.03, pos.z); r.scale.setScalar(1 + 0.08 * Math.sin(amb * 5)); }
  if (flight) { const f = clamp01((amb - flight.start) / flight.dur), e = ease(f); camera.position.lerpVectors(flight.p0, flight.p1, e); controls.target.lerpVectors(flight.t0, flight.t1, e); if (f >= 1) flight = null; }
  walkKeys(dt);
  if (sel && sel.head) {
    const c = headPos(sel.id);
    if (!c) { sel = null; hideHeads(); }
    else {
      if (!flight && lastHeadTarget && !sel.focusPoint) { tmp.copy(c).sub(lastHeadTarget); camera.position.add(tmp); controls.target.add(tmp); }
      lastHeadTarget = c.clone();
      const dist = camera.position.distanceTo(c);
      sel.lid = clamp01(Math.max(sel.stage === "inside" || sel.focusId ? 1 : 0, (amb - sel.at - 1.0) / 0.6));
      sel.skinHidden = dist < 0.95;
      const h = sel.head; h.group.visible = true; h.group.position.copy(c); h.group.rotation.y = facing(sel.id);
      h.setDetail(sel.focusId ? Math.max(clamp01((1.0 - dist) / 0.7), 0.9) : clamp01((1.0 - dist) / 0.7)); h.skull.visible = sel.skinHidden;
      h.update(t, dt);
      camera.near = Math.max(0.004, Math.min(0.05, dist * 0.05));
    }
  } else { lastHeadTarget = null; camera.near = 0.05; }
  camera.updateProjectionMatrix();
  if (slipMsg) { const a = active.find((x) => x.msg.id === slipMsg.id); if (a) { slip.visible = true; slip.position.copy(a.pos).add(v3(0, 0.62, 0)); slip.quaternion.copy(camera.quaternion); const e = ease(clamp01((amb - slipMsg.at) / 0.35)); const d = camera.position.distanceTo(slip.position); const sc = Math.max(0.55, Math.min(1.6, d / 5)) * e; slip.scale.set(sc, sc, 1); } else if (!(slip.visible && amb - slipMsg.at > 0.4)) slip.visible = false; } else slip.visible = false;
  if (!REC) controls.update();
}

// ---------------------------------------------------------------- live loop / film hooks
window.DURATION = LOOP * 1000;
window.state = () => ({ system: SYSTEM, playS, t: tNow(), paused, speedIndex, sel: sel && { id: sel.id, stage: sel.stage, focusId: sel.focusId }, slip: slipMsg, boardStatus, headStatus, loop: LOOP, actors: sim.actors.length, hub: plan.hub, room: [RW, RD] });
window.api = { sim, plan, cfg, scene, camera, controls, people, stations, desks, tubes, building, board: () => board, heads, headFor, HEAD_SCALE,
  select, enterHead, focusHead, back, openCapsule, walkTo, flyTo, home, homeView, togglePause, setSpeed, click, pickAt,
  setPlay: (s) => (playS = s), getPlay: () => playS, setPaused: (b) => (paused = b), setDisplayPaused: (b) => (displayPaused = b), clearSpot: () => (spot = null),
  reset: () => { sel = null; slipMsg = null; spot = null; flight = null; hideHeads(); board && board.highlight({}); },
  getActive: () => tubes.active, tick: (sec) => { for (let i = 0; i < Math.round(sec * 30); i++) step(1 / 30); } };
if (REC) {
  const { makeFilm } = await import("./film.js");
  const film = makeFilm({ THREE, api: window.api, sim, plan, step, render: () => renderer.render(scene, camera), setAmb: (a) => (amb = a), camera, controls, cfg });
  window.DURATION = film.duration * 1000; window.setTime = (ms) => film.setTime(ms / 1000); window.filmScript = film.script;
  window.ready = true;
} else {
  let last = performance.now();
  renderer.setAnimationLoop(() => { const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now; step(dt); renderer.render(scene, camera); });
  window.ready = true;
}
