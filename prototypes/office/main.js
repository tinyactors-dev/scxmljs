// main.js: The Office for ANY system of statecharts. ?system=<name> loads data/<name>/trace.json
// (and data/<name>/office.json when there is one); data/index.json lists the systems, which the
// directory by the door switches between. Everything visible is a function of (playS = playback
// second of the run, amb = ambient second, the visitor's selections, the camera). The visitor is a walker in
// first person (engine/player.js): nothing moves or turns them but their own input, the spawn, H (back to the
// door) and a door into or out of a machine room. Film mode (?rec=1) drives a free camera from film.js.
import * as THREE from "three";
import { createSim } from "./core/sim.js";
import { makePlan } from "./core/plan.js";
import { buildBuilding } from "./world/building.js";
import { buildStations } from "./world/stations.js";
import { buildDesks } from "./world/desks.js";
import { buildPeople } from "./world/people.js";
import { buildTubes, summaryText, family } from "./world/tubes.js";
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
import { createMachineRoom, ROOM, fovFor } from "./world/machineroom.js";
import { createOverlay } from "./engine/overlay.js";
import { createPlayer, FP } from "./engine/player.js";
import { createBody } from "./world/body.js";

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
// the free camera (the film, ?rec=1) flies along paths; everyone else walks in first person (FP)
const FREE = REC;
// ?third=1 (a replay): a camera behind and above the visitor, who is drawn as a whole block person
const THIRD = REPLAY && params.has("third");
const camera = new THREE.PerspectiveCamera(FREE ? 42 : FP.fov, innerWidth / innerHeight, FREE ? 0.05 : FP.near, 400);
// home (the film's overview): frame whatever was built, from the south-east
function homeView() {
  const tgt = RC.clone().add(new THREE.Vector3(0, 0.3, 0.6));
  const vfov = (camera.fov * Math.PI) / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const need = Math.max((RD * 0.62 + 2) / Math.tan(vfov / 2), (RW * 0.56 + 2) / Math.tan(hfov / 2)) * 0.82;
  const dir = new THREE.Vector3(0.36, 0.58, 0.73).normalize();
  return { pos: tgt.clone().addScaledVector(dir, need), tgt };
}
const H0 = homeView(); camera.position.copy(H0.pos);
// what the camera looks at: the free camera's goal (the film's flights move it), else a point ahead of the eye
const controls = { target: H0.tgt.clone(), enabled: true, update() { camera.lookAt(this.target); }, addEventListener() {} };
controls.update();
// the visitor: a walker (engine/player.js) and their arms and shadow (world/body.js)
const player = createPlayer();
const body = createBody();
const blob = body.blob(); blob.visible = false;
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
// what is drawn over the view (engine/overlay.js): the iris between the office and a machine room, the opened
// capsule's card with its close stamp, the machine room's exit and its plaque
const overlay = createOverlay();
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
  board.on("focus", () => { if (!FREE) return; /* on foot, the visitor walks up to the board */ const p = boardMesh.position, n = v3(0, 0, 1).applyQuaternion(boardMesh.quaternion), t = Math.tan(camera.fov * Math.PI / 360), d = Math.max(plan.board.h / 2 / t, plan.board.w / 2 / (t * camera.aspect)) * 1.04; boardBack = boardBack || { pos: camera.position.clone(), tgt: controls.target.clone() }; flyTo(p.clone().addScaledVector(n, d), p.clone(), 1.3); }); // the board's empty part touched: stand squarely in front of it (Escape: back)
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
// each person's machines also stand on their desk as a live tabletop model (world/models.js: the same createHead)
const models = createHead ? createModels({ scene, sim, createHead }) : null;
let frameN = 0;
// a person's machines, built once and kept; shown only in the machine room (world/machineroom.js), never in the office
const heads = new Map();
const machineRoom = createMachineRoom();
function headFor(id) {
  if (heads.has(id)) return heads.get(id);
  let h;
  log.note("head-built"); // log: building a head can take a while
  log.ev("world", "head", { id, how: "built" }); // log:
  if (createHead && sim.chartOf(id)) { try { h = createHead({ THREE, sim, actorId: id, options: { ...(live ? { interactive: true, judge: (ev) => !live.busy && !live.viewingPast && live.accepts(id, ev), whyNot: (ev) => (live.viewingPast ? "looking back" : live.whyNot(id, ev)) } : {}) } }); } catch (err) { console.warn("createHead", id, err.message); } }
  if (!h) { const group = new THREE.Group(); group.add(box(6, 6, 6, "#c86b5a")); h = { group, update() {}, setDetail() {}, pick: () => null, focus() {}, dispose() {}, placeholder: true, boundsOf: () => ({ box: new THREE.Box3().setFromObject(group) }), states: () => [], movesOf: () => [], plates: () => [] }; }
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
let sel = null, slipMsg = null, spot = null, flight = null, cue = null; // cue: on foot, what a press changed out of view ({ids, machines, until}) // flight: kept for the live hooks; the rig flies the camera
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
function home(dur = 1.6) { if (!FREE) return homeFade(); const h = live ? startView() : homeView(); flyTo(h.pos, h.tgt, dur); } // on foot: a fade to the door, never a flight
const headPos = (id) => people.headCenter(id, playS);
const facing = (id) => people.facingOf(id, playS);
// the machine room (world/machineroom.js) is a place of its own: inRoom while it is what is drawn and what the
// camera stands in; trans while the iris closes on one place and opens on the other; officePose: the office view
// the visitor left, given back exactly on the way out; officeCam: that view, for what in the office looks at the
// camera while the visitor is away (the desk models, the ceiling)
let inRoom = false, trans = null, officePose = null, roomEntry = null;
const officeCam = new THREE.PerspectiveCamera();
const inHead = () => sel && sel.head && ["entering", "inside", "leaving"].includes(sel.stage);
const xyz = (p) => [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)];
// a world point on screen (px), or null behind the camera
const screenPt = (p) => { camera.updateMatrixWorld(); const q = p.clone().project(camera); return q.z > 1 ? null : { x: ((q.x + 1) / 2) * innerWidth, y: ((1 - q.y) / 2) * innerHeight }; };
const clampPt = (q) => (q ? { x: Math.min(innerWidth, Math.max(0, q.x)), y: Math.min(innerHeight, Math.max(0, q.y)) } : { x: innerWidth / 2, y: innerHeight / 2 });
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
    const h = headFor(id); h.focus(null);
    sel = { id, at: amb, focusId: null, head: h, stage: "approach" };
    if (FREE) { const v = frameOf(id); if (v) flyTo(v.pos, v.tgt, 1.4); } // on foot nothing moves the visitor
  } else {
    sel = { id, at: amb, focusId: null, head: null, stage: "close" };
    const st = stations.byId.get(id);
    if (!FREE) { spot = { actors: new Set([id]), messages: new Set(), at: amb }; return; } // on foot: its ring pulses where it stands
    if (st) { const p = st.group.getWorldPosition(new THREE.Vector3()); const fwd = new THREE.Vector3(Math.sin(st.group.rotation.y), 0, Math.cos(st.group.rotation.y)); const tgt = p.clone().add(v3(0, 1.2, 0)); flyTo(rig.resolve(p.clone().addScaledVector(fwd, 3.2).add(v3(0.9, 1.9, 0))), tgt, 1.4); }
    else if (/timer|clock/i.test(`${a?.kind} ${id}`)) flyTo(rig.resolve(v3(plan.clock.x, 2.6, R.z0 + 4)), v3(plan.clock.x, 2.6, R.z0), 1.4);
  }
}
// into a person's machines: a short push toward their head while the iris closes on it, then the machine room
// opens round their machines (ENTER_S + OPEN_S <= 0.6 s); out: the iris closes on the room and opens on the office
// view the visitor left, the person in its middle. Each is logged as a camera flight (fly ... arrive)
const ENTER_S = 0.26, LEAVE_S = 0.22, OPEN_S = 0.3;
function enterHead() {
  if (!sel || !sel.head || inHead() || trans) return;
  const c = headPos(sel.id); if (!c) return;
  rig.stop("enter"); closeCard("enter");
  officePose = { pos: camera.position.clone(), tgt: controls.target.clone(), fov: camera.fov, feet: player.pos.clone(), yaw: player.yaw, pitch: player.pitch }; officeCam.copy(camera); // on foot: given back exactly on the way out
  sel.stage = "entering";
  trans = { kind: "enter", t: 0, me: sel, from: camera.position.clone(), tgtFrom: controls.target.clone(), c: c.clone(), sp: clampPt(screenPt(c)), swapped: false };
  log.ev("camera", "fly", { kind: "enter", dur: ENTER_S + OPEN_S, from: xyz(camera.position), to: xyz(c), tgt: xyz(c), via: 0 }); log.note("flight:enter"); // log:
}
function leaveHead(then) {
  if (!inRoom || trans) { if (then) then(); return; }
  const me = sel; if (me) me.stage = "leaving";
  rig.stop("leave");
  trans = { kind: "leave", t: 0, me, then, swapped: false };
  log.ev("camera", "fly", { kind: "leave", dur: LEAVE_S + OPEN_S, from: xyz(camera.position), to: xyz(officePose.pos), tgt: xyz(officePose.tgt), via: 0 }); log.note("flight:leave"); // log:
  player.stop();
}
// the machine room's entry view: the whole machine (at its entry detail) filling the frame, seen from the front and a
// little above, as head/head.js fits it (along (0, 0.3, 1)). A chart of up to 80 states is all open from the start
// (head.js keeps every plate of an open machine legible at that framing); a bigger one opens its active path, the
// rest as the visitor comes closer or focuses a machine (roomDetail: the detail follows the distance from there)
const ENTRY_DETAIL = (1 - 0.6) / 0.7;
const entryDetail = (h) => (h.states().length > 80 ? ENTRY_DETAIL : 1);
function roomEntryView(h) {
  camera.fov = fovFor(camera.aspect); camera.updateProjectionMatrix();
  h.setDetail(entryDetail(h)); h.update(tNow(), 0, playS);
  const b = h.boundsOf(null).box.clone(); b.expandByVector(b.getSize(v3(0, 0, 0)).multiplyScalar(0.04));
  // from the elevation head.js fits to, unless a higher one brings a deep machine clearly nearer
  let v = null; for (const el of [Math.atan2(0.3, 1), 0.42, 0.55]) { const w = frameAll(boxPts(b), { dir: v3(0, 0, 1), el, margin: 1.06, minD: ROOM.minDist, free: true }); if (!v || w.dist < v.dist * 0.9) v = w; }
  return { pos: machineRoom.contain(v.pos), tgt: v.tgt, dist: v.dist };
}
const roomDetail = (h, focused) => { const kd = (0.6 * camera.position.distanceTo(roomEntry.tgt)) / roomEntry.dist; const d = Math.max(entryDetail(h) === 1 ? 1 : 0, clamp01((1 - kd) / 0.7)); return focused ? Math.max(d, 0.9) : d; };
// the swap itself: the head's group stands in the machine room only while the visitor is there
// on foot (FP) the visitor stands in the room at a scale of their own: their eye a little above the machines (the
// room is built in head units), facing the machines from where the whole of them fits in the view
function roomScale(b) { const eye = b.min.y + 0.8 * (b.max.y - b.min.y) + 0.6; return Math.min(7, Math.max(3, (eye - ROOM.floor) / FP.eye)); }
function roomSpawn(h) {
  camera.fov = FP.fov; camera.updateProjectionMatrix();
  h.setDetail(entryDetail(h)); h.update(tNow(), 0, playS);
  const b = h.boundsOf(null).box.clone(); const s = roomScale(b), c = b.getCenter(v3(0, 0, 0));
  machineRoom.mount(h.group, s);
  { const gb = new THREE.Box3().setFromObject(h.group); const ob = b.clone().union(gb); ob.min.y = ROOM.floor; ob.expandByVector(v3(0.35 * s, 0, 0.35 * s)); machineRoom.setMachine(ob); }
  player.setWorld(machineRoom.world, s);
  const eye = ROOM.floor + FP.eye * s; const pts = boxPts(b);
  let d = Math.max(b.max.z - c.z + 1.2 * s, 4); const lim = ROOM.wallR - 2 * s - Math.max(0, c.z);
  for (; d < lim; d += 0.5) { camera.position.set(c.x, eye, c.z + d); camera.lookAt(c); if (inFrame(pts, 0.86)) break; }
  d = Math.min(d, lim);
  const feet = v3(c.x, 0, c.z + d); player.place(feet, 0, Math.atan2(c.y - eye, d));
  machineRoom.setEntry(v3(feet.x, ROOM.floor, feet.z), 0);
  camera.near = FP.near * s; camera.far = 260; camera.updateProjectionMatrix(); player.apply(camera);
  return { pos: camera.position.clone(), tgt: c.clone(), dist: d, s };
}
// the swap itself: the head's group stands in the machine room only while the visitor is there
function swapIn(me) {
  inRoom = true; me.focusId = null; me.focusPoint = null; me.head.focus(null);
  const seat = people.seatOfActor(me.id, playS), av = seat && seat.avatar;
  const plaque = { title: nameOf(me.id), sub: `their machines (${sim.actor(me.id)?.chart || "chart"}) · the office runs on`, face: av?.faceMap?.image || null, accent: av ? "#" + av.M.shirt.color.getHexString() : null };
  if (!FREE) {
    roomEntry = roomSpawn(me.head); machineRoom.setPlaque(plaque); machineRoom.door.set(false);
    log.ev("world", "room", { id: me.id, in: true, scale: +roomEntry.s.toFixed(2) }); // log:
    return;
  }
  machineRoom.mount(me.head.group);
  const v = roomEntry = roomEntryView(me.head);
  camera.position.copy(v.pos); controls.target.copy(v.tgt); camera.near = 0.1; camera.far = 200; camera.updateProjectionMatrix(); camera.lookAt(controls.target);
  overlay.setExit(plaque);
  log.ev("world", "room", { id: me.id, in: true }); // log:
}
function swapOut() {
  const me = trans ? trans.me : sel; inRoom = false; machineRoom.unmount(); overlay.setExit(null); machineRoom.setPlaque(null);
  if (me) { me.focusId = null; me.focusPoint = null; if (me.head) me.head.focus(null); }
  if (!FREE) { // standing where they were, facing as they were
    player.setWorld(officeWorld, 1); const p = officePose; if (p && p.feet) player.place(p.feet, p.yaw, p.pitch); else spawn();
    camera.fov = FP.fov; camera.near = FP.near; camera.far = 400; camera.updateProjectionMatrix(); player.apply(camera);
  } else { const p = officePose || homeView(); camera.position.copy(p.pos); controls.target.copy(p.tgt); camera.fov = p.fov || 42; camera.near = 0.05; camera.far = 400; camera.updateProjectionMatrix(); camera.lookAt(controls.target); }
  log.ev("world", "room", { id: me ? me.id : null, in: false }); // log:
}
function finishTrans() {
  const tr = trans; trans = null; overlay.setIris(0);
  if (tr.me && sel === tr.me) tr.me.stage = tr.kind === "enter" ? "inside" : "approach";
  log.ev("camera", "arrive", { kind: tr.kind }); // log:
  if (tr.kind === "leave" && sel && sel.head && !headPos(sel.id)) sel = null; // the person left the office meanwhile
  if (tr.then) tr.then();
}
function stepTrans(dt) {
  const tr = trans; if (!tr) return; tr.t += dt;
  const W = innerWidth, H = innerHeight;
  if (!tr.swapped) {
    const k = clamp01(tr.t / (tr.kind === "enter" ? ENTER_S : LEAVE_S)), e = ease(k);
    if (tr.kind === "enter") { if (FREE) { camera.position.lerpVectors(tr.from, tr.c, 0.45 * e); controls.target.lerpVectors(tr.tgtFrom, tr.c, e); camera.lookAt(controls.target); } overlay.setIris(e, tr.sp.x, tr.sp.y); } // on foot the view stays: only the iris closes
    else overlay.setIris(e, W / 2, H / 2);
    if (k >= 1) {
      tr.swapped = true; tr.t0 = tr.t;
      if (tr.kind === "enter") { swapIn(tr.me); tr.sp = { x: W / 2, y: H / 2 }; }
      else { swapOut(); tr.sp = clampPt(tr.me && headPos(tr.me.id) ? screenPt(headPos(tr.me.id)) : null); }
    }
  } else {
    const k = clamp01((tr.t - tr.t0) / OPEN_S); overlay.setIris(1 - ease(k), tr.sp.x, tr.sp.y);
    if (k >= 1) finishTrans();
  }
}
// a machine in focus is framed whole: every part and plate of it in the frame, seen from the front of the room and a
// little above, as near as the field of view allows (the bounds are the head's layout after the focus)
function focusHead(stateId) {
  if (!sel || !sel.head || !inRoom || trans) return;
  sel.focusId = stateId; const fb = sel.head.focus(stateId);
  if (!stateId || !fb) { sel.focusId = null; sel.focusPoint = null; if (FREE) { const v = roomEntry = roomEntryView(sel.head); flyTo(v.pos, v.tgt, 1.1); } return; }
  if (!FREE) { sel.focusPoint = fb.center ? fb.center.clone() : null; return; } // on foot: the machine is staged where it stands, the visitor walks to it
  const b = fb.box.clone(); const sz = b.getSize(v3(0, 0, 0)); b.expandByVector(sz.multiplyScalar(0.06)); // plates stand a little proud of the parts
  const v = frameAll(boxPts(b), { dir: v3(0, 0, 1), el: 0.5, margin: 1.1, minD: 1, free: true });
  sel.focusDist = v.dist; flyTo(machineRoom.contain(v.pos), v.tgt, 1.2); sel.focusPoint = v.tgt.clone();
}
// the opened capsule's card (engine/overlay.js): on top of everything, on screen, closed by its stamp, the floor or Escape
function closeCard(how) {
  if (!slipMsg) return; log.ev("world", "card", { id: slipMsg.id, open: false, how }); // log:
  slipMsg = null; overlay.closeCard();
}
// something asked for while the iris moves is done once it is open again, from where the move ends
function afterTrans(fn) { if (!trans) return fn(); const tr = trans, prev = tr.then; tr.then = () => { if (prev) prev(); afterTrans(fn); }; }
function back() {
  if (trans) return afterTrans(back);
  if (slipMsg) { closeCard("esc"); return; }
  if (FREE && boardBack && !sel) { const v = boardBack; boardBack = null; flyTo(v.pos, v.tgt, 1.3); return; } // from in front of the board: back where we were
  if (sel && inRoom && sel.focusId) { focusHead(null); return; }
  if (sel && inRoom) { leaveHead(); return; }
  if (sel) { const id = sel.id; sel = null; if (board) board.highlight({}); const c = headPos(id); if (FREE && c) { const off = camera.position.clone().sub(controls.target); off.setLength(Math.min(9, Math.max(4.5, off.length() * 1.7))); const tgt = controls.target.clone(); flyTo(rig.resolve(tgt.clone().add(off)), tgt, 1.3); } return; }
  spot = null; cue = null; if (FREE) home(); // on foot: nothing to go back from; the visitor stays where they stand
}
// live: after a press, what it caused must be in view from where the visitor stands: the control and the people
// whose state the chain changed (inside a head: the machines whose marbles move). When they already are, nothing
// moves; otherwise the camera turns and backs off gently, along the visitor's own direction, until they are
function revealConsequence(pw) {
  pressWatch = null;
  const evs = sim.trace.events.slice(pw.evN);
  const actors = new Set(); if (pw.actor && sim.actor(pw.actor) && !sim.actor(pw.actor).external) actors.add(pw.actor);
  for (const e of evs) if ((e.type === "transition" || e.type === "spawn" || e.type === "data") && e.actor && !sim.actor(e.actor)?.external) actors.add(e.actor);
  const ids = [...actors]; let flew = false, machines = [], cued = false;
  if (pw.head && sel && sel.head && (inHead() || sel.focusId)) {
    // the machines whose marble moves now; if none of them is in frame, focus the first
    const h = sel.head; const from = playS - 0.05;
    machines = h.states().filter((id) => h.movesOf(id).some((m) => m.start >= from));
    const inView = machines.filter((id) => inFrame(boxPts(h.boundsOf(id).box), 1.0));
    if (machines.length && !inView.length) { if (FREE) { focusHead(machines[0]); flew = true; } else { cue = { machines: machines.slice(0, 3), ids: [], until: amb + 4 }; cued = true; } } // on foot: a cue at the screen's edge toward them
  } else if (!inHead() && !(sel && sel.focusId)) {
    const it = liveControls && liveControls.items.get(pw.id);
    const pts = []; if (it) pts.push(...boxPts(new THREE.Box3().setFromObject(it.ui.group)));
    // a person whose desk model is in view shows what the press did there: their model and their head are enough
    for (const id of ids.slice(0, 4)) { const mb = models && models.boxOf(id); if (mb) { pts.push(...boxPts(mb)); const c = headPos(id); if (c) pts.push(c); } else pts.push(...personPts(id)); }
    const hidden = ids.some((id) => hiddenPerson(id) && !(models && models.boxOf(id)));
    if (!FREE && pts.length && (!inFrame(pts, 1.0) || hidden)) { // on foot nothing turns the visitor: their rings pulse on the floor and a cue on the screen's edge points the way
      cue = { ids: ids.slice(0, 4), machines: [], until: amb + 4 }; spot = { actors: new Set(ids.slice(0, 4)), messages: new Set(), at: amb, until: amb + 4 }; cued = true;
    } else if (pts.length && (!inFrame(pts, 1.0) || hidden)) {
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
      if (FREE) { flyTo(best.pos, best.tgt, 1.3, { kind: "reveal" }); flew = true; }
    }
  }
  consequenceCheck = { due: amb + 2.0, id: pw.id, actors: ids, machines, flew, cued, head: !!pw.head };
}
// a person is hidden when neither the middle nor the top of their head can be seen (a monitor may hide the chin)
const hiddenPerson = (id) => !!headPos(id) && occludedFrom(camera.position, id) && occludedFrom(camera.position, id, 0.2);
function checkConsequence() { // log: was what the press caused in view, two seconds later?
  const c = consequenceCheck; consequenceCheck = null; camera.updateMatrixWorld();
  if (c.head) { const h = sel && sel.head; const seen = h ? c.machines.filter((id) => inFrame(boxPts(h.boundsOf(id).box), 1.0)) : []; log.ev("world", "consequence", { id: c.id, head: true, machines: c.machines, seen, flew: c.flew, cued: c.cued }); return; }
  const subs = subjects(); const seen = [];
  for (const id of c.actors) { const sb = subs.find((x) => x.kind === "actor" && x.id === id); const r = sb && viewer.rect(sb.min, sb.max, camera, innerWidth, innerHeight); if (r && r.frac > 0.002 && !hiddenPerson(id)) seen.push(id); }
  const cs = subs.find((x) => x.kind === "control" && x.id === c.id); const control = !!(cs && viewer.rect(cs.min, cs.max, camera, innerWidth, innerHeight));
  log.ev("world", "consequence", { id: c.id, actors: c.actors, seen, control, flew: c.flew, cued: c.cued });
}
function openCapsule(id) {
  const a = tubes.active.find((x) => x.msg.id === id); const m = a ? a.msg : sim.messagesBetween(-1, sim.duration + 1).find((x) => x.id === id); if (!m) return;
  slipMsg = { id, at: amb };
  overlay.openCard({ title: String(m.name), sub: `${nameOf(m.from)}  →  ${[].concat(m.to ?? []).map(nameOf).join(", ")}`, body: summaryText(m.summary), accent: a ? "#" + a.f.color.getHexString() : null }, amb);
  log.ev("world", "card", { id, open: true }); // log:
  if (board) board.highlight({ messageId: id });
}
// a click on the floor walks there: the view keeps its direction, at a standing distance, out of furniture
function walkTo(point) {
  if (!FREE) return; // on foot a tap on the floor does nothing: the visitor walks
  const tgt = v3(point.x, 1.0, point.z); const off = camera.position.clone().sub(controls.target); const hz = v3(off.x, 0, off.z); if (hz.lengthSq() < 1e-4) hz.set(0.4, 0, 0.9);
  const d = Math.min(8, Math.max(3.2, off.length())); const h = Math.min(d * 0.75, Math.max(1.0, off.y));
  hz.setLength(Math.sqrt(Math.max(0.5, d * d - h * h))); flyTo(rig.resolve(tgt.clone().add(hz).add(v3(0, h, 0))), tgt, 1.1);
}
function togglePause() { paused = !paused; }
function setSpeed(i) { speedIndex = (i + 3) % 3; }
function goSystem(id) { if (id && id !== SYSTEM) { const u = new URL(location.href); if (id.startsWith("live:")) { u.searchParams.delete("system"); u.searchParams.set("live", id.slice(5)); } else { u.searchParams.delete("live"); u.searchParams.set("system", id); } location.href = u.toString(); } } // live: plates for live systems

