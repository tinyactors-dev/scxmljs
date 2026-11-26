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
import { makeCameraRig } from "./world/camera.js";
import { WALL_H } from "./world/building.js";
import { PLATES } from "./world/kit.js";
import { createLog } from "./engine/log.js";
import { createViewSampler } from "./engine/view.js";
import { buildRecorder } from "./engine/recorder.js";
import { buildTicker, TAPE_W } from "./world/ticker.js";
import { seatPoint } from "./world/desks.js";
import { createModels } from "./world/models.js";
import { DESK, MODEL } from "./world/layout.js";

// the flight recorder (engine/log.js, LOGGING.md): always on, from the first line, so boot errors are in it too
const log = createLog(); log.attachErrors(); window.officeLog = log;

const params = new URLSearchParams(location.search);
const REC = params.has("rec");
// ?replay=1: tools/replay.mjs drives the page from a log: time, camera and the visitor's actions come from outside
const REPLAY = params.has("replay");
// live: ?live=<system> runs the charts in the page (live/live.js), still until the visitor acts
const LIVE = params.has("live") ? params.get("live") || "microwave" : null;
const live = LIVE ? await (await import("./live/live.js")).bootLive(LIVE) : null;
let liveControls = null, liveSyncAt = -1; // live: the controls in the room (live/controls.js), made once the world is built
let wamb = 0; // live: the world's ambient time, which only runs while the room plays something
const { LIVE_SYSTEMS } = await import("./live/catalog.js").catch(() => ({ LIVE_SYSTEMS: [] }));
const getJSON = async (url, fallback) => { try { const r = await fetch(url); if (!r.ok) return fallback; return await r.json(); } catch { return fallback; } };
const index = await getJSON("data/index.json", { systems: [{ id: "llm-chat", title: "llm-chat" }] });
const systems = index.systems || [];
const SYSTEM = live ? `live:${live.id}` : params.get("system") || index.default || systems[0]?.id || "llm-chat"; // live: its own id
const base = `data/${encodeURIComponent(SYSTEM)}/`;
const trace = live ? live.trace : await getJSON(base + "trace.json", null); // live: the run so far
if (!trace) throw new Error(`no trace for system ${SYSTEM}`);
const entry = systems.find((x) => x.id === SYSTEM) || {};
const cfg = live ? live.office : entry.office ? await getJSON(base + "office.json", {}) : {}; /* live: the system definition's */ // listed in index.json, so no 404 for systems without one
const sim = live ? live.sim : createSim(trace); // live: one sim that grows (sim.append)
const LOOP = live ? 1e9 : sim.playDuration;
// live: the plan is made again as the run grows, from the previous one (nothing already placed moves) and the links
// the inputs will make (so the first press does not rearrange the room)
const planCfg = (prev) => ({ ...(cfg.plan || {}), names: cfg.names, ...(live ? { links: live.links(), prev, boardNorth: true } : {}) });
let plan = makePlan(sim, planCfg(null)); // live: let, rebuilt as the run grows

// ---------------------------------------------------------------- renderer & scene
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: REC });
renderer.setPixelRatio(REC ? 1 : Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
{ const gl = renderer.getContext(), dbg = gl.getExtension("WEBGL_debug_renderer_info"); // log: the session
  Object.assign(log.session, { url: location.href, params: location.search, system: SYSTEM, live: LIVE, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, pixelRatio: renderer.getPixelRatio(),
    ua: navigator.userAgent, gl: { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION) },
    three: THREE.REVISION, mode: REC ? "film" : REPLAY ? "replay" : params.has("noloop") ? "noloop" : "live-page", actors: sim.actors.length, loop: LOOP }); log.ev("session", "start", { ...log.session }); }
const scene = new THREE.Scene();
const SKY = new THREE.Color("#c9d6dc"), NIGHT = new THREE.Color("#1a1d26");
scene.background = SKY.clone(); scene.fog = new THREE.Fog(SKY.clone(), 70, 170);
let R = plan.room, RW = R.x1 - R.x0, RD = R.z1 - R.z0, RC = new THREE.Vector3((R.x0 + R.x1) / 2, 0, (R.z0 + R.z1) / 2); // live: let
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
controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.9; controls.maxDistance = 160; controls.update();
if (REC) controls.enabled = false;

const hemi = new THREE.HemisphereLight("#fff3dc", "#6b5a48", 1.35); scene.add(hemi);
const sun = new THREE.DirectionalLight("#ffe2b8", 1.7);
const span = Math.max(RW, RD) * 0.62 + 4;
sun.position.set(RC.x - 14, 26, RC.z + 16); sun.target.position.copy(RC); scene.add(sun.target);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 90 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
scene.add(sun);
const fill = new THREE.DirectionalLight("#cfe0ff", 0.35); fill.position.set(RC.x + 20, 10, RC.z - 10); scene.add(fill);

// ---------------------------------------------------------------- the world (live: buildWorld runs again when the run grows)
const dirSystems = [...systems, ...LIVE_SYSTEMS.map((x) => ({ id: `live:${x.id}`, title: x.title }))]; // live: plates for live mode too
let building, stations, desks, people, tubes, recorder, timerRings, clockRings, timerPending, talkSpans;
function buildWorld() {
building = buildBuilding(scene, plan, { systems: dirSystems, current: SYSTEM });
stations = buildStations(scene, sim, plan, cfg);
desks = buildDesks(scene, sim, plan, cfg);
people = buildPeople(scene, sim, plan, cfg, stations.byId, desks);
tubes = buildTubes(scene, sim, plan, { desks, stations, clockMouth: building.clockMouth, cfg, people });
recorder = buildRecorder(scene, plan); // the flight recorder by the door (engine/recorder.js)
timerRings = new Map(); clockRings = [];
for (const f of tubes.flights) { if (/timer|clock|delay/i.test(`${sim.actor(f.m.from)?.kind || ""} ${f.m.from}`) && sim.actor(f.m.from)?.external) { clockRings.push(f.s0); (timerRings.get(f.to) || timerRings.set(f.to, []).get(f.to)).push(f.s0); } }
// delayed sends: a desk timer is wound when one is set, rings when it comes due (unless cancelled)
timerPending = new Map();
{ const tev = sim.eventsBetween(-1, sim.duration + 1).filter((e) => e.type === "timer");
  for (const e of tev) if (e.action === "set") { const stop = tev.find((x) => x.timer === e.id && x.action !== "set"); const due = e.due ?? e.t + (e.delay || 0); const end = live && !stop ? Infinity : Math.min(due, stop ? stop.at : Infinity); /* live: still pending */ (timerPending.get(e.actor) || timerPending.set(e.actor, []).get(e.actor)).push([sim.warp(e.at), end === Infinity ? Infinity : sim.warp(end)]); if (live ? stop && stop.action === "fired" : !stop || stop.action === "fired" || stop.action === "fire") (timerRings.get(e.actor) || timerRings.set(e.actor, []).get(e.actor)).push(sim.warp(due)); } }
for (const v of timerRings.values()) v.sort((a, b) => a - b);
talkSpans = new Map(); for (const f of tubes.flights) { const k = [f.m.from, f.to].sort().join("|"); (talkSpans.get(k) || talkSpans.set(k, []).get(k)).push(f.s1); }
}
const nameOf = (id) => { if (id === "*") return "everyone"; const a = sim.actor(id); return String(cfg.names?.[id] || a?.label || id); };
// the receipt printer (world/ticker.js): what each cause caused, as plain lines on a paper tape. One per room, kept
// across live rebuilds (its refusals with it) and placed again by buildWorld: live, beside the console of the first
// person an input drives; a recorded run, at the board's south end, facing the room
const APP = live ? (live.def.app || { id: "user" }).id : null;
// a line's cause from the visitor is named by the control they pressed: an input's own, else the press that came just before it
const pressLabels = []; // [trace events before the press, label]
const youLabel = (m) => { if (!live || m.from !== APP) return null; const c = live.controls().find((x) => x.event === m.name && x.actor === m.to); if (c) return c.label; const i = sim.trace.events.findIndex((e) => e.id === m.id); let best = null; for (const [n, label] of pressLabels) if (n <= i) best = label; return best || String(m.name).replace(/[._]/g, " ").toUpperCase(); };
const ticker = buildTicker(scene, { sim, nameOf, youLabel, live, at: { x: 0, z: 0, ry: 0 } });
// the live console the visitor meets first: one beside a person's desk, else the first there is
const firstConsole = () => { if (!liveControls) return null; const cs = liveControls.consoles(); return cs.find((k) => k.desk) || cs[0] || null; };
function tickerSpot() {
  const k = firstConsole();
  // a desk's console: the printer stands just behind it, its tape above the console, so console and tape are one column beside the desk
  if (k && k.desk && k.actors[0]) { const seat = people.seatOfActor(k.actors[0], playS)?.seat; if (seat && Number.isFinite(seat.x)) { const g = k.group, back = v3(0, 0, -(k.back + 0.28)).applyAxisAngle(v3(0, 1, 0), g.rotation.y); const p = v3(g.position.x + back.x, 0, g.position.z + back.z); /* just behind the console's tilted panel */ const top = new THREE.Box3().setFromObject(k.group).max.y; return { x: p.x, z: p.z, ry: g.rotation.y, lift: Math.max(0.3, top - 0.9) }; } } // the printer's body clears the console's top
  if (k) { const g = k.group; const ry = g.rotation.y; const off = v3(-(k.W / 2 + 0.66), 0, 0.15).applyAxisAngle(v3(0, 1, 0), ry); return { x: g.position.x + off.x, z: g.position.z + off.z, ry }; } // beside it, away from the desk
  const b = plan.board; return { x: b.x + 0.55, z: Math.min(R.z1 - 0.8, b.z + b.w / 2 + 0.8), ry: Math.PI / 2 }; // close to the wall: it hides less of the board
}
function placeTicker(s = 0) { const a = tickerSpot(); ticker.root.position.set(a.x, 0, a.z); ticker.root.rotation.y = a.ry; ticker.setLift(a.lift || 0); ticker.update(s, 0); ticker.root.updateMatrixWorld(true); } // drawn at once: the start view frames the tape as long as it is
buildWorld(); placeTicker();
const slip = makeSlip(); scene.add(slip);
const recentIn = (arr, s, w) => { if (!arr) return false; for (const x of arr) { if (x > s) break; if (s - x < w) return true; } return false; };