// ---------------------------------------------------------------- picking
const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2();
// on foot a hand reaches FP.reach (the board and the printer's tape are read from further); something further away
// is "far": the crosshair says so and a click does nothing there. A free camera reaches everything
const REACH = { board: 9, ticker: 4.5 };
function reachFor(kind) { if (FREE) return Infinity; if (inRoom) return Math.max(FP.reach * player.scale, 1.3 * (roomEntry ? roomEntry.dist : 0)); return REACH[kind] || FP.reach; }
function pickAt(x, y) {
  const p = pickRaw(x, y); if (!p || FREE || p.dist == null) return p;
  return p.dist > reachFor(p.kind) ? { kind: "far", of: p, dist: p.dist } : p;
}
const distTo = (o) => { const q = o.getWorldPosition ? o.getWorldPosition(new THREE.Vector3()) : o; return camera.position.distanceTo(q); };
function pickRaw(x, y) {
  const o = overlay.hit(x, y); if (o) return { kind: o }; // the overlay first: it is drawn over everything
  if (trans) return null; // between the office and a machine room
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera);
  if (inRoom) { const hp = sel && sel.head ? sel.head.pick(raycaster) : null; return hp ? { kind: "head", hit: hp, dist: hp.point ? camera.position.distanceTo(hp.point) : null } : null; } // nothing of the office is here
  if (liveControls) { const c = liveControls.pick(raycaster); if (c) return { kind: "control", id: c.id, dist: distTo(liveControls.items.get(c.id).ui.group) }; } // live: the controls
  const nc = liveControls ? liveControls.near(x, y, camera, innerWidth, innerHeight) : null; // live: within a thumb's reach
  const nearC = nc && distTo(liveControls.items.get(nc.id).ui.group) <= reachFor("control") ? nc : null;
  const cands = [boardMesh, ticker.tape, tubes.caps, ...people.roots().filter((r) => r.visible), ...stations.list.map((s) => s.group), ...building.pick.map((p) => p.object), ...recorder.pick.map((p) => p.object), ...building.occluders, desks.root, ...(models ? [models.root] : [])];
  const shown = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; }; // hidden things (the ceiling seen from above) take no clicks
  for (const h of raycaster.intersectObjects(cands, true)) {
    const o = h.object; if (!shown(o)) continue;
    if (o === boardMesh) return { kind: "board", uv: h.uv, point: h.point, dist: h.distance };
    if (o === ticker.tape) return { kind: "ticker", uv: h.uv, point: h.point, dist: h.distance };
    if (o === tubes.caps) { const a = tubes.active.find((x) => x.index === h.instanceId); if (a) return { kind: "capsule", id: a.msg.id, point: h.point, dist: h.distance }; continue; }
    if (o.userData.actorId) return { kind: "actor", id: o.userData.actorId, point: h.point, dist: h.distance };
    if (o.userData.stationId) return { kind: "actor", id: o.userData.stationId, point: h.point, dist: h.distance };
    if (o.userData.recorder) return { kind: "recorder", point: h.point, dist: h.distance };
    { let q = o; while (q && !(q.name || "").startsWith("desk-model:")) q = q.parent; if (q) return { kind: "actor", id: q.name.slice(11), point: h.point, via: "model", dist: h.distance }; } // a desk model: its person
    if (building.occluders.includes(o)) return nearSubject(x, y) || { kind: "wall", point: h.point };
    if (!building.pick.some((p) => p.object === o)) { let q = o; while (q && q !== desks.root) q = q.parent; if (q === desks.root) { const who = deskOwner(h.point); return who ? { kind: "actor", id: who, point: h.point, via: "desk", dist: h.distance } : nearSubject(x, y) || { kind: "furniture", point: h.point }; } }
    const pk = building.pick.find((p) => p.object === o); if (pk) return pk.kind === "floor" && nearC ? { kind: "control", id: nearC.id } : pk.kind === "floor" ? nearSubject(x, y) || { kind: pk.kind, point: h.point } : { kind: pk.kind, id: pk.id, point: h.point, dist: h.distance };
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
  return best ? { kind: "actor", id: best.id, via: "near", dist: camera.position.distanceTo(best.min.clone().add(best.max).multiplyScalar(0.5)) } : null;
}
// a click becomes an action (what the visitor meant), and perform() does it: the one place where
// intent becomes behaviour, so the recorder logs it once and the replay can do it again
function intentOf(p) {
  // an opened card closes on a tap on empty floor, a wall, furniture or nothing (its stamp and Escape close it too)
  if (slipMsg && !inRoom && (!p || ["floor", "wall", "furniture", "far"].includes(p.kind))) return { do: "closeCard", how: "floor" };
  if (!p) return null;
  switch (p.kind) {
    case "card-close": return { do: "closeCard", how: "x" };
    case "card": return null; // the card's paper: nothing (a tap there must not fall through to the room)
    case "exit": return { do: "exit" };
    case "control": return { do: "press", id: p.id };
    case "head":
      if (live && p.hit.kind === "event") return { do: "headSend", actor: sel.id, event: p.hit.event }; // live: a brass button on a track in the head
      if (p.hit.kind === "state") { const same = p.hit.id === sel.focusId; const wp = new THREE.Vector3(); p.hit.object.getWorldPosition(wp); const q = p.hit.point || wp; return { do: "focus", state: same ? null : p.hit.id, point: same ? null : [+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4)] }; }
      return null;
    case "board": return { do: "board", type: "tap", u: p.uv.x, v: 1 - p.uv.y };
    case "ticker": return { do: "ticker", u: +p.uv.x.toFixed(4), v: +p.uv.y.toFixed(4) };
    case "capsule": return { do: "slip", id: p.id };
    case "actor":
      // on foot a person (or their desk, or the model on it) within reach is a door into their machine room; a station is selected
      if (!FREE) { const a = sim.actor(p.id); if (a && !a.external && sim.chartOf(p.id)) return { do: "enter", id: p.id }; return sel && sel.id === p.id ? { do: "deselect" } : { do: "select", id: p.id }; }
      if (sel && sel.id === p.id && sel.head && sel.stage === "approach") return { do: "enter" }; if (sel && sel.id === p.id && !sel.head) return { do: "back" }; if (!(sel && sel.id === p.id)) return { do: "select", id: p.id }; return null;
    case "clock": return live ? { do: live.viewingPast ? "now" : "advance" } : { do: "pause" }; // live: the clock advances time
    case "lever": return { do: "speed", i: speedIndex + 1 };
    case "system": return REC ? null : { do: "system", id: p.id };
    case "recorder": return { do: "export" };
    case "floor": return inHead() || !FREE ? null : { do: "walk", point: [+p.point.x.toFixed(3), +p.point.y.toFixed(3), +p.point.z.toFixed(3)] };
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
      if (!ok && it && !/^time:(mode|run)$/.test(a.id)) ticker.refuse(`YOU: ${it.c.label}`, why || "not now", playS);
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
    case "enter": if (a.id && (!sel || sel.id !== a.id) && !inRoom && !trans) select(a.id); enterHead(); break;
    case "exit": afterTrans(() => { if (inRoom) leaveHead(); }); break;
    case "closeCard": closeCard(a.how || "act"); break;
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
    case "home": closeCard("home"); afterTrans(() => { if (inRoom) leaveHead(() => { sel = null; home(); }); else { sel = null; home(); } }); break;
    case "deselect": afterTrans(() => { if (inRoom) leaveHead(() => { sel = null; }); else { sel = null; spot = null; if (board) board.highlight({}); } }); break;
  }
}
function click(x, y) {
  const p = pickAt(x, y); const a = intentOf(p);
  log.ev("pick", "tap", { x: Math.round(x), y: Math.round(y), hit: p ? (p.kind === "far" ? ["far", `${p.of.kind}:${p.of.id ?? p.of.hit?.id ?? ""}`, +p.dist.toFixed(1)] : [p.kind, p.id ?? p.hit?.id ?? p.hit?.kind ?? null]) : null, act: a ? a.do : null, near: nearOf(x, y) }); // log: what was under the pointer, what we did, what was close
  if (a && !FREE) body.press(); // the hand pokes forward
  perform(a);
  return p;
}

// ---------------------------------------------------------------- input: the visitor's body (first person)
// Desktop: a click captures the pointer (pointer lock); the mouse looks, WASD or the arrows walk (←/→ and Q/E turn),
// Shift runs, Space hops, a click presses what the crosshair is on (within reach), the wheel scrolls the board.
// Escape releases the pointer, and goes back when something is open (a card, a machine room). Without the lock
// (refused, ?nolock=1, or a tool driving the page) a drag looks and a click presses what is under the pointer.
// Touch: a stick under the left thumb walks, a drag elsewhere looks, a tap presses what is under it.
const keys = new Set(); window.__keys = keys;
let lookDX = 0, lookDY = 0, locked = false, lockRefused = params.has("nolock") || FREE || REPLAY, unlockedAt = -1e9;
let stick = null, pointerAt = null, touchSeen = false, hoverAt = -1, hoverPick = null, movedOnce = false;
const SENS = 0.0023, DRAG = 0.0045, TOUCH_LOOK = 0.0065, STICK_R = 56;
const centre = () => ({ x: innerWidth / 2, y: innerHeight / 2 });
// where a click or the hover looks: the crosshair while the pointer is captured (or on touch), else the pointer
const aimPoint = () => (locked || (!pointerAt && !FREE) ? centre() : pointerAt || centre());
let orbiting = false; // log: kept for the analyser's older findings (there is no orbit any more)
if (!REC && !REPLAY) {
  log.attachInput(canvas); // log: raw pointer, wheel and keys (passive listeners at the canvas)
  let down = null; const pointers = new Map();
  const gesture = (kind, d) => log.ev("input", "gesture", { kind, ...d }); // log: what the app made of the input
  document.addEventListener("pointerlockchange", () => {
    const was = locked; locked = document.pointerLockElement === canvas; if (!locked && was) unlockedAt = performance.now();
    log.ev("input", "lock", { on: locked }); // log: the pointer captured or released
    if (!locked && was && slipMsg) perform({ do: "closeCard", how: "esc" }); // the Escape that released the pointer closes an open card too
  });
  document.addEventListener("pointerlockerror", () => { lockRefused = true; log.ev("input", "lock", { on: false, refused: true }); }); // log:
  const tryLock = () => { if (locked || lockRefused || FREE || touchSeen) return; try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(() => { lockRefused = true; }); } catch { lockRefused = true; } };
  canvas.addEventListener("pointerdown", (e) => {
    const touch = e.pointerType === "touch"; if (touch) touchSeen = true;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    // the left thumb's stick: a touch that starts in the lower left of the screen
    if (touch && !stick && e.clientX < innerWidth * 0.42 && e.clientY > innerHeight * 0.45) { stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY }; gesture("stick", {}); return; }
    if (down) return; // one look or tap at a time (the stick aside)
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, at: performance.now(), button: e.button, touch, moved: 0 };
    if (!locked) { const p = pickAt(e.clientX, e.clientY); if (p && p.kind === "board" && !touch) { down.board = true; perform({ do: "board", type: "down", u: p.uv.x, v: 1 - p.uv.y }); } } // the board's scrubber drags under the pointer
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (stick && e.pointerId === stick.id) { const dx = e.clientX - stick.x0, dy = e.clientY - stick.y0, d = Math.hypot(dx, dy); const k = d > STICK_R ? STICK_R / d : 1; stick.x = stick.x0 + dx * k; stick.y = stick.y0 + dy * k; return; }
    // the mouse looks; a single movement of hundreds of pixels is a browser's glitch (some report the pointer's
    // jump back to where it was captured), never a hand: it is dropped, so the view never lurches
    if (locked) { const mx = e.movementX || 0, my = e.movementY || 0; if (Math.abs(mx) < 250 && Math.abs(my) < 250) { lookDX -= mx * SENS; lookDY -= my * SENS; } return; }
    if (e.pointerType !== "touch") pointerAt = { x: e.clientX, y: e.clientY };
    if (down && e.pointerId === down.id) {
      const dx = e.clientX - down.lx, dy = e.clientY - down.ly; down.lx = e.clientX; down.ly = e.clientY; down.moved = Math.max(down.moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
      if (down.board) { const p = pickAt(e.clientX, e.clientY); if (p && p.kind === "board") perform({ do: "board", type: "move", u: p.uv.x, v: 1 - p.uv.y }); return; }
      if (down.moved > 6) { const k = down.touch ? TOUCH_LOOK : DRAG; lookDX -= dx * k; lookDY -= dy * k; } // drag to look, the way the mouse looks
      return;
    }
    if (!down) overlay.hover(e.clientX, e.clientY); // the card's close stamp brightens under the pointer
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (stick && e.pointerId === stick.id) { stick = null; return; }
    if (!down || e.pointerId !== down.id) return; const d = down; down = null;
    const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y), ms = performance.now() - d.at;
    if (d.board) { const p = pickAt(e.clientX, e.clientY); perform({ do: "board", type: "up", u: p && p.uv ? p.uv.x : 0, v: p && p.uv ? 1 - p.uv.y : 0 }); gesture(dist < 7 ? "board-tap" : "board-drag", { dist: Math.round(dist), ms: Math.round(ms) }); return; }
    if (dist < 7 && ms < 600 && d.button === 0) {
      const at = locked ? centre() : { x: e.clientX, y: e.clientY };
      gesture("tap", { x: Math.round(at.x), y: Math.round(at.y), ms: Math.round(ms), locked });
      const wasLocked = locked; click(at.x, at.y);
      if (!wasLocked && !d.touch) tryLock(); // the first click captures the pointer (and does what it clicked)
    } else if (dist < 7) gesture("hold", { x: Math.round(e.clientX), y: Math.round(e.clientY), ms: Math.round(ms) }); // a long press does nothing
    else gesture("look", { dist: Math.round(dist), ms: Math.round(ms), touch: d.touch });
  };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); if (stick && stick.id === e.pointerId) stick = null; if (down && down.id === e.pointerId) down = null; });
  canvas.addEventListener("pointerleave", () => { pointerAt = null; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); const at = aimPoint(); const p = board ? pickAt(at.x, at.y) : null; if (p && p.kind === "board") { perform({ do: "board", type: "wheel", u: p.uv.x, v: 1 - p.uv.y, extra: { dy: e.deltaY, dx: e.deltaX } }); } }, { capture: true, passive: false }); // the wheel scrolls the board under the crosshair; nothing else
  addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "Escape") { if (performance.now() - unlockedAt < 350 && !(slipMsg || inRoom || (sel && !inRoom))) return; perform({ do: "back" }); return; } // the press that released the pointer goes back only when something is open
    if (e.metaKey || e.ctrlKey) return;
    if (k === " ") { e.preventDefault(); keys.add(" "); return; }
    if (k === "p" || k === "P") perform({ do: "pause" });
    else if (k === "]" || k === "+") perform({ do: "speed", i: speedIndex + 1 });
    else if (k === "[" || k === "-") perform({ do: "speed", i: speedIndex - 1 });
    else if (k === "," || k === "<") perform({ do: "seek", s: playS - 3 });
    else if (k === "." || k === ">") perform({ do: "seek", s: playS + 3 });
    else if (k === "h" || k === "H" || k === "Home") perform({ do: "home" });
    else if (k === "l" || k === "L") perform({ do: "export" }); // the flight recorder, from the keyboard
    else { if (k.startsWith("Arrow")) e.preventDefault(); keys.add(k.toLowerCase()); }
  });
  addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  addEventListener("blur", () => { keys.clear(); stick = null; }); // a key held while the window lost focus must not walk on
  addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; if (inRoom && FREE) camera.fov = fovFor(camera.aspect); camera.updateProjectionMatrix(); overlay.resize(innerWidth, innerHeight); });
}
// one step of the walker from what the visitor holds: keys, the look delta since the last frame, the stick
let walkLogAt = -1;
function fpStep(dt) {
  const k = keys, has = (x) => k.has(x);
  let mz = (has("w") || has("arrowup") ? 1 : 0) - (has("s") || has("arrowdown") ? 1 : 0);
  let mx = (has("d") ? 1 : 0) - (has("a") ? 1 : 0);
  const turn = (has("arrowleft") || has("q") ? 1 : 0) - (has("arrowright") || has("e") ? 1 : 0);
  if (stick) { mx += (stick.x - stick.x0) / STICK_R; mz -= (stick.y - stick.y0) / STICK_R; }
  const jump = has(" "); k.delete(" ");
  const input = { mx, mz, run: has("shift"), jump, dyaw: lookDX + turn * 1.9 * dt, dpitch: lookDY };
  lookDX = 0; lookDY = 0;
  if (trans) { input.mx = input.mz = 0; input.dyaw = input.dpitch = 0; } // never walk between the office and a machine room
  const { moved } = player.step(dt, input);
  if (moved > 1e-4 || input.dyaw || input.dpitch) movedOnce = true;
  if (moved > 1e-4 && amb - walkLogAt > 0.5) { walkLogAt = amb; log.ev("camera", "walk", { keys: player.auto ? "auto" : [...k].join("") + (stick ? "stick" : ""), head: inRoom, at: [+player.pos.x.toFixed(2), +player.pos.z.toFixed(2)] }); } // log: walking (twice a second at most)
  // the machine room's door: walked through, back to the office
  if (inRoom && !trans && machineRoom.through(player.pos) > 0.9) perform({ do: "exit", how: "door" });
}
// the office as the walker sees it (engine/player.js): its walls with the door's opening, the furniture, the people,
// the door's leaf while it is shut
let staticBoxes = null, staticOf = null, frameBoxes = [];
function officeStatic() {
  if (staticOf === stations && staticBoxes) return staticBoxes;
  staticOf = stations; const out = [...desks.colliders];
  for (const st of stations.list) { const b = new THREE.Box3().setFromObject(st.group); out.push([b.min.clone(), b.max.clone()]); }
  { const b = new THREE.Box3().setFromObject(ticker.root); if (!b.isEmpty()) { b.max.y = Math.min(b.max.y, 1.6); out.push([b.min.clone(), b.max.clone()]); } }
  if (liveControls) liveControls.root.traverse((o) => { if (o.parent === liveControls.root) { const b = new THREE.Box3().setFromObject(o); if (!b.isEmpty() && b.min.y < 1.5) out.push([b.min.clone(), v3(b.max.x, Math.min(b.max.y, 1.6), b.max.z)]); } }); // the consoles and the levers
  // the exchange's counters (a ring round the hub) and the walls, the door's opening left free
  const r = plan.room, d = plan.door, T = 0.15, Hh = WALL_H;
  out.push([v3(r.x0 - T, 0, r.z0 - T), v3(r.x1 + T, Hh, r.z0 + T)], [v3(r.x0 - T, 0, r.z0 - T), v3(r.x0 + T, Hh, r.z1 + T)], [v3(r.x1 - T, 0, r.z0 - T), v3(r.x1 + T, Hh, r.z1 + T)]);
  out.push([v3(r.x0 - T, 0, r.z1 - T), v3(d.x - d.w / 2, Hh, r.z1 + T)], [v3(d.x + d.w / 2, 0, r.z1 - T), v3(r.x1 + T, Hh, r.z1 + T)]);
  if (plan.hub) { const s = plan.seatOf(plan.hub, 0); if (s && Number.isFinite(s.x)) { const cx = s.x, cz = s.z + 0.2; for (let i = 0; i < 8; i++) { if (i === 4) continue; const a = (i / 8) * Math.PI * 2, x = cx + Math.sin(a) * 2.5, z = cz + Math.cos(a) * 2.5; const hw = Math.abs(Math.cos(a)) * 0.95 + Math.abs(Math.sin(a)) * 0.25, hd = Math.abs(Math.sin(a)) * 0.95 + Math.abs(Math.cos(a)) * 0.25; out.push([v3(x - hw, 0, z - hd), v3(x + hw, 0.8, z + hd)]); } } }
  return (staticBoxes = out);
}
const officeWorld = {
  floor: 0,
  boxes: () => frameBoxes,
  limit(p, r) {
    const R0 = plan.room, d = plan.door, T = 0.15;
    p.x = Math.min(R0.x1 - T - r, Math.max(R0.x0 + T + r, p.x)); p.z = Math.min(R0.z1 + 1.1, Math.max(R0.z0 + T + r, p.z));
    if (p.z > R0.z1 - T) p.x = Math.min(d.x + d.w / 2 - r, Math.max(d.x - d.w / 2 + r, p.x)); // in the doorway or on the step outside: within the opening
    return p;
  },
  get rect() { const R0 = plan.room; return { x0: R0.x0, x1: R0.x1, z0: R0.z0, z1: R0.z1 + 1.1 }; },
};
function officeBoxes() {
  const out = [...officeStatic(), ...people.boxes(null).map(([a, b]) => Object.assign([a, v3(b.x, Math.min(b.y, 1.9), b.z)], { soft: true }))]; // people: soft (they never push the visitor)
  const d = plan.door, z1 = plan.room.z1; if (building.door.k < 0.6) out.push([v3(d.x - d.w / 2, 0, z1 - 0.06), v3(d.x + d.w / 2, d.h, z1 + 0.06)]); // the leaf, unless it is open
  frameBoxes = out;
}
// where the visitor starts: just inside the door, turned to see as much of the room as a standing person can: the
// people, the board, the stations and (live) the consoles, the first console most
function spawnPose() {
  const sp = plan.spawn, eye = v3(sp.x, FP.eye, sp.z), pts = [];
  for (const seat of people.seats.values()) if (seat.current && seat.avatar.root.visible) { const h = headPos(seat.current.id); if (h) pts.push([h, 2]); }
  { const b = plan.board; const c = boardMesh.position.clone(); const n = b.wall === "north" ? v3(1, 0, 0) : v3(0, 0, 1); for (const k of [-0.45, 0, 0.45]) pts.push([c.clone().addScaledVector(n, k * b.w), 3]); }
  for (const st of stations.list) pts.push([st.group.getWorldPosition(v3()).add(v3(0, 1.2, 0)), 1]);
  const k0 = firstConsole(); if (liveControls) for (const k of liveControls.consoles()) pts.push([k.group.getWorldPosition(v3()).add(v3(0, 1.1, 0)), k === k0 ? 6 : 1.5]);
  const hf = Math.atan(Math.tan((FP.fov * Math.PI) / 360) * (innerWidth / innerHeight)) * 0.82;
  let best = null;
  for (let i = 0; i < 180; i++) { const yaw = -Math.PI + (i / 180) * 2 * Math.PI; let sc = 0; for (const [p, w] of pts) { const a = Math.atan2(-(p.x - eye.x), -(p.z - eye.z)); let d = a - yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; if (Math.abs(d) < hf) sc += w * (1 - 0.25 * Math.abs(d) / hf); } if (!best || sc > best.sc + 1e-6) best = { yaw, sc }; }
  // looking a little down: at the people's heads and the desks, the board still in view
  const els = pts.map(([p]) => Math.atan2(p.y - eye.y, Math.hypot(p.x - eye.x, p.z - eye.z))).sort((a, b) => a - b);
  const pitch = Math.max(-0.32, Math.min(0.02, (els[Math.floor(els.length / 2)] ?? -0.1) - 0.04));
  return { p: v3(sp.x, 0, sp.z), yaw: best ? best.yaw : 0, pitch };
}
function spawn(why = "spawn") { player.setWorld(officeWorld, 1); if (people) officeBoxes(); const v = spawnPose(); player.place(v.p, v.yaw, v.pitch); log.ev("camera", "fly", { kind: "spawn", dur: 0, why, from: xyz(camera.position), to: xyz(player.eye), tgt: xyz(player.eye.add(player.forward)), via: 0 }); player.apply(camera); log.ev("camera", "arrive", { kind: "spawn" }); } // log: a teleport, not a jump
// the body each frame: the arms, the shadow at the feet, the whole figure for a third-person replay; what the
// crosshair (or the pointer) is on, its hover ring and the HUD: the crosshair, "walk closer", the cues, the stick
const HINTS = ["click: look around · WASD / arrows: walk · Shift: run · Space: hop", "click: press what the crosshair is on · wheel: scroll the board", "Esc: back · H: back to the door · P: pause · L: save the flight log"];
const HINTS_TOUCH = ["left thumb: walk · drag: look · tap: press"];
const HINT_SHORT = ["Esc: back · H: to the door · L: flight log"];
function stepBody(dt) {
  body.update(dt, { phase: player.phase, k: Math.min(1, (ext ? extWalk / Math.max(dt, 1e-3) : player.speed) / FP.walk), pitch: player.pitch });
  const drawn = inRoom ? machineRoom.scene : scene;
  if (blob.parent !== drawn) drawn.add(blob);
  blob.visible = !trans; blob.position.set(player.pos.x, player.floor + 0.02, player.pos.z); blob.scale.setScalar(player.scale);
  const fig = body.figure.root;
  if (THIRD) { if (fig.parent !== drawn) drawn.add(fig); fig.visible = !trans; fig.scale.setScalar(player.scale); body.pose(v3(player.pos.x, player.floor, player.pos.z), player.yaw, { k: extWalk > 0.004 ? 1 : 0, phase: player.walked * 3 }); }
  if (REPLAY) { overlay.setHUD({ crosshair: THIRD ? "none" : "idle", cues: cueMarks() }); return; }
  // what the visitor aims at, a few times a second (a raycast through the room)
  if (amb - hoverAt > 1 / 15 || !hoverPick) {
    hoverAt = amb; const at = aimPoint(); const p = trans || fadeT ? null : pickAt(at.x, at.y); hoverPick = p || { kind: "none" };
    const live1 = p && p.kind !== "far" ? p : null;
    hoverId = live1 && live1.kind === "actor" ? live1.id : null;
    if (liveControls) liveControls.hover(live1 && live1.kind === "control" ? live1.id : null); // live: a dim control says why
    if (inRoom && sel && sel.head && sel.head.hoverButton) sel.head.hoverButton(live1 && live1.kind === "head" && live1.hit.kind === "event" ? live1.hit : null); // live: so does a dim button in a machine room
    if (board) { if (live1 && live1.kind === "board") { board.pointer("move", live1.uv.x, 1 - live1.uv.y); boardHot = true; } else board.pointer("leave", 0, 0); }
    const key = p ? `${p.kind}:${p.id ?? p.hit?.id ?? p.of?.kind ?? ""}` : ""; if (key !== hoverKey) { hoverKey = key; log.ev("pick", "hover", { x: Math.round(at.x), y: Math.round(at.y), hit: p ? [p.kind, p.id ?? p.hit?.id ?? p.of?.id ?? p.of?.kind ?? null] : null, cursor: hotKind(p) ? "pointer" : "default" }); } // log: what the crosshair is on
    canvas.style.cursor = locked ? "none" : hotKind(p) ? "pointer" : "default";
  }
  const p = hoverPick, hot = hotKind(p), far = p && p.kind === "far" && hotKind(p.of), nearly = far && p.dist < 2.5 * reachFor(p.of.kind); // "walk closer" only for something a few steps away
  overlay.setHUD({
    crosshair: locked || touchSeen || !pointerAt ? (hot ? "hot" : far ? "far" : "idle") : "none",
    hint: nearly ? "walk closer" : null, hintAt: locked || touchSeen || !pointerAt ? null : pointerAt && { x: pointerAt.x, y: pointerAt.y + 18 },
    cues: cueMarks(), stick: stick ? { x0: stick.x0, y0: stick.y0, x: Math.round(stick.x), y: Math.round(stick.y) } : null,
    hints: touchSeen ? (movedOnce ? [] : HINTS_TOUCH) : movedOnce && amb > 12 ? HINT_SHORT : HINTS,
  });
}
let hoverKey = "";
const hotKind = (p) => !!p && !["floor", "wall", "furniture", "card", "far", "none"].includes(p.kind);
// the cues: what a press changed out of view, as chevrons on the screen's edge (quantised: the HUD redraws only on change)
function cueMarks() {
  if (!cue || amb > cue.until) { cue = null; return []; }
  const out = []; camera.updateMatrixWorld();
  const mark = (p, color) => { const q = p.clone().project(camera); let x = (q.x + 1) / 2 * innerWidth, y = (1 - q.y) / 2 * innerHeight; if (q.z > 1) { x = innerWidth - x; y = innerHeight * 1.5; } const on = q.z <= 1 && Math.abs(q.x) < 0.92 && Math.abs(q.y) < 0.92; if (!on) out.push({ x: Math.round(x / 6) * 6, y: Math.round(y / 6) * 6, color }); };
  for (const id of cue.ids || []) { const c = headPos(id) || stations.byId.get(id)?.group.getWorldPosition(v3()); if (c && !inRoom) mark(c, "#ffe14d"); }
  if (inRoom && sel && sel.head) for (const id of cue.machines || []) { const b = sel.head.boundsOf(id); if (b && b.box) mark(b.box.getCenter(v3()), "#ffe14d"); }
  return out;
}
// H: a quick fade to black, the spawn, and back (never a flight)
let fadeT = null;
function homeFade() { if (fadeT) return; fadeT = { t: 0, done: false }; }
function stepFade(dt) { if (!fadeT) return; fadeT.t += dt; const t = fadeT.t; if (t >= 0.16 && !fadeT.done) { fadeT.done = true; spawn("home"); } overlay.setFade(t < 0.16 ? t / 0.16 : Math.max(0, 1 - (t - 0.16) / 0.24)); if (t > 0.4) { fadeT = null; overlay.setFade(0); } }