// spotlight rings (what the board asked to show)
const ringGeo = new THREE.RingGeometry(0.75, 0.95, 32);
const ringM = new THREE.MeshBasicMaterial({ color: "#ffe14d", transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
const hoverRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })); hoverRing.rotation.x = -Math.PI / 2; hoverRing.renderOrder = 3; hoverRing.visible = false; scene.add(hoverRing);
let hoverId = null; // the person or station under the pointer (no hover on touch)
const rings = {}; const ringFor = (id) => { if (!rings[id]) { const r = new THREE.Mesh(ringGeo, ringM); r.rotation.x = -Math.PI / 2; r.renderOrder = 3; scene.add(r); rings[id] = r; } return rings[id]; };

// ---------------------------------------------------------------- the board on the west wall
const BOARD_W = 1600, BOARD_H = 900;
let board = null, boardTex = null, boardStatus = "missing";
const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(plan.board.w, plan.board.h), new THREE.MeshBasicMaterial({ color: "#111" }));
// the board on its wall: the west wall, or a small room's north wall (core/plan.js)
function mountBoard() { const b = plan.board; if (b.wall === "north") { boardMesh.position.set(b.x, b.y ?? 2.45, b.z + 0.1); boardMesh.rotation.y = 0; } else { boardMesh.position.set(b.x + 0.1, 2.45, b.z); boardMesh.rotation.y = Math.PI / 2; } }
mountBoard(); scene.add(boardMesh);
let boardMod = null;
function makeBoard() { // live: made again when the run grows
  board = boardMod.createBoard({ sim, width: BOARD_W, height: BOARD_H, live: !!live, capsules: cfg.capsules, room: () => ({ people, stations, get playS() { return playS; } }) }); // board/: columns are the room's desks and stations
  if (boardTex) boardTex.dispose();
  boardTex = new THREE.CanvasTexture(board.canvas); boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = 8;
  boardMesh.material = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false });
  board.on("seek", ({ t }) => { if (live) live.viewPast(Math.min(live.restS(), sim.warp(t))); else playS = Math.min(LOOP - 0.01, sim.warp(t)); }); // live: touching the past
  board.on("select", ({ actorIds = [], messageIds = [] }) => { spot = { actors: new Set(actorIds), messages: new Set(messageIds), at: amb }; });
  board.on("world", () => {});
  board.on("hover", ({ actorIds = [] }) => { hoverId = actorIds[0] || null; }); // a row under the pointer: its person's hover ring
  board.on("focus", () => { const p = boardMesh.position, n = v3(0, 0, 1).applyQuaternion(boardMesh.quaternion), t = Math.tan(camera.fov * Math.PI / 360), d = Math.max(plan.board.h / 2 / t, plan.board.w / 2 / (t * camera.aspect)) * 1.04; boardBack = boardBack || { pos: camera.position.clone(), tgt: controls.target.clone() }; flyTo(p.clone().addScaledVector(n, d), p.clone(), 1.3); }); // the board's empty part touched: stand squarely in front of it (Escape: back)
}
let boardBack = null; // where the camera was before it went to stand in front of the board
try {
  boardMod = await import("./board/board.js");
  makeBoard();
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
// each person's machines also stand on their desk as a live tabletop model (world/models.js: the same createHead)
const models = createHead ? createModels({ scene, sim, createHead }) : null;
let frameN = 0;
const heads = new Map();
function headFor(id) {
  if (heads.has(id)) return heads.get(id);
  let h;
  log.note("head-built"); // log: building a head can take a while
  log.ev("world", "head", { id, how: "built" }); // log:
  if (createHead && sim.chartOf(id)) { try { h = createHead({ THREE, sim, actorId: id, ...(live ? { options: { interactive: true, judge: (ev) => !live.busy && !live.viewingPast && live.accepts(id, ev), whyNot: (ev) => (live.viewingPast ? "looking back" : live.whyNot(id, ev)) } } : {}) }); } catch (err) { console.warn("createHead", id, err.message); } }
  if (!h) { const group = new THREE.Group(); group.add(box(6, 6, 6, "#c86b5a")); h = { group, update() {}, setDetail() {}, pick: () => null, focus() {}, dispose() {}, placeholder: true }; }
  h.group.scale.setScalar(HEAD_SCALE); h.group.visible = false; scene.add(h.group);
  // the head's own room (head/head.js: an attic under the skull's dome), shown only while the skin is hidden;
  // a plain dark box for a placeholder head
  if (h.room) { h.group.add(h.room); h.room.visible = false; h.skull = h.room; }
  else { const skull = new THREE.Mesh(new THREE.BoxGeometry(14.5, 12.5, 14.5), new THREE.MeshLambertMaterial({ color: "#6a3a40", side: THREE.BackSide, emissive: "#2a1214", emissiveIntensity: 0.6 })); skull.position.y = 0.5; h.group.add(skull); h.skull = skull; }
  const glow = new THREE.PointLight("#fff0d8", 1.2, 1.6, 1.2); glow.position.set(0, 4, 4); h.group.add(glow);
  heads.set(id, h); return h;
}

// ---------------------------------------------------------------- the clock of the run
let playS = live ? live.restS() : REC ? 0 : Math.min(1.2, LOOP * 0.02); // live: at rest
let amb = 0;
let paused = false, speedIndex = 1, displayPaused = null; const SPEEDS = [0.5, 1, 2];
const tNow = () => sim.unwarp(playS);

// ---------------------------------------------------------------- visitor state
// live: a press made while the room still plays the last one plays that one CATCH_UP times faster up to its end
// (catchUp, a playback second), then its own at the normal pace; pressWatch: the press whose consequence we keep in view
const CATCH_UP = 6; let catchUp = null, pressWatch = null, revealNext = null, consequenceCheck = null;
let sel = null, slipMsg = null, spot = null, flight = null; // flight: kept for the live hooks; the rig flies the camera
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
// the camera: flights along paths, kept out of furniture, walls and people (world/camera.js)
let stationBoxes = null, stationBoxesOf = null;
const colliders = () => { if (stationBoxesOf !== stations) { stationBoxesOf = stations; stationBoxes = stations.list.map((st) => { const b = new THREE.Box3().setFromObject(st.group); return [b.min.clone(), b.max.clone()]; }); } return [...desks.colliders, ...stationBoxes]; };
const rig = makeCameraRig({ camera, controls, get room() { return R; }, wallH: WALL_H, colliders, people: { boxes: (skip) => people.boxes(skip) },
  log: (type, data) => { log.ev("camera", type, data); if (type === "fly") log.note("flight:" + data.kind); } }); // log: flights, arrivals, interruptions
function flyTo(pos, tgt, dur = 1.4, opts) { rig.fly([pos], [tgt], dur, opts); }
// a view that holds every point: looking along `dir` (horizontal; default the current one) from `el` above the
// horizon, as near as the field of view allows with a margin, kept out of furniture
function frameAll(pts, { dir = null, el = 0.26, margin = 1.18, minD = 2.4, tgt = null, free = false } = {}) {
  const bx = new THREE.Box3().setFromPoints(pts), c = tgt || bx.getCenter(v3(0, 0, 0));
  const d = dir ? dir.clone() : camera.position.clone().sub(controls.target); d.y = 0; if (d.lengthSq() < 1e-6) d.set(0, 0, 1); d.normalize();
  const D = v3(d.x * Math.cos(el), Math.sin(el), d.z * Math.cos(el)); const fwd = D.clone().negate();
  const right = v3(0, 0, 0).crossVectors(fwd, v3(0, 1, 0)).normalize(), up = v3(0, 0, 0).crossVectors(right, fwd);
  const tv = Math.tan((camera.fov * Math.PI) / 360) / margin, th = tv * camera.aspect;
  let dist = minD; for (const p of pts) { const q = p.clone().sub(c); const x = Math.abs(q.dot(right)), y = Math.abs(q.dot(up)), z = q.dot(fwd); dist = Math.max(dist, x / th - z, y / tv - z); }
  const pos = c.clone().addScaledVector(D, dist);
  return { pos: free ? pos : rig.resolve(pos), tgt: c, dist };
}
const boxPts = (b) => { const o = []; for (let i = 0; i < 8; i++) o.push(v3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)); return o; };
// is every point in the frame (inside a margin) and in front?
const frus = new THREE.Frustum(), frusM = new THREE.Matrix4();
function inFrame(pts, margin = 0.92) { camera.updateMatrixWorld(); for (const p of pts) { const q = p.clone().project(camera); if (q.z < -1 || q.z > 1 || Math.abs(q.x) > margin || Math.abs(q.y) > margin) return false; } return true; }
// the person (head and desk front) an input drives, for framing
function personPts(id) { const c = headPos(id); const seat = people.seatOfActor(id, playS); const out = []; if (c) out.push(c.clone().add(v3(0, 0.25, 0)), c.clone().add(v3(0, -0.9, 0))); if (seat) { const r = seat.avatar.root; out.push(v3(r.position.x, 0.75, r.position.z)); } return out; }
// the desk model's place on a person's desk (world/layout.js MODEL), whether or not it is built yet
function modelPts(id) { const seat = people.seatOfActor(id, playS)?.seat; if (!seat || seat.visitor) return []; const o = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [DESK.topY, DESK.topY + 0.32]) o.push(seatPoint(seat, [MODEL.x + sx * MODEL.w / 2, y, MODEL.z + sz * MODEL.d / 2])); return o; }
// live: where the visitor starts: in front of the person the inputs drive, at about standing height, the person,
// their console and the printer in frame; a recorded run: the whole room (homeView)
function startView() {
  const k0 = live ? firstConsole() : null;
  if (!k0) return homeView();
  const pts = [...boxPts(new THREE.Box3().setFromObject(k0.group)), ...boxPts(ticker.fullBox(0.22))]; // the tape and room for two more lines (older ones scroll off the top)
  for (const a of k0.actors) { pts.push(...personPts(a)); pts.push(...modelPts(a)); }
  if (plan.board.wall === "north") pts.push(...boxPts(new THREE.Box3().setFromObject(boardMesh))); // a small room's board, behind the people
  for (const k of liveControls.consoles()) if (k !== k0 && k.desk && k.at === k0.at) pts.push(...boxPts(new THREE.Box3().setFromObject(k.group))); // the person's other consoles
  const st = stations.byId.get(k0.at); if (st) pts.push(...boxPts(new THREE.Box3().setFromObject(st.group))); // a station's console: the station too
  const seat = k0.desk && k0.actors[0] ? people.seatOfActor(k0.actors[0], playS) : null;
  // in front of the person, from the console's side (it does not stand in front of them), as near to their desk
  // model as keeps everything in frame with nothing across it; a station's console: from where it faces
  if (!seat) { const f = k0.group.rotation.y; return frameAll(pts, { dir: v3(Math.sin(f), 0, Math.cos(f)), el: 0.2, margin: 1.12 }); }
  const f0 = seat.seat.facing || 0, mc = seatPoint(seat.seat, [MODEL.x, DESK.topY + 0.15, MODEL.z]), head = headPos(k0.actors[0]);
  let best = null;
  // looking at the middle of everything, or nearer the desk (a deep room: the board on the far wall, the console near)
  const mid = new THREE.Box3().setFromPoints(pts).getCenter(v3(0, 0, 0)); const aims = [mid, mid.clone().lerp(mc, 0.5), mc.clone().lerp(mid, 0.25)];
  for (const df of [-0.42, -0.3, -0.18, -0.06, 0.06]) for (const el of [0.2, 0.28, 0.36]) for (const tgt of aims) {
    const v = frameAll(pts, { dir: v3(Math.sin(f0 + df), 0, Math.cos(f0 + df)), el, margin: 1.1, tgt });
    const seen = rig.clear(v.pos, mc, k0.actors[0]) && (!head || rig.clear(v.pos, head, k0.actors[0]));
    const score = v.pos.distanceTo(mc) + (seen ? 0 : 5) + Math.abs(df) * 0.6;
    if (!best || score < best.score) best = { ...v, score };
  }
  return best;
}
function home(dur = 1.6) { const h = live ? startView() : homeView(); flyTo(h.pos, h.tgt, dur); }
const headPos = (id) => people.headCenter(id, playS);
const facing = (id) => people.facingOf(id, playS);
const hideHeads = () => heads.forEach((o) => (o.group.visible = false));
// a lid closes on its own when its person is no longer selected (half a second)
const lids = new Map(); const lidOf = (id) => lids.get(id) || 0;
const inHead = () => sel && sel.head && ["entering", "inside", "leaving"].includes(sel.stage);
// the conversational view of a person: 2.5-3 m, a little above eye level, them and their desk in frame,
// from the side that puts the board behind them when it can
function frameOf(id) {
  const seat = people.seatOfActor(id, playS); if (!seat) return null;
  const r = seat.avatar.root; const f = r.rotation.y; const xAxis = v3(Math.cos(f), 0, -Math.sin(f));
  const toBoard = v3(plan.board.x - r.position.x, 0, plan.board.z - r.position.z);
  const side = xAxis.dot(toBoard) > 0 ? -1 : 1; // the board behind them, seen past their shoulder
  return rig.frame({ x: r.position.x, z: r.position.z, facing: f, standing: !(seat.P && seat.P.sit > 0.5) }, side, null);
}
function select(id) {
  if (!id || (sel && sel.id === id)) return;
  if (board) board.highlight({ actorId: id });
  const a = sim.actor(id);
  if (a && !a.external && headPos(id)) {
    const h = headFor(id); hideHeads(); h.focus(null);
    sel = { id, at: amb, lid: 0, skinHidden: false, focusId: null, head: h, stage: "approach" };
    const v = frameOf(id); if (v) flyTo(v.pos, v.tgt, 1.4);
  } else {
    sel = { id, at: amb, lid: 0, skinHidden: false, focusId: null, head: null, stage: "close" };
    const st = stations.byId.get(id);
    if (st) { const p = st.group.getWorldPosition(new THREE.Vector3()); const fwd = new THREE.Vector3(Math.sin(st.group.rotation.y), 0, Math.cos(st.group.rotation.y)); const tgt = p.clone().add(v3(0, 1.2, 0)); flyTo(rig.resolve(p.clone().addScaledVector(fwd, 3.2).add(v3(0.9, 1.9, 0))), tgt, 1.4); }
    else if (/timer|clock/i.test(`${a?.kind} ${id}`)) flyTo(rig.resolve(v3(plan.clock.x, 2.6, R.z0 + 4)), v3(plan.clock.x, 2.6, R.z0), 1.4);
  }
}
// into a head: rise over the person, the lid lifts, descend into the head (one continuous move)
// the view inside a head, which head/head.js fits its layout to: along (0, 0.3, 1) in the head's frame,
// 14.3 head units (HEAD_SCALE) from its centre, fov 42
const FOV = 42, REF_TAN = Math.tan((FOV / 2) * Math.PI / 180) * 1.6;
const insideFov = () => Math.min(90, Math.max(FOV, (2 * Math.atan(REF_TAN / camera.aspect) * 180) / Math.PI));
// stand back only for what a 90 degree view still misses of 85 % of the width (the camera must stay under the dome)
const headK = () => Math.max(1, (0.85 * REF_TAN) / (Math.tan((insideFov() / 2) * Math.PI / 180) * camera.aspect)); // 1 on a landscape screen
const insideView = (c, f) => c.clone().addScaledVector(v3(Math.sin(f), 0, Math.cos(f)), 0.575 * headK()).add(v3(0, 0.1725 * headK(), 0));
function enterHead() {
  if (!sel || !sel.head || inHead()) return;
  const c = headPos(sel.id); if (!c) return; const f = facing(sel.id); const fw = v3(Math.sin(f), 0, Math.cos(f));
  sel.anchor = c.clone(); sel.anchorF = f; sel.stage = "entering";
  const over = c.clone().addScaledVector(fw, 0.6).add(v3(0, 1.2, 0)), above = c.clone().addScaledVector(fw, 0.2).add(v3(0, 0.62, 0));
  const me = sel;
  rig.fly([over, above, insideView(c, f)], [c, c, c], 2.6, { kind: "enter", onProgress: (k) => { me.lid = clamp01((k - 0.22) / 0.3); }, onDone: () => { if (sel === me) { me.stage = "inside"; me.lid = 1; } } });
}
// a machine in focus is framed whole: every part and plate of it in the frame, seen from the head's front and a
// little above, as near as the field of view allows (the bounds are the head's layout after the focus, in world units)
function focusHead(stateId) {
  if (!sel || !sel.head) return;
  const c0 = sel.anchor || headPos(sel.id); if (!c0) return;
  sel.focusId = stateId; const fb = sel.head.focus(stateId);
  if (!stateId || !fb) { sel.focusPoint = null; flyTo(insideView(c0, sel.anchorF ?? facing(sel.id)), c0, 1.1); return; }
  const f = sel.anchorF ?? facing(sel.id); const dir = v3(Math.sin(f), 0, Math.cos(f));
  const b = fb.box.clone(); const sz = b.getSize(v3(0, 0, 0)); b.expandByVector(sz.multiplyScalar(0.06)); // plates stand a little proud of the parts
  const v = frameAll(boxPts(b), { dir, el: 0.5, margin: 1.1, minD: 0.04, free: true });
  sel.focusDist = v.dist; flyTo(v.pos, v.tgt, 1.2); sel.focusPoint = v.tgt.clone();
}
// out of a head: the reverse, rising out through the top, the lid closing behind, ending in conversation
function leaveHead(then) {
  const c = sel.anchor || headPos(sel.id); const f = sel.anchorF ?? facing(sel.id); const fw = v3(Math.sin(f), 0, Math.cos(f));
  const above = c.clone().addScaledVector(fw, 0.2).add(v3(0, 0.62, 0)), over = c.clone().addScaledVector(fw, 0.6).add(v3(0, 1.2, 0));
  const v = frameOf(sel.id) || { pos: c.clone().add(v3(1, 0.6, 2.6)), tgt: c.clone().add(v3(0, -0.35, 0.6)) };
  const me = sel; me.stage = "leaving"; me.focusId = null; me.focusPoint = null; me.head.focus(null);
  const from = camera.position.distanceTo(c) < 0.75 * headK() ? [insideView(c, f)] : [];
  rig.fly([...from, above, over, v.pos], [...from.map(() => c), c, c, v.tgt], 2.8, { kind: "leave", onProgress: (k) => { me.lid = 1 - clamp01((k - 0.42) / 0.3); }, onDone: () => { if (sel === me) { me.stage = "approach"; me.lid = 0; } if (then) then(); } });
}
function back() {
  if (rig.flight && rig.flight.kind === "leave") { const f = rig.flight, prev = f.onDone; f.onDone = () => { if (prev) prev(); back(); }; return; } // queued until we are out
  if (slipMsg) { slipMsg = null; return; }
  if (boardBack && !sel) { const v = boardBack; boardBack = null; flyTo(v.pos, v.tgt, 1.3); return; } // from in front of the board: back where we were
  if (sel && sel.focusId) { sel.focusId = null; sel.head.focus(null); sel.focusPoint = null; const c = sel.anchor || headPos(sel.id); if (c) flyTo(insideView(c, sel.anchorF ?? facing(sel.id)), c, 1.1); return; }
  if (sel && (sel.stage === "inside" || sel.stage === "entering")) { leaveHead(); return; }
  if (sel) { const id = sel.id; sel = null; hideHeads(); if (board) board.highlight({}); const c = headPos(id); if (c) { const off = camera.position.clone().sub(controls.target); off.setLength(Math.min(9, Math.max(4.5, off.length() * 1.7))); const tgt = controls.target.clone(); flyTo(rig.resolve(tgt.clone().add(off)), tgt, 1.3); return; } }
  spot = null; home();
}
// live: after a press, what it caused must be in view from where the visitor stands: the control and the people
// whose state the chain changed (inside a head: the machines whose marbles move). When they already are, nothing
// moves; otherwise the camera turns and backs off gently, along the visitor's own direction, until they are
function revealConsequence(pw) {
  pressWatch = null;
  const evs = sim.trace.events.slice(pw.evN);
  const actors = new Set(); if (pw.actor && sim.actor(pw.actor) && !sim.actor(pw.actor).external) actors.add(pw.actor);
  for (const e of evs) if ((e.type === "transition" || e.type === "spawn" || e.type === "data") && e.actor && !sim.actor(e.actor)?.external) actors.add(e.actor);
  const ids = [...actors]; let flew = false, machines = [];
  if (pw.head && sel && sel.head && (inHead() || sel.focusId)) {
    // the machines whose marble moves now; if none of them is in frame, focus the first
    const h = sel.head; const from = playS - 0.05;
    machines = h.states().filter((id) => h.movesOf(id).some((m) => m.start >= from));
    const inView = machines.filter((id) => inFrame(boxPts(h.boundsOf(id).box), 1.0));
    if (machines.length && !inView.length) { focusHead(machines[0]); flew = true; }
  } else if (!inHead() && !(sel && sel.focusId)) {
    const it = liveControls && liveControls.items.get(pw.id);
    const pts = []; if (it) pts.push(...boxPts(new THREE.Box3().setFromObject(it.ui.group)));
    // a person whose desk model is in view shows what the press did there: their model and their head are enough
    for (const id of ids.slice(0, 4)) { const mb = models && models.boxOf(id); if (mb) { pts.push(...boxPts(mb)); const c = headPos(id); if (c) pts.push(c); } else pts.push(...personPts(id)); }
    const hidden = ids.some((id) => hiddenPerson(id) && !(models && models.boxOf(id)));
    if (pts.length && (!inFrame(pts, 1.0) || hidden)) {
      // from the visitor's own direction if the people can be seen from there over the furniture, else turned
      // toward the front of the first of them, a step at a time
      const here = camera.position.clone().sub(controls.target); here.y = 0; here.normalize();
      const seat = ids[0] ? people.seatOfActor(ids[0], playS) : null; const front = seat ? v3(Math.sin(seat.avatar.root.rotation.y), 0, Math.cos(seat.avatar.root.rotation.y)) : here;
      const tops = ids.map((id) => headPos(id)).filter(Boolean).map((c) => c.clone().add(v3(0, 0.32, 0)));
      let best = null;
      for (const k of [0, 0.25, 0.5, 0.75, 1]) {
        const dir = here.clone().lerp(front, k); if (dir.lengthSq() < 1e-4) continue; dir.normalize();
        const v = frameAll(pts, { dir, el: 0.24 }); const ok = tops.every((t) => rig.clear(v.pos, t, ids[0])) && rig.clear(v.pos, v.tgt, ids[0]); // and nothing across the middle of the view
        if (ok) { best = v; break; } if (!best) best = v;
      }
      flyTo(best.pos, best.tgt, 1.3, { kind: "reveal" }); flew = true;
    }
  }
  consequenceCheck = { due: amb + 2.0, id: pw.id, actors: ids, machines, flew, head: !!pw.head };
}
// a person is hidden when neither the middle nor the top of their head can be seen (a monitor may hide the chin)
const hiddenPerson = (id) => !!headPos(id) && occludedFrom(camera.position, id) && occludedFrom(camera.position, id, 0.2);
function checkConsequence() { // log: was what the press caused in view, two seconds later?
  const c = consequenceCheck; consequenceCheck = null; camera.updateMatrixWorld();
  if (c.head) { const h = sel && sel.head; const seen = h ? c.machines.filter((id) => inFrame(boxPts(h.boundsOf(id).box), 1.0)) : []; log.ev("world", "consequence", { id: c.id, head: true, machines: c.machines, seen, flew: c.flew }); return; }
  const subs = subjects(); const seen = [];
  for (const id of c.actors) { const sb = subs.find((x) => x.kind === "actor" && x.id === id); const r = sb && viewer.rect(sb.min, sb.max, camera, innerWidth, innerHeight); if (r && r.frac > 0.002 && !hiddenPerson(id)) seen.push(id); }
  const cs = subs.find((x) => x.kind === "control" && x.id === c.id); const control = !!(cs && viewer.rect(cs.min, cs.max, camera, innerWidth, innerHeight));
  log.ev("world", "consequence", { id: c.id, actors: c.actors, seen, control, flew: c.flew });
}
function openCapsule(id) { const a = tubes.active.find((x) => x.msg.id === id); slipMsg = { id, at: amb }; const m = a ? a.msg : sim.messagesBetween(-1, sim.duration + 1).find((x) => x.id === id); if (!m) return; slip.userData.draw(m, nameOf, a ? "#" + a.f.color.getHexString() : null); if (board) board.highlight({ messageId: id }); }
// a click on the floor walks there: the view keeps its direction, at a standing distance, out of furniture
function walkTo(point) {
  const tgt = v3(point.x, 1.0, point.z); const off = camera.position.clone().sub(controls.target); const hz = v3(off.x, 0, off.z); if (hz.lengthSq() < 1e-4) hz.set(0.4, 0, 0.9);
  const d = Math.min(8, Math.max(3.2, off.length())); const h = Math.min(d * 0.75, Math.max(1.0, off.y));
  hz.setLength(Math.sqrt(Math.max(0.5, d * d - h * h))); flyTo(rig.resolve(tgt.clone().add(hz).add(v3(0, h, 0))), tgt, 1.1);
}
function togglePause() { paused = !paused; }
function setSpeed(i) { speedIndex = (i + 3) % 3; }
function goSystem(id) { if (id && id !== SYSTEM) { const u = new URL(location.href); if (id.startsWith("live:")) { u.searchParams.delete("system"); u.searchParams.set("live", id.slice(5)); } else { u.searchParams.delete("live"); u.searchParams.set("system", id); } location.href = u.toString(); } } // live: plates for live systems

// ---------------------------------------------------------------- picking
const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2();
function pickAt(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera);
  if (sel && sel.head && sel.stage === "inside") { const hp = sel.head.pick(raycaster); if (hp) return { kind: "head", hit: hp }; }
  if (liveControls) { const c = liveControls.pick(raycaster); if (c) return { kind: "control", id: c.id }; } // live: the controls
  const nearC = liveControls ? liveControls.near(x, y, camera, innerWidth, innerHeight) : null; // live: within a thumb's reach
  const cands = [boardMesh, ticker.tape, tubes.caps, ...people.roots().filter((r) => r.visible), ...stations.list.map((s) => s.group), ...building.pick.map((p) => p.object), ...recorder.pick.map((p) => p.object), ...building.occluders, desks.root, ...(models ? [models.root] : [])];
  const shown = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; }; // hidden things (the ceiling seen from above) take no clicks
  for (const h of raycaster.intersectObjects(cands, true)) {
    const o = h.object; if (!shown(o)) continue;
    if (o === boardMesh) return { kind: "board", uv: h.uv, point: h.point };
    if (o === ticker.tape) return { kind: "ticker", uv: h.uv, point: h.point };
    if (o === tubes.caps) { const a = tubes.active.find((x) => x.index === h.instanceId); if (a) return { kind: "capsule", id: a.msg.id, point: h.point }; continue; }
    if (o.userData.actorId) return { kind: "actor", id: o.userData.actorId, point: h.point };
    if (o.userData.stationId) return { kind: "actor", id: o.userData.stationId, point: h.point };
    if (o.userData.recorder) return { kind: "recorder", point: h.point };
    { let q = o; while (q && !(q.name || "").startsWith("desk-model:")) q = q.parent; if (q) return { kind: "actor", id: q.name.slice(11), point: h.point, via: "model" }; } // a desk model: its person
    if (building.occluders.includes(o)) return nearSubject(x, y) || { kind: "wall", point: h.point };
    if (!building.pick.some((p) => p.object === o)) { let q = o; while (q && q !== desks.root) q = q.parent; if (q === desks.root) { const who = deskOwner(h.point); return who ? { kind: "actor", id: who, point: h.point, via: "desk" } : nearSubject(x, y) || { kind: "furniture", point: h.point }; } }
    const pk = building.pick.find((p) => p.object === o); if (pk) return pk.kind === "floor" && nearC ? { kind: "control", id: nearC.id } : pk.kind === "floor" ? nearSubject(x, y) || { kind: pk.kind, point: h.point } : { kind: pk.kind, id: pk.id, point: h.point };
  }
  return nearC ? { kind: "control", id: nearC.id } : nearSubject(x, y);
}
// a desk, its chair and the things on it are its sitter's: a tap there means the person (nearest seat within 1.4 m)
function deskOwner(p) {
  let best = null, bd = 1.4;
  for (const d of desks.desks.values()) { const dd = Math.hypot(d.seat.x - p.x, d.seat.z - p.z); if (dd < bd) { const o = people.occupantOf(d.key, playS); if (o && o.present) { bd = dd; best = o.id; } } }
  return best;
}
// a tap on the floor or a wall within a thumb's width (14 px) of a person's or a station's outline on screen means them
function nearSubject(x, y) {
  if (inHead()) return null;
  let best = null, bd = 14; camera.updateMatrixWorld();
  for (const s of subjects()) { if (s.kind !== "actor" && s.kind !== "station") continue; const r = viewer.rect(s.min, s.max, camera, innerWidth, innerHeight); if (!r) continue; const d = Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1)); if (d < bd) { bd = d; best = s; } }
  return best ? { kind: "actor", id: best.id, via: "near" } : null;
}
// a click becomes an action (what the visitor meant), and perform() does it: the one place where
// intent becomes behaviour, so the recorder logs it once and the replay can do it again
function intentOf(p) {
  if (!p) return null;
  switch (p.kind) {
    case "control": return { do: "press", id: p.id };
    case "head":
      if (live && p.hit.kind === "event") return { do: "headSend", actor: sel.id, event: p.hit.event }; // live: a brass button on a track in the head
      if (p.hit.kind === "state") { const same = p.hit.id === sel.focusId; const wp = new THREE.Vector3(); p.hit.object.getWorldPosition(wp); const q = p.hit.point || wp; return { do: "focus", state: same ? null : p.hit.id, point: same ? null : [+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4)] }; }
      return null;
    case "board": return { do: "board", type: "tap", u: p.uv.x, v: 1 - p.uv.y };
    case "ticker": return { do: "ticker", u: +p.uv.x.toFixed(4), v: +p.uv.y.toFixed(4) };
    case "capsule": return { do: "slip", id: p.id };
    case "actor": if (sel && sel.id === p.id && sel.head && sel.stage === "approach") return { do: "enter" }; if (sel && sel.id === p.id && !sel.head) return { do: "back" }; if (!(sel && sel.id === p.id)) return { do: "select", id: p.id }; return null;
    case "clock": return live ? { do: live.viewingPast ? "now" : "advance" } : { do: "pause" }; // live: the clock advances time
    case "lever": return { do: "speed", i: speedIndex + 1 };
    case "system": return REC ? null : { do: "system", id: p.id };
    case "recorder": return { do: "export" };
    case "floor": return inHead() ? null : { do: "walk", point: [+p.point.x.toFixed(3), +p.point.y.toFixed(3), +p.point.z.toFixed(3)] };
    default: return null; // a wall, furniture: nothing
  }
}
let lastAct = "boot"; // log: the cause of the next mode change
function perform(a, src = "input") {
  if (!a) return;
  log.ev("act", a.do, { ...a, do: undefined, src }); lastAct = a.do; log.note("act:" + a.do); // log: every action, replayable
  switch (a.do) {
    case "press": if (liveControls) {
      const it = liveControls.items.get(a.id); const wasPlaying = live && !live.atRest(); const lastS = sim.warp(Number.MAX_SAFE_INTEGER); const evN = sim.trace.events.length;
      if (it && !it.fixed) pressLabels.push([evN, it.c.label]);
      const ok = liveControls.press(a.id); const why = ok ? null : liveControls.lastWhy(a.id);
      log.ev("world", "press", { id: a.id, ok, why, queued: ok && wasPlaying, stepping: !!live?.stepping, pending: live ? live.pendingTimers().length : 0 }); // log: taken, refused (and why), or queued behind what plays
      if (!ok && it && a.id !== "time:mode") ticker.refuse(`YOU: ${it.c.label}`, why || "not now", playS);
      // a press made while the room still plays the last one: that one finishes fast, then this one plays
      if (ok && wasPlaying) catchUp = lastS;
      if (ok && it) pressWatch = { id: a.id, evN, actor: it.c.actor || null, at: amb };
    } break;
    case "headSend": if (live && !live.busy && !live.accepts(a.actor, a.event)) { const why = live.viewingPast ? "looking back" : live.whyNot(a.actor, a.event); log.ev("world", "press", { id: `head:${a.event}`, ok: false, why }); ticker.refuse(`YOU: ${String(a.event).replace(/[._]/g, " ").toUpperCase()}`, why, playS); if (sel && sel.head && sel.head.showWhy) sel.head.showWhy(a.event); break; } // live: a dim button in a head does nothing, and says why
      if (live) { const wasPlaying = !live.atRest(); const lastS = sim.warp(Number.MAX_SAFE_INTEGER); pressWatch = { id: `head:${a.event}`, evN: sim.trace.events.length, actor: a.actor, at: amb, head: true }; if (wasPlaying) catchUp = lastS; live.send(a.actor, a.event); } break;
    case "ticker": { const r = ticker.pick({ x: a.u, y: a.v }); spot = r && r.key ? { actors: new Set(r.actors), messages: new Set(r.messages), at: amb } : null; if (board) board.highlight(r && r.actors && r.actors[0] ? { actorId: r.actors[0] } : {}); log.ev("world", "ticker", { key: r ? r.key : null, actors: r ? r.actors : [], text: r?.text?.slice(0, 120) }); break; } // log: a line selected
    case "focus": focusHead(a.state); break;
    case "board": boardHot = true; if (board) { if (a.type === "tap") { board.pointer("down", a.u, a.v); board.pointer("up", a.u, a.v); } else board.pointer(a.type, a.u, a.v, a.extra); } break;
    case "slip": openCapsule(a.id); break;
    case "enter": enterHead(); break;
    case "select": select(a.id); break;
    case "advance": if (live) { log.ev("world", "press", { id: "clock", ok: live.pendingTimers().length > 0, stepping: !!live.stepping, pending: live.pendingTimers().length }); live.advance(); } break; // log:
    case "now": live && live.returnToNow(); break;
    case "pause": togglePause(); break;
    case "speed": setSpeed(a.i); break;
    case "seek": playS = Math.max(0, Math.min(LOOP - 0.01, a.s)); break;
    case "system": goSystem(a.id); break;
    case "export": if (!REPLAY) recorder.press(() => log.download()); break;
    case "walk": walkTo(v3(...a.point)); break; // walking never changes the selection
    case "back": back(); break;
    case "home": sel = null; slipMsg = null; hideHeads(); home(); break;
    case "deselect": sel = null; hideHeads(); break;
  }
}
function click(x, y) {
  const p = pickAt(x, y); const a = intentOf(p);
  log.ev("pick", "tap", { x: Math.round(x), y: Math.round(y), hit: p ? [p.kind, p.id ?? p.hit?.id ?? p.hit?.kind ?? null] : null, act: a ? a.do : null, near: nearOf(x, y) }); // log: what was under the pointer, what we did, what was close
  perform(a);
  return p;
}