// ---------------------------------------------------------------- one frame
const sitCache = new Map();
let boardAt = -1, boardHot = true; const boardFr = new THREE.Frustum(), boardPV = new THREE.Matrix4();
const boardSeen = () => { boardPV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); boardFr.setFromProjectionMatrix(boardPV); return boardFr.intersectsObject(boardMesh); };
let ext = null; // ?replay=1: {playS, cam: {p, t, fov}} from outside (tools/replay.mjs)
// a replay's pose is the visitor's eye: on foot the walker stands there (its door opens, its figure is drawn there)
const applyExt = () => {
  if (!ext || !ext.cam) return; const c = ext.cam; camera.position.set(...c.p); controls.target.set(...c.t); if (c.fov && c.fov !== camera.fov) { camera.fov = c.fov; camera.updateProjectionMatrix(); } camera.lookAt(controls.target);
  if (FREE) return;
  const d = controls.target.clone().sub(camera.position); const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  const sc = inRoom ? machineRoom.scale : 1, fl = inRoom ? ROOM.floor : 0;
  const was = player.pos.clone(); player.place(v3(camera.position.x, 0, camera.position.z), yaw, pitch); void fl; void sc; extWalk = Math.hypot(player.pos.x - was.x, player.pos.z - was.z);
  if (THIRD) { // behind and above the visitor, pulled in until it is inside the room (never behind a wall)
    const f = v3(-Math.sin(yaw), 0, -Math.cos(yaw)); const e = camera.position.clone(); const R0 = plan.room;
    const inside = (q) => (inRoom ? Math.hypot(q.x, q.z) < ROOM.wallR - 0.6 * sc : q.x > R0.x0 + 0.35 && q.x < R0.x1 - 0.35 && q.z > R0.z0 + 0.35 && q.z < R0.z1 - 0.35);
    let d = 3.4; const q = v3(); for (; d > 0.5; d -= 0.2) { q.copy(e).addScaledVector(f, -d * sc).add(v3(0, (0.6 + 0.27 * d) * sc, 0)); if (inside(q)) break; }
    camera.position.copy(q); camera.lookAt(e.clone().addScaledVector(f, 2 * sc).add(v3(0, -0.5 * sc, 0)));
  }
};
let extWalk = 0; const right3 = new THREE.Vector3(), up3 = new THREE.Vector3(0, 1, 0);
function step(dt) {
  // live: the playhead runs only up to what the driver released, and the room's own motion with it
  let moving = true;
  if (ext) { moving = !live || (!live.viewingPast && Math.abs(ext.playS - playS) > 1e-6); playS = ext.playS; if (live) live.setPlayhead(playS); } // replay: the log's playhead
  else if (live) { const lim = live.released(); moving = !live.viewingPast && playS < lim - 1e-6; if (catchUp !== null && playS >= catchUp) catchUp = null; const rate = catchUp !== null ? CATCH_UP : SPEEDS[speedIndex]; if (moving) playS = Math.min(lim, catchUp !== null ? Math.min(catchUp, playS + dt * rate) : playS + dt * rate); live.setPlayhead(playS); }
  else if (!paused) { playS += dt * SPEEDS[speedIndex]; if (playS >= LOOP) playS -= LOOP; }
  amb += dt; if (moving) wamb += dt;
  const wa = live ? wamb : amb; // live: what the world animates with
  const t = tNow(); sitCache.clear();
  // the office goes on while the visitor is in a machine room; what in it looks at the camera sees the view they left
  const viewCam = inRoom ? officeCam : camera;
  const dark = people.update(playS, wa);
  if (models) models.update({ people, playS, t, dt: moving ? dt : 0, camera: viewCam, selected: sel && sel.id, frame: frameN++ }); // the desk models: built near the camera, their marbles at t
  // a blackout (everyone ended at once): the lights go out
  const k = 1 - 0.85 * dark; hemi.intensity = 1.35 * k; sun.intensity = 1.7 * k; fill.intensity = 0.35 * k; scene.background.copy(SKY).lerp(NIGHT, dark); scene.fog.color.copy(scene.background);
  // the office door opens for whoever goes through: people walking in or out (a moment ahead of them), the visitor near it
  const ddx = plan.door.x - player.pos.x, ddz = plan.door.z - player.pos.z, dd = Math.hypot(ddx, ddz), toward = (player.vel.x * ddx + player.vel.y * ddz) / Math.max(1e-6, dd);
  const nearDoor = !inRoom && !FREE && (dd < 0.85 || (dd < 2.0 && toward > 0.35)); // the visitor walking up to it, or standing in it
  const doorWas = building.door.open;
  building.update(playS, t, wa, { paused: live ? !moving : displayPaused ?? paused, speedIndex, duration: sim.duration, clockRing: recentIn(clockRings, playS, 0.9), camera: viewCam, dt, doorWant: nearDoor || people.doorTraffic(playS) });
  if (building.door.open !== doorWas) log.ev("world", "door", { which: "office", open: building.door.open, by: nearDoor ? "visitor" : "people" }); // log: the door opens or shuts
  stations.update(playS, wa);
  desks.update(playS, t, wa, people.occupantOf, { dark: dark > 0.3, situation: (id) => sitCache.get(id) || sitCache.set(id, sim.situationAt(id, t)).get(id), timerRing: (id) => recentIn(timerRings.get(id), playS, 0.9), timerSet: (id) => (timerPending.get(id) || []).some(([a, b]) => playS >= a && playS < b), talking: (a, b) => recentIn(talkSpans.get([a, b].sort().join("|")), playS, 0.8), dropping: (k) => tubes.dropping(k) });
  const active = tubes.update(playS, spot && spot.messages.size ? spot.messages : null);
  ticker.update(playS, wa);
  if (revealNext) { const pw = revealNext; revealNext = null; revealConsequence(pw); }
  if (board && (REC || boardHot || (amb - boardAt >= 1 / 15 && !inRoom && boardSeen()))) { boardAt = amb; boardHot = false; board.update(t); if (board.dirty) { boardTex.needsUpdate = true; board.dirty = false; log.note("board"); } }
  for (const r of Object.values(rings)) r.visible = false;
  hoverRing.visible = false; if (hoverId && !(sel && sel.id === hoverId) && !inHead()) { const seat = people.seatOfActor(hoverId, playS); const pos = seat && seat.avatar.root.visible ? seat.avatar.root.position : stations.byId.get(hoverId)?.group.position; if (pos) { hoverRing.visible = true; hoverRing.position.set(pos.x, 0.035, pos.z); } }
  if (spot && spot.until && amb > spot.until) spot = null;
  if (spot) for (const id of spot.actors) { let pos = null; const seat = people.seatOfActor(id, playS); if (seat && seat.avatar.root.visible) pos = seat.avatar.root.position; else { const st = stations.byId.get(id); if (st) pos = st.group.position; } if (!pos) continue; const r = ringFor(id); r.visible = true; r.position.set(pos.x, 0.03, pos.z); r.scale.setScalar(1 + 0.08 * Math.sin(amb * 5)); }
  if (FREE) rig.update(dt); // the free camera moves only along a flight someone started (no drift)
  // on foot: the walker steps (out of the furniture and the people), and the camera is its eye
  if (!FREE && !ext) { if (!inRoom) officeBoxes(); fpStep(dt); }
  stepTrans(dt); stepFade(dt);
  if (!FREE && !ext) { player.apply(camera); controls.target.copy(camera.position).addScaledVector(camera.getWorldDirection(right3), 1); } // the target: a point 1 unit ahead of the eye (for the log: turning moves it little)
  applyExt();
  if (inRoom && machineRoom.door) { const dp = machineRoom.doorPoints(); const rdx = dp.c.x - player.pos.x, rdz = dp.c.z - player.pos.z, rd = Math.hypot(rdx, rdz), rt = (player.vel.x * rdx + player.vel.y * rdz) / Math.max(1e-6, rd) / player.scale; const want = !FREE && (rd < 0.9 * player.scale || (rd < 2.4 * player.scale && rt > 0.35)); const was = machineRoom.door.open; machineRoom.door.update(dt, want); if (machineRoom.door.open !== was) log.ev("world", "door", { which: "room", open: machineRoom.door.open }); } // log:
  if (inRoom && sel && sel.head) {
    // the machine room: the head's detail follows the camera's distance from its machines (their entry view at 0.57)
    const h = sel.head; const dist = camera.position.distanceTo(controls.target);
    detailNow = roomDetail(h, !!sel.focusId); h.setDetail(detailNow);
    h.update(t, live && !moving ? 0 : dt, playS); // the playhead itself: past a live run's last instant warp(t) stops
    if (FREE) { camera.near = Math.max(0.02, Math.min(0.3, dist * 0.02)); controls.minDistance = sel.focusId ? Math.max(0.5, 0.55 * (sel.focusDist || 1)) : Math.min(ROOM.minDist, roomEntry.dist * 0.4); }
    else camera.near = FP.near * player.scale;
  } else if (!inRoom) {
    if (sel && sel.head && !trans && !headPos(sel.id)) sel = null; // the person left the office
    camera.near = FREE ? 0.05 : FP.near;
  }
  camera.updateProjectionMatrix();
  // the opened capsule's card follows its capsule on screen (it stays where it was once the capsule has arrived)
  if (slipMsg && !inRoom) { const a = active.find((x) => x.msg.id === slipMsg.id); overlay.pinCard(a ? screenPt(a.pos) : null, amb); }
  if (FREE && !ext && !trans) controls.update();
  if (FREE && inRoom && !ext) { const p0 = camera.position.clone(); machineRoom.contain(camera.position); if (p0.distanceToSquared(camera.position) > 1e-10) camera.lookAt(controls.target); } // inside the room's wall
  // the free camera: nothing cuts through the frame (out of furniture, walls and people; the office only)
  if (FREE && !ext && !inRoom && !trans) { pushes.length = 0; const q = rig.resolve(camera.position, { skip: sel && sel.id, out: pushes }); if (q.distanceToSquared(camera.position) > 1e-8) { camera.position.copy(q); camera.lookAt(controls.target); if (amb - pushLogAt > 0.3) { pushLogAt = amb; log.ev("camera", "push", { n: pushes.length, ...pushes[0], by: rig.flight ? rig.flight.kind : "other" }); } } } // log: collision pushes
  if (!FREE) stepBody(dt);
  if (liveControls) { if (amb - liveSyncAt > 0.4) { liveSyncAt = amb; liveControls.sync(); } liveControls.update(amb); } // live
  recorder.update();
  if (!REC && !REPLAY) { const c0 = performance.now(); observe(moving); log.charge(performance.now() - c0 - viewMs); viewMs = 0; } // log: camera, mode, world, view
}