// ---------------------------------------------------------------- live input
if (!REC && !REPLAY) {
  log.attachInput(canvas); // log: raw pointer, wheel and keys (passive listeners at the canvas)
  let down = null; const pointers = new Map(); let hoverKey = "", cursorNow = "default", pinch = null;
  const gesture = (kind, d) => log.ev("input", "gesture", { kind, ...d }); // log: what the app made of the input
  controls.addEventListener("start", () => { orbiting = true; orbitFrom = { az: controls.getAzimuthalAngle(), po: controls.getPolarAngle(), d: controls.getDistance(), t: controls.target.clone() }; });
  controls.addEventListener("end", () => { orbiting = false; if (!orbitFrom) return; const o = orbitFrom; orbitFrom = null; const dd = controls.getDistance() - o.d, da = controls.getAzimuthalAngle() - o.az, dp = controls.getPolarAngle() - o.po, dt = controls.target.distanceTo(o.t); if (Math.abs(dd) > 0.01 || Math.abs(da) > 0.01 || Math.abs(dp) > 0.01 || dt > 0.01) gesture(dt > 0.05 ? "pan" : Math.abs(dd) > 0.05 && Math.abs(da) + Math.abs(dp) < 0.05 ? "zoom" : "orbit", { dAz: +da.toFixed(3), dPolar: +dp.toFixed(3), dDist: +dd.toFixed(2), dTarget: +dt.toFixed(2) }); });
  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]); down = { x: e.clientX, y: e.clientY, at: performance.now(), n: pointers.size, button: e.button };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
    const p = pickAt(e.clientX, e.clientY);
    if (p && p.kind === "board" && pointers.size === 1) { controls.enabled = false; down.board = true; perform({ do: "board", type: "down", u: p.uv.x, v: 1 - p.uv.y }); }
    if (!(rig.flight && ["enter", "leave"].includes(rig.flight.kind))) rig.stop("pointerdown"); // a drag never interrupts going into or out of a head
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const p = (down && down.board) || !down ? pickAt(e.clientX, e.clientY) : null;
    if (p && p.kind === "board" && board) { if (down && down.board) perform({ do: "board", type: "move", u: p.uv.x, v: 1 - p.uv.y }); else { board.pointer("move", p.uv.x, 1 - p.uv.y); boardHot = true; } } else if (board && !down) board.pointer("leave", 0, 0);
    const cur = p && !["floor", "wall", "furniture"].includes(p.kind) ? "pointer" : "default";
    if (!down) { const key = p ? `${p.kind}:${p.id ?? p.hit?.id ?? ""}` : ""; if (key !== hoverKey || cur !== cursorNow) log.ev("pick", "hover", { x: Math.round(e.clientX), y: Math.round(e.clientY), hit: p ? [p.kind, p.id ?? p.hit?.id ?? null] : null, cursor: cur }); hoverKey = key; } // log: hover target and cursor changes
    canvas.style.cursor = cursorNow = cur; if (!down && !(p && p.kind === "board")) hoverId = p && p.kind === "actor" ? p.id : null; // a board row hovered keeps the room's hover
    if (liveControls && !down) liveControls.hover(p && p.kind === "control" ? p.id : null); // live: a dim control says why
    if (sel && sel.head && sel.head.hoverButton && !down) sel.head.hoverButton(p && p.kind === "head" && p.hit.kind === "event" ? p.hit : null); // live: so does a dim button in a head
  });
  const end = (e) => {
    pointers.delete(e.pointerId); if (!down) return; const d = down; down = null; controls.enabled = true;
    const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y), ms = performance.now() - d.at;
    if (d.board) { const p = pickAt(e.clientX, e.clientY); perform({ do: "board", type: "up", u: p && p.uv ? p.uv.x : 0, v: p && p.uv ? 1 - p.uv.y : 0 }); gesture(dist < 7 ? "board-tap" : "board-drag", { dist: Math.round(dist), ms: Math.round(ms) }); return; }
    if (d.n > 1 || pinch) { gesture("pinch", { ms: Math.round(ms) }); pinch = null; return; }
    if (dist < 7 && ms < 600) { gesture("tap", { x: Math.round(e.clientX), y: Math.round(e.clientY), ms: Math.round(ms) }); click(e.clientX, e.clientY); }
    else if (dist < 7) gesture("hold", { x: Math.round(e.clientX), y: Math.round(e.clientY), ms: Math.round(ms) }); // a long press does nothing
    else gesture("drag", { dist: Math.round(dist), ms: Math.round(ms), button: d.button });
  };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); down = null; pinch = null; controls.enabled = true; });
  canvas.addEventListener("wheel", (e) => { if (board) { const p = pickAt(e.clientX, e.clientY); if (p && p.kind === "board") { e.preventDefault(); e.stopImmediatePropagation(); perform({ do: "board", type: "wheel", u: p.uv.x, v: 1 - p.uv.y, extra: { dy: e.deltaY, dx: e.deltaX } }); return; } } }, { capture: true, passive: false });
  const keys = new Set();
  addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); perform({ do: "pause" }); }
    else if (e.key === "Escape") perform({ do: "back" });
    else if (e.key === "]" || e.key === "+") perform({ do: "speed", i: speedIndex + 1 });
    else if (e.key === "[" || e.key === "-") perform({ do: "speed", i: speedIndex - 1 });
    else if (e.key === "," || e.key === "<") perform({ do: "seek", s: playS - 3 });
    else if (e.key === "." || e.key === ">") perform({ do: "seek", s: playS + 3 });
    else if (e.key === "h" || e.key === "Home") perform({ do: "home" });
    else if ((e.key === "l" || e.key === "L") && !e.metaKey && !e.ctrlKey) perform({ do: "export" }); // the flight recorder, from the keyboard
    else keys.add(e.key.toLowerCase());
  });
  addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  addEventListener("blur", () => keys.clear()); // a key held while the window lost focus must not walk on
  window.__keys = keys;
  addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
}
let orbiting = false, orbitFrom = null; // log: an orbit gesture in progress (OrbitControls' start/end)
// walking: WASD or the arrows at a steady pace (Shift: faster), Q/E turn on the spot; the same in the room and
// inside a head (there in the head's own scale, kept under its dome); the camera slides along furniture and walls
// (it never snaps) and the selection stays as it is
const WALK_MPS = 2.2, TURN_RPS = 1.5;
let walkLogAt = -1;
function walkKeys(dt) {
  const keys = window.__keys; if (!keys || !keys.size) return;
  const fwdK = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
  const sideK = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
  const turnK = (keys.has("q") ? 1 : 0) - (keys.has("e") ? 1 : 0);
  if (!fwdK && !sideK && !turnK) return;
  if (rig.flight && ["enter", "leave"].includes(rig.flight.kind)) return; // never strand the camera between the lid and the head
  rig.stop("keys");
  const head = inHead() || (sel && sel.focusId);
  const scale = head ? 0.12 * headK() : 1; // inside a head: its own pace (about a head's width a second)
  const fast = keys.has("shift") ? 2 : 1;
  if (turnK) { const off = controls.target.clone().sub(camera.position); off.applyAxisAngle(v3(0, 1, 0), turnK * TURN_RPS * dt); controls.target.copy(camera.position).add(off); }
  if (fwdK || sideK) {
    const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize(); const r = v3(-f.z, 0, f.x);
    const step = f.multiplyScalar(fwdK).addScaledVector(r, sideK).normalize().multiplyScalar(WALK_MPS * scale * fast * dt);
    let want = camera.position.clone().add(step);
    if (head) { // keep under the dome: no farther from the head's centre than the view one enters with, above its floor
      const c = sel.anchor || headPos(sel.id); if (c) { const k = headK(); const h = want.clone().sub(c); const hz = v3(h.x, 0, h.z); const lim = 0.62 * k; if (hz.length() > lim) hz.setLength(lim); want = v3(c.x + hz.x, Math.max(c.y - 0.12 * k, Math.min(c.y + 0.3 * k, want.y)), c.z + hz.z); }
    } else want = rig.resolve(want, { skip: sel && sel.id });
    const moved = want.clone().sub(camera.position); camera.position.add(moved); controls.target.add(moved);
  }
  if (amb - walkLogAt > 0.5) { walkLogAt = amb; log.ev("camera", "walk", { keys: [...keys].join(""), head: !!head }); } // log: walking (twice a second at most)
}

// ---------------------------------------------------------------- one frame
const sitCache = new Map();
let boardAt = -1, boardHot = true; const boardFr = new THREE.Frustum(), boardPV = new THREE.Matrix4();
const boardSeen = () => { boardPV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); boardFr.setFromProjectionMatrix(boardPV); return boardFr.intersectsObject(boardMesh); };
let ext = null; // ?replay=1: {playS, cam: {p, t, fov}} from outside (tools/replay.mjs)
const applyExt = () => { if (!ext || !ext.cam) return; const c = ext.cam; camera.position.set(...c.p); controls.target.set(...c.t); if (c.fov && c.fov !== camera.fov) { camera.fov = c.fov; camera.updateProjectionMatrix(); } camera.lookAt(controls.target); };
function step(dt) {
  // live: the playhead runs only up to what the driver released, and the room's own motion with it
  let moving = true;
  if (ext) { moving = !live || (!live.viewingPast && Math.abs(ext.playS - playS) > 1e-6); playS = ext.playS; if (live) live.setPlayhead(playS); } // replay: the log's playhead
  else if (live) { const lim = live.released(); moving = !live.viewingPast && playS < lim - 1e-6; if (catchUp !== null && playS >= catchUp) catchUp = null; const rate = catchUp !== null ? CATCH_UP : SPEEDS[speedIndex]; if (moving) playS = Math.min(lim, catchUp !== null ? Math.min(catchUp, playS + dt * rate) : playS + dt * rate); live.setPlayhead(playS); }
  else if (!paused) { playS += dt * SPEEDS[speedIndex]; if (playS >= LOOP) playS -= LOOP; }
  amb += dt; if (moving) wamb += dt;
  const wa = live ? wamb : amb; // live: what the world animates with
  const t = tNow(); sitCache.clear();
  for (const [id, v] of lids) { const want = sel && sel.id === id ? sel.lid : 0; lids.set(id, want >= v ? want : Math.max(want, v - dt / 0.5)); if (!lids.get(id) && !(sel && sel.id === id)) lids.delete(id); }
  if (sel && sel.head && !lids.has(sel.id)) lids.set(sel.id, sel.lid);
  const dark = people.update(playS, wa, { id: sel && sel.id, skinHidden: !!(sel && sel.skinHidden), lidOf });
  if (models) models.update({ people, playS, t, dt: moving ? dt : 0, camera, selected: sel && sel.id, frame: frameN++ }); // the desk models: built near the camera, their marbles at t
  // a blackout (everyone ended at once): the lights go out
  const k = 1 - 0.85 * dark; hemi.intensity = 1.35 * k; sun.intensity = 1.7 * k; fill.intensity = 0.35 * k; scene.background.copy(SKY).lerp(NIGHT, dark); scene.fog.color.copy(scene.background);
  building.update(playS, t, wa, { paused: live ? !moving : displayPaused ?? paused, speedIndex, duration: sim.duration, clockRing: recentIn(clockRings, playS, 0.9), camera });
  stations.update(playS, wa);
  desks.update(playS, t, wa, people.occupantOf, { dark: dark > 0.3, situation: (id) => sitCache.get(id) || sitCache.set(id, sim.situationAt(id, t)).get(id), timerRing: (id) => recentIn(timerRings.get(id), playS, 0.9), timerSet: (id) => (timerPending.get(id) || []).some(([a, b]) => playS >= a && playS < b), talking: (a, b) => recentIn(talkSpans.get([a, b].sort().join("|")), playS, 0.8), dropping: (k) => tubes.dropping(k) });
  const active = tubes.update(playS, spot && spot.messages.size ? spot.messages : null);
  ticker.update(playS, wa);
  if (revealNext) { const pw = revealNext; revealNext = null; revealConsequence(pw); }
  if (board && (REC || boardHot || (amb - boardAt >= 1 / 15 && boardSeen()))) { boardAt = amb; boardHot = false; board.update(t); if (board.dirty) { boardTex.needsUpdate = true; board.dirty = false; log.note("board"); } }
  for (const r of Object.values(rings)) r.visible = false;
  hoverRing.visible = false; if (hoverId && !(sel && sel.id === hoverId) && !inHead()) { const seat = people.seatOfActor(hoverId, playS); const pos = seat && seat.avatar.root.visible ? seat.avatar.root.position : stations.byId.get(hoverId)?.group.position; if (pos) { hoverRing.visible = true; hoverRing.position.set(pos.x, 0.035, pos.z); } }
  if (spot) for (const id of spot.actors) { let pos = null; const seat = people.seatOfActor(id, playS); if (seat && seat.avatar.root.visible) pos = seat.avatar.root.position; else { const st = stations.byId.get(id); if (st) pos = st.group.position; } if (!pos) continue; const r = ringFor(id); r.visible = true; r.position.set(pos.x, 0.03, pos.z); r.scale.setScalar(1 + 0.08 * Math.sin(amb * 5)); }
  rig.update(dt); // the camera moves only along a flight someone started (no drift)
  walkKeys(dt); applyExt();
  if (sel && sel.head) {
    const live_c = headPos(sel.id);
    if (!live_c) { sel = null; hideHeads(); }
    else {
      const anchored = inHead() || sel.focusId; const c = anchored && sel.anchor ? sel.anchor : live_c;
      const dist = camera.position.distanceTo(c);
      const kd = dist / headK(); sel.skinHidden = kd < 0.95 && sel.stage !== "approach";
      const h = sel.head; h.group.visible = sel.skinHidden || lidOf(sel.id) > 0.02; h.group.position.copy(c); h.group.rotation.y = anchored ? sel.anchorF ?? facing(sel.id) : facing(sel.id);
      detailNow = sel.focusId ? Math.max(clamp01((1.0 - kd) / 0.7), 0.9) : clamp01((1.0 - kd) / 0.7); h.setDetail(detailNow); h.skull.visible = sel.skinHidden;
      h.update(t, live && !moving ? 0 : dt, playS); // the playhead itself: past a live run's last instant warp(t) stops
      camera.near = anchored ? Math.max(0.004, Math.min(0.05, dist * 0.05)) : 0.05;
    }
  } else camera.near = 0.05;
  { const want = sel && sel.head && sel.skinHidden ? insideFov() : FOV; if (Math.abs(want - camera.fov) > 0.01) camera.fov += (want - camera.fov) * Math.min(1, dt * 5); } // narrow screens: a wider view inside a head
  camera.updateProjectionMatrix();
  if (slipMsg) { const a = active.find((x) => x.msg.id === slipMsg.id); if (a) { slip.visible = true; slip.position.copy(a.pos).add(v3(0, 0.62, 0)); slip.quaternion.copy(camera.quaternion); const e = ease(clamp01((amb - slipMsg.at) / 0.35)); const d = camera.position.distanceTo(slip.position); const sc = Math.max(0.55, Math.min(1.6, d / 5)) * e; slip.scale.set(sc, sc, 1); } else if (!(slip.visible && amb - slipMsg.at > 0.4)) slip.visible = false; } else slip.visible = false;
  // the free camera inside a head cannot be dragged into its machines: a machine in focus keeps half its framing
  // distance, the whole head a quarter of the entry view's
  controls.minDistance = sel && sel.focusId ? Math.max(0.03, 0.55 * (sel.focusDist || 0.1)) : inHead() ? 0.14 * headK() : 0.9;
  if (!REC && !ext) controls.update();
  // nothing cuts through the frame: out of furniture, walls and people (not while inside a head)
  if (!ext && !inHead() && !(sel && sel.focusId) && !(rig.flight && rig.flight.kind === "enter")) { pushes.length = 0; const q = rig.resolve(camera.position, { skip: sel && sel.id, out: pushes }); if (q.distanceToSquared(camera.position) > 1e-8) { camera.position.copy(q); camera.lookAt(controls.target); if (amb - pushLogAt > 0.3) { pushLogAt = amb; log.ev("camera", "push", { n: pushes.length, ...pushes[0], by: rig.flight ? rig.flight.kind : orbiting ? "orbit" : "other" }); } } } // log: collision pushes
  applyExt();
  if (liveControls) { if (amb - liveSyncAt > 0.4) { liveSyncAt = amb; liveControls.sync(); } liveControls.update(amb); } // live
  recorder.update();
  if (!REC && !REPLAY) { const c0 = performance.now(); observe(moving); log.charge(performance.now() - c0 - viewMs); viewMs = 0; } // log: camera, mode, world, view
}