// ---------------------------------------------------------------- what the flight recorder samples each frame (engine/log.js)
const pushes = []; let pushLogAt = -1, detailNow = 0;
let viewMs = 0, modeLast = "", worldAt = -1, viewAt = -1, limitHit = "", lastT = null, detailLogged = -1, progs = 0;
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
  if (inRoom && sel) { if (Math.abs(detailNow - detailLogged) > 0.15 || (detailNow !== detailLogged && (detailNow === 0 || detailNow === 1))) { log.ev("world", "detail", { id: sel.id, d: +detailNow.toFixed(2) }); detailLogged = detailNow; } } else detailLogged = -1;
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
  if (inRoom) return roomSubjects();
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
// in a machine room: its parts, machines and stations alike (the first 120), nothing of the office
function roomSubjects() {
  const h = sel && sel.head; if (!h) return [];
  const out = h.states().slice(0, 120).map((id) => { const b = h.boundsOf(id).box; return { kind: "machine", id, min: b.min, max: b.max }; });
  if (!FREE) { const b = new THREE.Box3().setFromObject(machineRoom.door.group); out.push({ kind: "exit", id: "exit", min: b.min, max: b.max }); } // the way out: the room's door
  return out;
}
let platesKept = null, platesN = -1;
const attached = (o) => { let q = o; while (q.parent) q = q.parent; return q === scene; };
function viewSample() {
  if (inRoom) return roomSample();
  const subs = subjects(); let selected = null;
  if (sel && !inHead() && !sel.focusId) selected = subs.find((x) => x.id === sel.id && (x.kind === "actor" || x.kind === "station")) || null;
  if (!platesKept || platesN !== PLATES.size) { platesKept = []; for (const p of PLATES) { if (!attached(p)) PLATES.delete(p); else platesKept.push(p); } platesN = PLATES.size; } // the world's plates change only when it is built
  const plates = [...platesKept];
  if (models) plates.push(...models.plates());
  const out = viewer.sample({ camera, W: innerWidth, H: innerHeight, subjects: subs, plates, selected, occluded: (id) => occludedFrom(camera.position, id) });
  if (slipMsg) out.card = overlay.rects().card; // the opened card's rectangle on screen (it is kept inside it)
  return out;
}
// a machine room's view: its machines and plates, the exit control (always on screen), what is in focus
function roomSample() {
  const h = sel.head;
  const out = viewer.sample({ camera, W: innerWidth, H: innerHeight, subjects: roomSubjects(), plates: h.plates ? h.plates().map((x) => x.mesh) : [] });
  const ex = overlay.rects().exit; if (ex) { out.in.unshift(["exit", "exit", ...ex, Math.round(((ex[2] - ex[0]) * (ex[3] - ex[1]) * 1000) / (innerWidth * innerHeight)) / 10]); out.n.exit = 1; out.pickable++; }
  out.room = sel.id; out.head = headView(h);
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
    for (const [id, h] of [...heads]) { if (!info.reset && h.refresh && sim.chartOf(id)) { try { if (h.refresh() !== false) { log.ev("world", "head", { id, how: "refreshed" }); continue; } } catch (err) { console.warn("head refresh", id, err.message); } } h.group.removeFromParent(); try { h.dispose(); } catch {} heads.delete(id); }
    if (sel && sel.head && !heads.has(sel.id)) { const h = headFor(sel.id); h.focus(sel.focusId || null); sel.head = h; if (inRoom) machineRoom.mount(h.group); }
    liveControls.rebuild(worldRefs()); placeTicker(playS);
    if (window.api) Object.assign(window.api, { plan, people, stations, desks, tubes, building });
    liveSyncAt = -1; // the controls' lit and dim at the next frame (the driver is no longer busy then)
    viewBoxes = null; platesKept = null; if (pressWatch && !info.reset) { revealNext = pressWatch; pressWatch = null; } /* after the next update: the new people stand at their seats only then */ log.ev("world", "rebuild", { ms: Math.round(performance.now() - t0), events: sim.trace.events.length, actors: sim.actors.length }); // log:
  };
  live.on("change", rebuildWorld);
  liveControls.rebuild(worldRefs()); placeTicker(playS);
  window.live = live;
  live.screen = () => liveControls.screenPositions(camera, innerWidth, innerHeight);
  live.pressControl = (id) => liveControls.press(id);
}