// ---------------------------------------------------------------- what the flight recorder samples each frame (engine/log.js)
const pushes = []; let pushLogAt = -1, detailNow = 0;
let viewMs = 0, modeLast = "", worldAt = -1, viewAt = -1, limitHit = "", lastT = null, lidOpen = false, detailLogged = -1, progs = 0;
function modeNow(moving) {
  let m = !sel ? "overview" : sel.focusId ? `machine:${sel.id}` : inHead() ? `${sel.stage === "inside" ? "head" : sel.stage}:${sel.id}` : sel.head ? `person:${sel.id}` : `station:${sel.id}`;
  if (slipMsg) m += " +slip";
  if (live) m += live.viewingPast ? " +past" : moving ? " +playing" : " +rest"; else if (paused) m += " +paused";
  return m;
}
function observe(moving) {
  log.camera(camera.position, controls.target, camera.fov, playS);
  const m = modeNow(moving); if (m !== modeLast) { log.ev("mode", "change", { from: modeLast, to: m, cause: lastAct }); modeLast = m; }
  if (orbiting) { const lim = controls.getPolarAngle() >= controls.maxPolarAngle - 0.002 ? "polar" : controls.getDistance() <= controls.minDistance + 0.005 ? "min-distance" : controls.getDistance() >= controls.maxDistance - 0.01 ? "max-distance" : ""; if (lim && lim !== limitHit) log.ev("camera", "limit", { which: lim }); limitHit = lim; } else limitHit = "";
  if (sel && sel.head) { const lo = lidOf(sel.id) > 0.5; if (lo !== lidOpen) { log.ev("world", "lid", { id: sel.id, open: lo }); lidOpen = lo; } if (Math.abs(detailNow - detailLogged) > 0.15 || (detailNow !== detailLogged && (detailNow === 0 || detailNow === 1))) { log.ev("world", "detail", { id: sel.id, d: +detailNow.toFixed(2) }); detailLogged = detailNow; } } else { if (lidOpen) log.ev("world", "lid", { open: false }); lidOpen = false; detailLogged = -1; }
  if (amb - worldAt >= 1) {
    worldAt = amb; const t = tNow();
    log.ev("world", "tick", { playS: +playS.toFixed(2), t: Math.round(t), rate: live ? (moving ? SPEEDS[speedIndex] : 0) : paused ? 0 : SPEEDS[speedIndex] });
    if (lastT !== null && t > lastT) { const ch = sim.eventsBetween(lastT, t).filter((e) => e.type === "spawn" || e.type === "end"); if (ch.length) log.ev("world", "people", { arrive: ch.filter((e) => e.type === "spawn").map((e) => e.actor), leave: ch.filter((e) => e.type === "end").map((e) => e.actor) }); }
    lastT = t;
  }
  if (consequenceCheck && amb >= consequenceCheck.due) checkConsequence();
  if (amb - viewAt >= 0.5) { viewAt = amb; const c0 = performance.now(); log.lastView = viewSample(); log.ev("view", "frame", log.lastView); viewMs = performance.now() - c0; log.charge(viewMs, true); log.note("view"); }
}
// what can be seen and picked: boxes in world space (static ones are kept until the world is rebuilt)
const viewer = createViewSampler(THREE); let viewBoxes = null;
const B3 = (o) => new THREE.Box3().setFromObject(o);
function subjects() {
  if (!viewBoxes) {
    scene.updateMatrixWorld();
    viewBoxes = stations.list.map((st) => { const b = B3(st.group); return { kind: "station", id: st.id, min: b.min, max: b.max }; });
    const bb = B3(boardMesh); viewBoxes.push({ kind: "board", id: "board", min: bb.min, max: bb.max });
    const rb = recorder.box(); viewBoxes.push({ kind: "recorder", id: "recorder", min: rb.min, max: rb.max });
    for (const k of ["clock", "system"]) { const b = new THREE.Box3(); for (const p of building.pick) if (p.kind === k) b.expandByObject(p.object); if (!b.isEmpty()) viewBoxes.push({ kind: k === "system" ? "directory" : k, id: k, min: b.min, max: b.max }); }
  }
  const out = [...viewBoxes];
  for (const seat of people.seats.values()) { const r = seat.avatar.root; if (!r.visible || !seat.current) continue; const h = seat.P && seat.P.sit > 0.5 ? 1.45 : 1.85, p = r.position; out.push({ kind: "actor", id: seat.current.id, min: v3(p.x - 0.35, 0, p.z - 0.35), max: v3(p.x + 0.35, h, p.z + 0.35) }); }
  if (liveControls) for (const it of liveControls.items.values()) { if (!it.ui.group.parent) continue; const b = B3(it.ui.group); out.push({ kind: "control", id: it.c.id, min: b.min, max: b.max }); }
  for (const a of tubes.active) out.push({ kind: "capsule", id: a.msg.id, min: a.pos.clone().subScalar(0.12), max: a.pos.clone().addScalar(0.12) });
  { const b = ticker.box(); out.push({ kind: "ticker", id: "ticker", min: b.min, max: b.max }); }
  if (models) for (const m of models.stats().models) { const b = models.boxOf(m.id); if (b) out.push({ kind: "model", id: m.id, min: b.min, max: b.max }); }
  return out;
}
let platesKept = null, platesN = -1;
const attached = (o) => { let q = o; while (q.parent) q = q.parent; return q === scene; };
function viewSample() {
  const subs = subjects(); let selected = null;
  if (sel && !inHead() && !sel.focusId) selected = subs.find((x) => x.id === sel.id && (x.kind === "actor" || x.kind === "station")) || null;
  if (!platesKept || platesN !== PLATES.size) { platesKept = []; for (const p of PLATES) { if (!attached(p)) PLATES.delete(p); else platesKept.push(p); } platesN = PLATES.size; } // the world's plates change only when it is built
  const plates = [...platesKept];
  if (sel && sel.head && sel.head.plates && sel.head.group.visible) for (const x of sel.head.plates()) plates.push(x.mesh);
  if (models && !inHead()) plates.push(...models.plates());
  const out = viewer.sample({ camera, W: innerWidth, H: innerHeight, subjects: subs, plates, selected, occluded: (id) => occludedFrom(camera.position, id) });
  if (sel && sel.head && sel.skinHidden && (inHead() || sel.focusId)) out.head = headView(sel.head);
  return out;
}
// inside a head: is the camera inside a machine or a station (geometry within the near plane), and how many plates
// of what is in focus (the whole head when nothing is) are cut by the frame's edge?
const hv = new THREE.Vector3();
function headView(h) {
  const ids = h.states(); const cam = camera.position; let inside = null;
  if (ids.length <= 120) for (const id of ids) { const b = h.boundsOf(id).box; const sz = b.getSize(hv); const m = Math.min(sz.x, sz.y, sz.z) * 0.04; if (cam.x > b.min.x + m && cam.x < b.max.x - m && cam.y > b.min.y + m && cam.y < b.max.y - m && cam.z > b.min.z + m && cam.z < b.max.z - m && (!inside || b.getSize(hv).lengthSq() < inside.v)) inside = { id, v: b.getSize(hv).lengthSq() }; }
  // a machine around the camera that holds the focus is the room the camera looks inside of, not geometry in its way
  if (inside && sel.focusId && inside.id !== sel.focusId && h.pathTo(sel.focusId).includes(inside.id)) inside = null;
  const fb = sel.focusId ? h.boundsOf(sel.focusId).box : null; let clipped = 0, shown = 0; camera.updateMatrixWorld();
  for (const p of h.plates()) {
    const m = p.mesh; m.getWorldPosition(hv); if (fb && !fb.containsPoint(hv)) continue;
    const g = m.geometry.parameters || {}; const w = (g.width ?? 1) / 2, hh = (g.height ?? 1) / 2; let inN = 0, n = 0;
    for (const [x, y] of [[-w, -hh], [w, -hh], [-w, hh], [w, hh]]) { const q = hv.set(x, y, 0).applyMatrix4(m.matrixWorld).project(camera); n++; if (q.z > -1 && q.z < 1 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1) inN++; }
    if (inN) shown++; if (inN && inN < n) clipped++;
  }
  return { focus: sel.focusId || null, inside: inside ? inside.id : null, clipped, shown };
}
// is the selected person's head (a station's middle) hidden from p by something else? (the first thing a ray meets)
const occRay = new THREE.Raycaster();
function occludedFrom(p, id, lift = 0) {
  const st = stations.byId.get(id); const c = st ? B3(st.group).getCenter(new THREE.Vector3()) : headPos(id); if (!c) return false; c.y += lift;
  const d = c.clone().sub(p); const L = d.length(); occRay.set(p, d.normalize()); occRay.far = L;
  // only the people whose box the ray crosses are tested mesh by mesh (61 avatars cost 2.5 ms otherwise)
  const seg = new THREE.Ray(p, d), bx = new THREE.Box3(), lo = new THREE.Vector3(), hi = new THREE.Vector3();
  const near = people.roots().filter((r) => r.visible && seg.intersectsBox(bx.set(lo.set(r.position.x - 0.4, 0, r.position.z - 0.4), hi.set(r.position.x + 0.4, 2.4, r.position.z + 0.4))));
  const cands = [...near, ...stations.list.map((s) => s.group), ...building.occluders, desks.root];
  for (const h of occRay.intersectObjects(cands, true)) { let vis = true; for (let q = h.object; q; q = q.parent) if (!q.visible) { vis = false; break; } if (!vis) continue; const o = h.object.userData; if (o.actorId === id || o.stationId === id) return false; return h.distance < L - 0.3; }
  return false;
}
// what was within reach of a tap: subjects whose screen rectangle is within 40 px (0 = inside it)
function nearOf(x, y) {
  const out = []; camera.updateMatrixWorld();
  for (const s of subjects()) { const r = viewer.rect(s.min, s.max, camera, innerWidth, innerHeight); if (!r) continue; const dx = Math.max(r.x0 - x, 0, x - r.x1), dy = Math.max(r.y0 - y, 0, y - r.y1), d = Math.hypot(dx, dy); if (d <= 40) out.push([s.kind, s.id, Math.round(d), Math.round(r.frac * 1000) / 10]); }
  return out.sort((a, b) => a[2] - b[2] || a[3] - b[3]).slice(0, 5);
}

// ---------------------------------------------------------------- live: its controls, and the world rebuilt as the run grows
liveSyncAt = -1;
if (live) {
  const { createControls } = await import("./live/controls.js");
  liveControls = createControls({ scene, live, still: params.has("still") });
  const worldRefs = () => ({ plan, stations, sim, building, people, desks, t: () => tNow(), nameOf });
  const drop = (o) => { scene.remove(o); o.traverse((x) => { x.geometry?.dispose(); for (const m of Array.isArray(x.material) ? x.material : x.material ? [x.material] : []) m.map?.dispose(); }); };
  const rebuildWorld = (info = {}) => {
    const t0 = performance.now(); log.note("rebuild"); // log: world rebuilds and how long they take
    for (const r of [building.root, stations.root, desks.root, tubes.root, recorder.root, ...people.roots()]) drop(r);
    plan = makePlan(sim, planCfg(plan));
    R = plan.room; RW = R.x1 - R.x0; RD = R.z1 - R.z0; RC = new THREE.Vector3((R.x0 + R.x1) / 2, 0, (R.z0 + R.z1) / 2);
    const sp = Math.max(RW, RD) * 0.62 + 4; sun.position.set(RC.x - 14, 26, RC.z + 16); sun.target.position.copy(RC);
    Object.assign(sun.shadow.camera, { left: -sp, right: sp, top: sp, bottom: -sp }); sun.shadow.camera.updateProjectionMatrix();
    buildWorld();
    boardMesh.geometry.dispose(); boardMesh.geometry = new THREE.PlaneGeometry(plan.board.w, plan.board.h); mountBoard();
    if (boardMod) makeBoard();
    // heads are updated in place (a press inside one must not rebuild it: its marbles keep their places); a reset
    // or a head that cannot refresh is built again
    if (info.reset) pressLabels.length = 0;
    if (models) { models.reseat(); if (info.reset) models.clear(); else models.refresh(); } // the desk models: refreshed in place (their marbles keep their places), found again at their new seats
    for (const [id, h] of [...heads]) { if (!info.reset && h.refresh && sim.chartOf(id)) { try { if (h.refresh() !== false) { log.ev("world", "head", { id, how: "refreshed" }); continue; } } catch (err) { console.warn("head refresh", id, err.message); } } scene.remove(h.group); try { h.dispose(); } catch {} heads.delete(id); }
    if (sel && sel.head && !heads.has(sel.id)) { const h = headFor(sel.id); h.focus(sel.focusId || null); sel.head = h; }
    liveControls.rebuild(worldRefs()); placeTicker(playS);
    if (window.api) Object.assign(window.api, { plan, people, stations, desks, tubes, building });
    liveSyncAt = -1; // the controls' lit and dim at the next frame (the driver is no longer busy then)
    viewBoxes = null; platesKept = null; if (pressWatch && !info.reset) { revealNext = pressWatch; pressWatch = null; } /* after the next update: the new people stand at their seats only then */ log.ev("world", "rebuild", { ms: Math.round(performance.now() - t0), events: sim.trace.events.length, actors: sim.actors.length }); // log:
  };
  live.on("change", rebuildWorld);
  liveControls.rebuild(worldRefs()); placeTicker(playS);
  if (!REPLAY && !REC) { people.update(playS, 0, { id: null, skinHidden: false, lidOf }); const v = startView(); /* the people at their seats first: the view frames them */ camera.position.copy(v.pos); controls.target.copy(v.tgt); controls.update(); } // live: start where the inputs and the person they drive are
  window.live = live;
  live.screen = () => liveControls.screenPositions(camera, innerWidth, innerHeight);
  live.pressControl = (id) => liveControls.press(id);
}