// on foot: start just inside the door (the people at their seats first: the spawn turns to see them)
if (!FREE) { people.update(playS, 0); spawn(); }

// ---------------------------------------------------------------- drawing: the office or a machine room, then the overlay over it
function render() {
  renderer.render(inRoom ? machineRoom.scene : scene, camera);
  if (!FREE && !THIRD) body.render(renderer, camera); // the arms, over the world (they never cut into it)
  overlay.render(renderer);
}

// ---------------------------------------------------------------- live loop / film hooks
window.DURATION = LOOP * 1000;
window.state = () => ({ fp: FREE ? null : { at: xyz(player.pos), yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3), scale: +player.scale.toFixed(2), locked, auto: !!player.auto, door: +building.door.k.toFixed(2), roomDoor: +machineRoom.door.k.toFixed(2) }, system: SYSTEM, playS, t: tNow(), paused, speedIndex, sel: sel && { id: sel.id, stage: sel.stage, focusId: sel.focusId }, machineRoom: inRoom ? sel && sel.id : null, slip: slipMsg, card: overlay.rects().card, boardStatus, headStatus, loop: LOOP, actors: sim.actors.length, hub: plan.hub, room: [RW, RD] });
window.api = { sim, plan, cfg, scene, camera, controls, people, stations, desks, tubes, building, board: () => board, heads, headFor, machineRoom, overlay, ticker, models,
  select, enterHead, focusHead, frameAll, startView, personPts, boxPts, inFrame, hiddenPerson, back, openCapsule, walkTo, flyTo, home, homeView, togglePause, setSpeed, click, pickAt, perform, intentOf, recorder: () => recorder,
  setPlay: (s) => (playS = s), getPlay: () => playS, setPaused: (b) => (paused = b), setDisplayPaused: (b) => (displayPaused = b), clearSpot: () => (spot = null),
  reset: () => { if (inRoom) swapOut(); trans = null; overlay.setIris(0); sel = null; slipMsg = null; overlay.closeCard(); spot = null; flight = null; rig.stop(); board && board.highlight({}); }, rig, frameOf, leaveHead, inRoom: () => inRoom, render,
  getActive: () => tubes.active, tick: (sec) => { for (let i = 0; i < Math.round(sec * 30); i++) step(1 / 30); },
  fp: { player, spawn, spawnPose, officeWorld, body, approachTo, goalFor, aim: () => aimPoint(), locked: () => locked, busy: () => !!player.auto, last: () => lastApproach } };