// ---------------------------------------------------------------- live loop / film hooks
window.DURATION = LOOP * 1000;
window.state = () => ({ system: SYSTEM, playS, t: tNow(), paused, speedIndex, sel: sel && { id: sel.id, stage: sel.stage, focusId: sel.focusId }, slip: slipMsg, boardStatus, headStatus, loop: LOOP, actors: sim.actors.length, hub: plan.hub, room: [RW, RD] });
window.api = { sim, plan, cfg, scene, camera, controls, people, stations, desks, tubes, building, board: () => board, heads, headFor, HEAD_SCALE, ticker, models,
  select, enterHead, focusHead, frameAll, startView, personPts, boxPts, inFrame, hiddenPerson, back, openCapsule, walkTo, flyTo, home, homeView, togglePause, setSpeed, click, pickAt, perform, intentOf, recorder: () => recorder,
  setPlay: (s) => (playS = s), getPlay: () => playS, setPaused: (b) => (paused = b), setDisplayPaused: (b) => (displayPaused = b), clearSpot: () => (spot = null),
  reset: () => { sel = null; slipMsg = null; spot = null; flight = null; rig.stop(); lids.clear(); hideHeads(); board && board.highlight({}); }, rig, frameOf, leaveHead,
  getActive: () => tubes.active, tick: (sec) => { for (let i = 0; i < Math.round(sec * 30); i++) step(1 / 30); } };
if (REC) {
  const { makeFilm } = await import("./film.js");
  const film = makeFilm({ THREE, api: window.api, sim, plan, step, render: () => renderer.render(scene, camera), setAmb: (a) => (amb = a), camera, controls, cfg });
  window.DURATION = film.duration * 1000; window.setTime = (ms) => film.setTime(ms / 1000); window.filmScript = film.script;
  window.ready = true;
} else {
  let last = performance.now();
  // ?noloop: tools/shoot.mjs steps the world itself (api.tick) and renders with api.render, so stills are exact
  if (params.has("noloop") || REPLAY) window.api.render = () => renderer.render(scene, camera);
  else renderer.setAnimationLoop(() => {
    log.frameStart(); // log: every frame's dt
    const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now; step(dt); renderer.render(scene, camera);
    const np = renderer.info.programs?.length || 0; if (np !== progs) { if (progs) log.note("shader"); progs = np; } // log: a shader compiled in this frame
    log.frameEnd(renderer.info.render);
  });
  // ?replay=1: tools/replay.mjs steps the world by the log's time and sets the camera and the playhead from it
  if (REPLAY) window.api.replay = { step: (dt, e, render = true) => { ext = e; step(dt); if (render) renderer.render(scene, camera); }, perform: (a) => perform(a, "replay"), mode: () => modeNow(true), view: () => viewSample() };
  if (params.get("log") === "1") log.arm(); // a crash copy in sessionStorage, exported with the next session
  log.ev("session", "ready", { ms: Math.round(performance.now() - log.origin) }); log.note("first-frame");
  window.ready = true;
}