// for the tools (tools/explore.mjs, live/test-live.mjs): walk the visitor up to something the way a visitor would
// (the autopilot steers the walker round the furniture), face it, and say when they are there; then the tool
// clicks at its screen point (no pointer lock) or at the crosshair (locked)
let lastApproach = null;
function goalFor(spec) {
  const P = (o) => o.getWorldPosition(v3()), N = (o) => { const n = v3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion())); n.y = 0; return n.normalize(); };
  if (spec.exit) { if (!inRoom) return null; const d = machineRoom.doorPoints(); return { through: d.out, look: d.look }; }
  if (spec.headState || spec.headEvent) { const h = sel && sel.head; if (!h || !inRoom) return null; let p = null; if (spec.headState) { const b = h.boundsOf(spec.headState); p = b && b.box && b.box.getCenter(v3()); } else { const a = h.affordances().find((x) => x.event === spec.headEvent && x.object); p = a && P(a.object); } if (!p) return null; const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z); return { look: p, at: p, dist: Math.min(d, 0.8 * reachFor("head")), maxDist: 0.9 * reachFor("head") }; }
  if (spec.control) { const it = liveControls && liveControls.items.get(spec.control); if (!it) return null; const p = P(it.ui.group); return { look: p, at: p, normal: N(it.ui.group), dist: 1.05, maxDist: 2.2 }; }
  if (spec.actor) {
    const a = sim.actor(spec.actor), st = stations.byId.get(spec.actor);
    if (st) { const p = P(st.group).add(v3(0, 1.1, 0)); return { look: p, at: p, normal: N(st.group), dist: 1.7, maxDist: 2.6 }; }
    const seat = people.seatOfActor(spec.actor, playS); const c = headPos(spec.actor); if (!a || !seat || !c) return null;
    const f = seat.avatar.root.rotation.y, n = v3(Math.sin(f), 0, Math.cos(f)); const m = models && models.boxOf(spec.actor); const look = m ? m.getCenter(v3()) : c;
    return { look, at: seat.avatar.root.position.clone(), normal: n, dist: 2.15, maxDist: 2.8 };
  }
  if (spec.board) { const c = boardMesh.position.clone(), n = N(boardMesh); return { look: c, at: c, normal: n, dist: Math.min(6.5, Math.max(3.2, plan.board.w * 0.7)) }; }
  if (spec.ticker) { const b = ticker.box(); const c = b.getCenter(v3()); return { look: c, at: c, normal: N(ticker.root), dist: 1.5 }; }
  if (spec.recorder) { const b = recorder.box(); const c = b.getCenter(v3()); return { look: c, at: c, normal: v3(0, 0, -1), dist: 1.3 }; }
  if (spec.door) { const d = plan.door; return { look: v3(d.x, 1.4, d.z), at: v3(d.x, 0, d.z), normal: v3(0, 0, -1), dist: spec.dist ?? 3 }; }
  if (spec.point) { const p = v3(...spec.point); return { look: spec.look ? v3(...spec.look) : null, at: p, dist: 0.05 }; }
  return null;
}
function approachTo(spec) {
  const g = goalFor(spec); lastApproach = { spec, ok: null };
  if (!g) { lastApproach.ok = false; return false; }
  const r = lastApproach; log.ev("camera", "fly", { kind: "approach", dur: 0, from: xyz(camera.position), to: xyz(g.through || g.at || g.look), tgt: xyz(g.look || g.at), via: 0, auto: true }); // log: the tools' autopilot (the walker walks there)
  if (!player.approach(g, (ok) => { r.ok = ok || (!!spec.exit && (!inRoom || !!trans)); log.ev("camera", "arrive", { kind: "approach", ok: r.ok }); })) { r.ok = false; return false; } // walking out of a machine room ends the walk there
  return true;
}
if (REC) {
  const { makeFilm } = await import("./film.js");
  const film = makeFilm({ THREE, api: window.api, sim, plan, step, render, setAmb: (a) => (amb = a), camera, controls, cfg });
  window.DURATION = film.duration * 1000; window.setTime = (ms) => film.setTime(ms / 1000); window.filmScript = film.script;
  window.ready = true;
} else {
  let last = performance.now();
  // ?noloop: tools/shoot.mjs steps the world itself (api.tick) and renders with api.render, so stills are exact
  if (params.has("noloop") || REPLAY) window.api.render = render;
  else renderer.setAnimationLoop(() => {
    log.frameStart(); // log: every frame's dt
    const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now; step(dt); render();
    const np = renderer.info.programs?.length || 0; if (np !== progs) { if (progs) log.note("shader"); progs = np; } // log: a shader compiled in this frame
    log.frameEnd(renderer.info.render);
  });
  // ?replay=1: tools/replay.mjs steps the world by the log's time and sets the camera and the playhead from it
  if (REPLAY) window.api.replay = { step: (dt, e, render = true) => { ext = e; step(dt); if (render) window.api.render(); }, perform: (a) => perform(a, "replay"), mode: () => modeNow(true), view: () => viewSample() };
  if (params.get("log") === "1") log.arm(); // a crash copy in sessionStorage, exported with the next session
  log.ev("session", "ready", { ms: Math.round(performance.now() - log.origin) }); log.note("first-frame");
  window.ready = true;
}
