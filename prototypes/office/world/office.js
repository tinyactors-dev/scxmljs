// world/office.js: the building, the furniture and every station's moving parts.
// Each station's update reads the run at (playS, t) and moves its objects: the desk IS the datamodel.
import * as THREE from "three";
import { box, block, cyl, mat, plate, canvasTex, patternTex, ease, clamp01, lerp, hash } from "./kit.js";
import * as L from "./layout.js";

const WOOD = "#a8743f", WOOD_D = "#7d5330", WOOD_L = "#c99a62", BRASS = "#c9a14a", STEEL = "#8d96a3", PAPER = "#f6f0de";

export function buildOffice(scene, sim) {
  const root = new THREE.Group(); scene.add(root);
  const updaters = [];
  const pick = []; // {object, kind, id}

  // ---------- floor, walls, beams ----------
  const floorTex = patternTex((g, w, h) => {
    g.fillStyle = "#c79a64"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#bf915a" : "#cfa36c"; g.fillRect(0, i * 16, w, 15); g.fillStyle = "rgba(90,60,30,.25)"; g.fillRect(((i * 53) % w), i * 16, 2, 15); g.fillRect(((i * 53 + 70) % w), i * 16, 2, 15); }
  }, 128, [17, 13]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(32, 24.5), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -0.75); floor.receiveShadow = true; root.add(floor);
  pick.push({ object: floor, kind: "floor" });
  // a carpet under the exchange and a runner along the aisle
  const rug = new THREE.Mesh(new THREE.CircleGeometry(3.4, 8), mat("#8c3b34")); rug.rotation.x = -Math.PI / 2; rug.rotation.z = Math.PI / 8; rug.position.set(0, 0.01, -1); rug.receiveShadow = true; root.add(rug);
  const rug2 = new THREE.Mesh(new THREE.CircleGeometry(3.0, 8), mat("#b0573f")); rug2.rotation.x = -Math.PI / 2; rug2.rotation.z = Math.PI / 8; rug2.position.set(0, 0.015, -1); rug2.receiveShadow = true; root.add(rug2);
  const runner = new THREE.Mesh(new THREE.PlaneGeometry(29, 1.4), mat("#5c6f5a")); runner.rotation.x = -Math.PI / 2; runner.position.set(-0.5, 0.012, L.AISLE_Z); runner.receiveShadow = true; root.add(runner);

  const wallTex = patternTex((g, w, h) => { g.fillStyle = "#e9dcc2"; g.fillRect(0, 0, w, h); g.fillStyle = "#e2d2b4"; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 7, h); }, 64, [30, 3]);
  const wallM = new THREE.MeshLambertMaterial({ map: wallTex });
  const wall = (w, h, d, x, y, z, m = wallM) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y + h / 2, z); b.receiveShadow = true; b.castShadow = true; root.add(b); return b; };
  // north wall (tall) and west wall (tall, with the door gap at DOOR.z)
  wall(32.3, 4.4, 0.3, 0, 0, -13);
  const dz = L.DOOR[2];
  wall(0.3, 4.4, dz - 0.9 - -13, -16, 0, (-13 + dz - 0.9) / 2);
  wall(0.3, 4.4, 11.5 - (dz + 0.9), -16, 0, (11.5 + dz + 0.9) / 2);
  wall(0.3, 1.6, 1.8, -16, 2.8, dz); // lintel
  // wainscot along the tall walls
  block(root, 32, 1.0, 0.06, WOOD_D, 0, 0, -12.82); block(root, 0.06, 1.0, 24.2, WOOD_D, -15.82, 0, -0.75);
  // low walls south and east (cut away so you can look in)
  wall(32.3, 0.9, 0.3, 0, 0, 11.5); wall(0.3, 0.9, 24.5, 16, 0, -0.75);
  block(root, 32.6, 0.08, 0.42, WOOD, 0, 0.9, 11.5); block(root, 0.42, 0.08, 24.8, WOOD, 16, 0.9, -0.75);
  // door: an open wooden door swung into the room, a mat
  const door = block(root, 0.08, 2.75, 1.6, "#6b4a2b", -15.8, 0, dz); door.position.x = -15.3; door.position.z = dz - 1.25; door.rotation.y = 1.25;
  const mat1 = block(root, 1.2, 0.02, 1.6, "#3a4a6a", -15.1, 0, dz); mat1.castShadow = false;
  // ceiling beams the tubes hang from
  // windows on the north wall (light boxes)
  for (const x of [-8.2, 12.6]) { const f = block(root, 2.6, 1.8, 0.1, WOOD_D, x, 1.6, -12.8); const g = block(root, 2.3, 1.5, 0.12, "#bfe3ff", x, 1.75, -12.78, { mat: { emissive: "#6fa6d6", emissiveIntensity: 0.55 } }); g.castShadow = false; block(root, 0.08, 1.5, 0.14, WOOD_D, x, 1.75, -12.76); }
  // plants
  const plant = (x, z, s = 1) => { const p = block(root, 0.5 * s, 0.5 * s, 0.5 * s, "#b5643a", x, 0, z); for (let i = 0; i < 5; i++) { const l = box(0.18 * s, 0.6 * s, 0.18 * s, i % 2 ? "#3f8a3e" : "#4fa04a"); l.position.set(x + Math.sin(i * 2.4) * 0.15 * s, 0.75 * s + (i % 3) * 0.12, z + Math.cos(i * 2.4) * 0.15 * s); l.rotation.z = Math.sin(i * 2.4) * 0.5; l.rotation.x = Math.cos(i * 2.4) * 0.5; root.add(l); } };
  plant(15.2, 10.7, 1.2); plant(15.2, -12.2, 1.4); plant(-7.0, -12.2, 1.1); plant(6.6, 1.0, 1.0); plant(-6.6, 1.2, 1.0); plant(6.6, -7.4, 0.9);
  // a water cooler near reception, a coat rack by the door
  { const c = new THREE.Group(); c.position.set(-15.3, 0, 2.4); root.add(c); block(c, 0.5, 1.0, 0.5, "#dfe5ea", 0, 0, 0); const jug = cyl(0.2, 0.5, "#7cc7ff", 10, { mat: { transparent: true, opacity: 0.75 } }); jug.position.y = 1.25; c.add(jug); }
  { const c = new THREE.Group(); c.position.set(-15.4, 0, 6.2); root.add(c); block(c, 0.08, 1.9, 0.08, WOOD_D, 0, 0, 0); block(c, 0.5, 0.06, 0.5, WOOD_D, 0, 0, 0); block(c, 0.45, 0.55, 0.12, "#8c3b34", 0.15, 1.2, 0); }

  // ---------- helpers ----------
  const nameplate = (parent, text, x, y, z, ry = 0, w = 0.62) => { const p = plate(text, { w, h: 0.16 }); p.position.set(x, y, z); p.rotation.y = ry; parent.add(p); const back = box(w + 0.04, 0.18, 0.04, WOOD_D); back.position.set(x, y, z - 0.025 * Math.cos(ry)); back.rotation.y = ry; parent.add(back); return p; };
  const lamp = (parent, x, y, z, color = "#ffd36b") => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); const base = cyl(0.07, 0.04, "#333"); g.add(base); const bulbM = new THREE.MeshLambertMaterial({ color: "#555", emissive: color, emissiveIntensity: 0 }); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), bulbM); bulb.position.y = 0.07; g.add(bulb); return { g, set(on, c) { bulbM.emissiveIntensity = on ? 1.4 : 0; bulbM.color.set(on ? (c || color) : "#555"); if (c) bulbM.emissive.set(c); } }; };
  const counterTex = (digits = 3) => { const t = canvasTex(64 * digits, 96, () => {}); return { tex: t, last: null, draw(n) { if (n === this.last) return; this.last = n; const g = t.userData.ctx, c = t.userData.canvas; g.fillStyle = "#1b1b1b"; g.fillRect(0, 0, c.width, c.height); const s = String(Math.max(0, n | 0)).padStart(digits, "0").slice(-digits); for (let i = 0; i < digits; i++) { g.fillStyle = "#efe6d0"; g.fillRect(i * 64 + 5, 6, 54, 84); g.fillStyle = "#1b1b1b"; g.fillRect(i * 64 + 5, 46, 54, 3); g.font = "bold 66px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(s[i], i * 64 + 32, 52); } t.needsUpdate = true; } }; };
  const paperStack = (parent, x, y, z, max = 10, color = PAPER) => { const sheets = []; for (let i = 0; i < max; i++) { const s = box(0.3, 0.028, 0.38, color); s.position.set(x + (hash(i) - 0.5) * 0.03, y + 0.015 + i * 0.03, z + (hash(i + 9) - 0.5) * 0.03); s.rotation.y = (hash(i + 3) - 0.5) * 0.25; s.visible = false; parent.add(s); sheets.push(s); } return (n) => sheets.forEach((s, i) => (s.visible = i < n)); };

  const L0 = (id) => sim.actor(id);

  // ---------- client cubicles ----------
  const desks = {};
  for (const [id, c] of Object.entries(L.CLIENTS)) {
    const g = new THREE.Group(); g.position.set(c.x, 0, 0); root.add(g);
    const dz = L.DESK_Z;
    // partitions (fabric) left/right and front-low; the person sits behind the desk, facing south
    const fabric = c.color;
    block(g, 0.12, 1.12, 2.6, "#7d8a96", -1.55, 0, dz - 0.6); block(g, 0.12, 1.12, 2.6, "#7d8a96", 1.55 + (id === "terminal" || id === "python" ? 0.95 : 0), 0, dz - 0.6);
    block(g, 0.14, 0.06, 2.62, fabric, -1.55, 1.12, dz - 0.6); block(g, 0.14, 0.06, 2.62, fabric, 1.55 + (id === "terminal" || id === "python" ? 0.95 : 0), 1.12, dz - 0.6);
    // desk
    block(g, 2.2, 0.08, 0.95, WOOD_L, 0, 0.74, dz);
    block(g, 0.08, 0.74, 0.85, WOOD, -1.0, 0, dz); block(g, 0.08, 0.74, 0.85, WOOD, 1.0, 0, dz);
    block(g, 2.0, 0.55, 0.05, WOOD, 0, 0.19, dz + 0.42); // modesty panel facing the visitor
    // nameplate on the desk's front edge, facing south
    nameplate(g, c.name, 0, 0.5, dz + 0.47, 0, 0.7);
    // chair
    const chair = new THREE.Group(); chair.position.set(0, 0, L.SEAT_Z - 0.05); g.add(chair);
    block(chair, 0.62, 0.08, 0.6, "#3d4250", 0, 0.48, 0); block(chair, 0.62, 0.7, 0.08, "#3d4250", 0, 0.52, -0.33); block(chair, 0.08, 0.46, 0.08, "#222", 0, 0.02, 0); block(chair, 0.6, 0.04, 0.08, "#222", 0, 0, 0); block(chair, 0.08, 0.04, 0.6, "#222", 0, 0, 0);
    // monitor (screen faces the person, north); offset so the face shows
    const mon = new THREE.Group(); mon.position.set(0.55, 0.78, dz + 0.12); g.add(mon);
    block(mon, 0.08, 0.2, 0.08, "#2b2b2b", 0, 0, 0.05); block(mon, 0.72, 0.5, 0.08, "#2b2b2b", 0, 0.2, 0.05);
    const scr = canvasTex(128, 88, (x) => { x.fillStyle = "#111"; x.fillRect(0, 0, 128, 88); });
    const scrM = new THREE.MeshLambertMaterial({ map: scr, emissive: "#ffffff", emissiveMap: scr, emissiveIntensity: 0.9 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.42), scrM); screen.position.set(0, 0.45, 0.005); screen.rotation.y = Math.PI; mon.add(screen);
    // keyboard
    block(g, 0.62, 0.035, 0.22, "#d8d4cc", 0.0, 0.82, dz - 0.25);
    // desk lamp (on while the client is online and here)
    const lampG = new THREE.Group(); lampG.position.set(-0.75, 0.82, dz + 0.25); g.add(lampG);
    block(lampG, 0.2, 0.04, 0.2, "#2d4a3a", 0, 0, 0); block(lampG, 0.04, 0.45, 0.04, "#2d4a3a", 0, 0.03, 0);
    const shadeM = new THREE.MeshLambertMaterial({ color: "#3f7a5a", emissive: "#ffd66b", emissiveIntensity: 0 });
    const shade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.2), shadeM); shade.position.set(0.08, 0.5, -0.04); shade.rotation.z = -0.4; lampG.add(shade);
    const light = new THREE.PointLight("#ffd27a", 0, 3.2, 1.6); light.position.set(0.1, 0.35, -0.2); lampG.add(light);
    // in-tray (queue): wire basket at the desk's front-left, paper stack = queue length
    const trayX = -0.42, trayZ = dz + 0.05;
    block(g, 0.4, 0.02, 0.46, STEEL, trayX, 0.82, trayZ); block(g, 0.4, 0.12, 0.02, STEEL, trayX, 0.82, trayZ + 0.23); block(g, 0.4, 0.12, 0.02, STEEL, trayX, 0.82, trayZ - 0.23); block(g, 0.02, 0.12, 0.46, STEEL, trayX - 0.2, 0.82, trayZ); block(g, 0.02, 0.12, 0.46, STEEL, trayX + 0.2, 0.82, trayZ);
    const letters = []; for (let i = 0; i < 6; i++) { const l = new THREE.Group(); l.position.set(trayX - 0.15 + i * 0.06, 0.84, trayZ); l.rotation.z = (hash(i + 4) - 0.5) * 0.15; const env = box(0.035, 0.26, 0.34, "#ffd84a"); env.position.y = 0.13; l.add(env); const st = box(0.04, 0.06, 0.06, "#d03a2a"); st.position.set(0, 0.22, 0.11); l.add(st); l.visible = false; g.add(l); letters.push(l); }
    const tray = (n) => letters.forEach((l, i) => (l.visible = i < n));
    // keys on hooks on the left partition: input / control / tools (granted)
    const keys = {}; const keyCol = { input: "#f2c53d", control: "#e0483e", tools: "#3fcf7c" };
    ["input", "control", "tools"].forEach((role, i) => { const hz = dz - 1.1 + i * 0.32; block(g, 0.04, 0.04, 0.12, BRASS, -1.47, 1.05, hz); const k = new THREE.Group(); k.position.set(-1.43, 0.9, hz); g.add(k); const ring = box(0.03, 0.12, 0.12, keyCol[role]); k.add(ring); const stem = box(0.03, 0.2, 0.04, keyCol[role]); stem.position.y = -0.15; k.add(stem); const bit = box(0.03, 0.04, 0.08, keyCol[role]); bit.position.set(0, -0.23, 0.04); k.add(bit); k.visible = false; keys[role] = k; });
    // pigeonholes (running tool calls): a little rack at the right end of the desk
    const ph = new THREE.Group(); ph.position.set(1.0, 0.82, dz + 0.26); g.add(ph);
    block(ph, 0.44, 0.02, 0.22, WOOD_D, 0, 0, 0); block(ph, 0.44, 0.02, 0.22, WOOD_D, 0, 0.3, 0); for (let i = 0; i < 4; i++) block(ph, 0.02, 0.3, 0.22, WOOD_D, -0.21 + i * 0.14, 0, 0); block(ph, 0.44, 0.32, 0.02, WOOD_D, 0, 0, 0.1);
    const cards = [0, 1, 2].map((i) => { const k = box(0.1, 0.2, 0.16, "#3fcf7c"); k.position.set(-0.14 + i * 0.14, 0.13, -0.02); k.rotation.x = -0.15; k.visible = false; ph.add(k); return k; });
    // rejection: a red note stuck to the monitor's back (faces the visitor) and front
    const note = box(0.26, 0.2, 0.012, "#ff6a5c"); note.position.set(-0.26, 0.38, 0.11); note.rotation.z = 0.12; note.visible = false; mon.add(note);
    // awaiting: a slip clipped to the tube mouth (sent, not yet answered)
    const [mx, my, mz] = L.clientMouth(id);
    const slip = box(0.16, 0.22, 0.012, "#fff6c8"); slip.position.set(mx - c.x + 0.16, my - 0.05, mz); slip.rotation.y = 0.3; slip.visible = false; g.add(slip);
    // seq: a mechanical counter on the desk, facing the visitor (the last log entry applied)
    const ctr = counterTex(3); const ctrM = new THREE.MeshLambertMaterial({ map: ctr.tex });
    const ctrBox = new THREE.Group(); ctrBox.position.set(0.0, 0.82, dz + 0.34); g.add(ctrBox); block(ctrBox, 0.36, 0.14, 0.1, "#4a3b2b", 0, 0, 0);
    const ctrFace = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1), ctrM); ctrFace.position.set(0, 0.07, 0.051); ctrBox.add(ctrFace);
    // tool machine beside providers
    let machine = null;
    if (id === "terminal" || id === "python") machine = buildToolMachine(g, id, c);
    desks[id] = { g, c, screen: scr, scrM, shadeM, light, tray, keys, cards, note, slip, ctr, machine, lastSeq: -1 };
  }

  function buildToolMachine(g, id, c) {
    const m = new THREE.Group(); const [x, , z] = L.toolMachine(id); m.position.set(x - c.x, 0, z); g.add(m);
    const body = id === "terminal" ? "#4b5b4a" : "#3d5a8a";
    block(m, 0.75, 1.05, 0.7, body, 0, 0, 0); block(m, 0.8, 0.08, 0.75, "#2b2b2b", 0, 1.05, 0);
    // a round window with a gear inside, a chimney, a crank, a lamp
    const gear = new THREE.Group(); gear.position.set(0, 0.62, 0.36); m.add(gear);
    for (let i = 0; i < 8; i++) { const tooth = box(0.07, 0.38, 0.04, BRASS); tooth.rotation.z = (i * Math.PI) / 8; gear.add(tooth); }
    const hubM = cyl(0.08, 0.05, "#7a5a20"); hubM.rotation.x = Math.PI / 2; gear.add(hubM);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 16), mat("#2b2b2b")); rim.position.set(0, 0.62, 0.37); m.add(rim);
    const chim = block(m, 0.16, 0.35, 0.16, "#2b2b2b", 0.22, 1.13, -0.15);
    const crank = new THREE.Group(); crank.position.set(-0.4, 0.6, 0); m.add(crank); const arm = box(0.04, 0.3, 0.04, STEEL); arm.position.y = 0.13; crank.add(arm); const knob = box(0.09, 0.09, 0.09, "#c43b2e"); knob.position.set(-0.05, 0.27, 0); crank.add(knob); crank.rotation.x = 0;
    const lp = lamp(m, 0.24, 1.13, 0.22, "#5cff9c");
    const p = plate(id === "terminal" ? "SHELL" : "PYTHON", { w: 0.5, h: 0.12, bg: "#d6c18a" }); p.position.set(0, 0.25, 0.356); m.add(p);
    const puffs = [0, 1, 2].map((i) => { const s = box(0.14, 0.14, 0.14, "#e8e8e8", { cast: false }); s.material = new THREE.MeshLambertMaterial({ color: "#eeeeee", transparent: true, opacity: 0.8 }); s.visible = false; m.add(s); return s; });
    // the tube from the desk to the machine (short, low)
    return { m, gear, crank, lamp: lp, puffs, chimney: chim };
  }

  // ---------- the exchange (host) ----------
  const ex = new THREE.Group(); ex.position.set(0, 0, -1); root.add(ex);
  // octagonal counter, open at the north side where the switchboard panel stands
  for (let i = 0; i < 8; i++) { if (i === 4) continue; const a = (i / 8) * Math.PI * 2; const seg = new THREE.Group(); seg.position.set(Math.sin(a) * 1.9, 0, Math.cos(a) * 1.9); seg.rotation.y = a; ex.add(seg); block(seg, 1.5, 0.72, 0.45, WOOD, 0, 0, 0); block(seg, 1.6, 0.07, 0.6, WOOD_L, 0, 0.72, 0); block(seg, 1.4, 0.08, 0.05, BRASS, 0, 0.6, 0.24); }
  // switchboard panel behind the host (north), facing south
  const panel = new THREE.Group(); panel.position.set(0, 0, -1.55); ex.add(panel);
  block(panel, 2.6, 2.1, 0.35, "#5a3b22", 0, 0, 0); block(panel, 2.7, 0.12, 0.45, WOOD_D, 0, 2.1, 0);
  const jackOrder = ["ada", "bo", "terminal", "python", "llm"];
  const jacks = {}; jackOrder.forEach((cid, i) => { const x = -1.0 + i * 0.5; const jp = new THREE.Group(); jp.position.set(x, 1.15, 0.18); panel.add(jp); const hole = cyl(0.06, 0.04, "#111"); hole.rotation.x = Math.PI / 2; jp.add(hole); const l = lamp(panel, x, 1.45, 0.16, cid === "llm" ? "#c79bff" : L.CLIENTS[cid]?.color); const p = plate(cid === "llm" ? "MODEL" : L.CLIENTS[cid].name.toUpperCase(), { w: 0.44, h: 0.1, bg: "#e9dcb4" }); p.position.set(x, 1.66, 0.18); panel.add(p); jacks[cid] = { pos: new THREE.Vector3(x, 1.15, 0.2), lamp: l }; });
  // roster pegboard on the panel: a peg per known client, lit when on the roster (host.clients)
  const pegs = {}; ["ada", "bo", "terminal", "python"].forEach((cid, i) => { const pg = box(0.12, 0.12, 0.1, "#333"); pg.position.set(-0.9 + i * 0.6, 0.62, 0.2); panel.add(pg); pegs[cid] = pg; });
  // patch cords for pending tool calls (host.pending: callId -> provider), and the model line
  const cordGeo = (a, b) => new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, new THREE.Vector3((a.x + b.x) / 2, Math.min(a.y, b.y) - 0.45, a.z + 0.25), b), 16, 0.022, 6);
  const plugBase = new THREE.Vector3(0, 0.95, 0.2);
  const cords = {}; jackOrder.forEach((cid) => { const mesh = new THREE.Mesh(cordGeo(plugBase, jacks[cid].pos), mat(cid === "llm" ? "#8d5cd6" : "#2fa865")); mesh.visible = false; panel.add(mesh); cords[cid] = mesh; });
  block(panel, 0.5, 0.18, 0.12, "#333", 0, 0.86, 0.2);
  // the turn counter on the counter's south face (host.turn)
  const turnCtr = counterTex(2); const tcm = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), new THREE.MeshLambertMaterial({ map: turnCtr.tex }));
  tcm.position.set(0, 0.4, 2.13); ex.add(tcm); block(ex, 0.62, 0.46, 0.04, "#2b2b2b", 0, 0.17, 2.1);
  nameplate(ex, "EXCHANGE", 0, 0.83, 2.2, 0, 1.1);
  // held steers clip (host.steers): yellow slips on a clipboard at the counter's west segment
  const steerG = new THREE.Group(); steerG.position.set(-1.45, 0.79, 0.85); steerG.rotation.y = -0.7; ex.add(steerG); block(steerG, 0.36, 0.02, 0.46, WOOD_D, 0, 0, 0); block(steerG, 0.14, 0.04, 0.06, STEEL, 0, 0.02, -0.2);
  const steerSlips = [0, 1, 2].map((i) => { const s = box(0.28, 0.012, 0.18, "#ffe35c"); s.position.set(0, 0.025 + i * 0.015, -0.05 + i * 0.05); s.visible = false; steerG.add(s); return s; });
  // the stop flag (host.stoppedBy): a little red flag on the counter's east segment
  const flagG = new THREE.Group(); flagG.position.set(1.45, 0.77, 0.85); ex.add(flagG); block(flagG, 0.03, 0.55, 0.03, STEEL, 0, 0, 0);
  const flagTex = canvasTex(128, 64, () => {}); const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide })); flag.position.set(0.18, 0.44, 0); flagG.add(flag); let flagWho = undefined;
  // the host's chair and phone (the line to the model)
  const hchair = new THREE.Group(); hchair.position.set(0, 0, -1.25 + 1); ex.add(hchair);
  block(hchair, 0.62, 0.08, 0.6, "#7b2f2a", 0, 0.48, 0); block(hchair, 0.62, 0.7, 0.08, "#7b2f2a", 0, 0.52, -0.33); block(hchair, 0.08, 0.46, 0.08, "#222", 0, 0.02, 0);
  // desk surface in front of the host (south), with a phone set
  block(ex, 1.6, 0.06, 0.7, WOOD_L, 0, 0.76, 0.65);
  const phoneBase = block(ex, 0.3, 0.1, 0.22, "#1d1d1d", 0.5, 0.8, 0.6);
  const receiverOnHook = block(ex, 0.34, 0.06, 0.08, "#1d1d1d", 0.5, 0.91, 0.6);
  // spike with incoming notes (host.incoming)
  block(ex, 0.12, 0.02, 0.12, STEEL, -0.55, 0.8, 0.6); block(ex, 0.015, 0.25, 0.015, STEEL, -0.55, 0.8, 0.6);
  const spikeNotes = [0, 1, 2].map((i) => { const s = box(0.2, 0.01, 0.2, PAPER); s.position.set(-0.55, 0.86 + i * 0.03, 0.6); s.rotation.y = i * 0.4; s.visible = false; ex.add(s); return s; });
  // pigeonholes for pending calls on the panel (cards per pending call)
  const pcards = [0, 1, 2].map((i) => { const k = box(0.12, 0.2, 0.05, "#3fcf7c"); k.position.set(0.85 + i * 0.16, 0.3, 0.2); k.visible = false; panel.add(k); return k; });
  for (let i = 0; i < 4; i++) block(panel, 0.02, 0.26, 0.08, WOOD_D, 0.77 + i * 0.16, 0.18, 0.2);

  // ---------- the model's room ----------
  const mr = new THREE.Group(); root.add(mr);
  // glass front with wooden mullions, a door gap in the middle
  const glassM = new THREE.MeshLambertMaterial({ color: "#bfe0ef", transparent: true, opacity: 0.18, depthWrite: false });
  for (const [x0, x1] of [[-6, -1.0], [1.0, 6]]) { const gl = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 3.0, 0.05), glassM); gl.position.set((x0 + x1) / 2, 1.5, -7.6); mr.add(gl); for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 3) block(mr, 0.1, 3.0, 0.12, WOOD_D, x, 0, -7.6); block(mr, x1 - x0, 0.1, 0.14, WOOD_D, (x0 + x1) / 2, 3.0, -7.6); block(mr, x1 - x0, 0.6, 0.12, WOOD_D, (x0 + x1) / 2, 0, -7.6); }
  block(mr, 0.15, 3.0, 5.4, WOOD_D, -6, 0, -10.3); block(mr, 0.15, 3.0, 5.4, WOOD_D, 6, 0, -10.3);
  const mrFloor = new THREE.Mesh(new THREE.PlaneGeometry(12, 5.4), mat("#3b3550")); mrFloor.rotation.x = -Math.PI / 2; mrFloor.position.set(0, 0.014, -10.3); mrFloor.receiveShadow = true; mr.add(mrFloor);
  // the oracle: a tall cabinet with two tape reels, a field of lamps, a speaking horn, a paper slot
  const or = new THREE.Group(); or.position.set(...L.MODEL.at); mr.add(or);
  block(or, 3.4, 2.4, 1.2, "#3f3a5c", 0, 0, 0); block(or, 3.6, 0.15, 1.35, "#2a2640", 0, 2.4, 0); block(or, 3.6, 0.3, 1.35, "#2a2640", 0, 0, 0);
  const reels = [-0.85, 0.85].map((x) => { const r = new THREE.Group(); r.position.set(x, 1.65, 0.62); or.add(r); const d = cyl(0.42, 0.06, "#d8d8d8", 20); d.rotation.x = Math.PI / 2; r.add(d); const hub = cyl(0.12, 0.08, "#333", 10); hub.rotation.x = Math.PI / 2; r.add(hub); for (let i = 0; i < 3; i++) { const sp = box(0.06, 0.7, 0.02, "#555"); sp.position.z = 0.04; sp.rotation.z = (i * Math.PI) / 3; r.add(sp); } return r; });
  const tape = block(or, 1.7, 0.03, 0.02, "#5a3a1a", 0, 1.98, 0.63);
  const lamps = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) { const l = lamp(or, -1.05 + c * 0.3, 0.6 + r * 0.22, 0.6, ["#ff6b6b", "#ffd36b", "#7dffb0"][r]); l.g.rotation.x = Math.PI / 2; lamps.push(l); }
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.08, 0.7, 10, 1, true), mat(BRASS, { side: THREE.DoubleSide })); horn.position.set(1.2, 2.85, 0.35); horn.rotation.x = 1.25; or.add(horn);
  const eyeM = new THREE.MeshLambertMaterial({ color: "#222", emissive: "#b98cff", emissiveIntensity: 0.2 }); const eye = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), eyeM); eye.position.set(0, 2.85, 0.1); or.add(eye);
  const pupil = box(0.12, 0.12, 0.05, "#111"); pupil.position.set(0, 2.85, 0.36); or.add(pupil);
  const slot = block(or, 1.0, 0.06, 0.1, "#111", 0, 0.38, 0.62);
  const printout = box(0.7, 0.02, 0.5, PAPER); printout.position.set(0, 0.38, 0.9); printout.visible = false; or.add(printout);
  const oracleLight = new THREE.PointLight("#b98cff", 0, 9, 1.4); oracleLight.position.set(0, 2.2, 1.6); or.add(oracleLight);
  { const p = plate("THE MODEL", { w: 1.3, h: 0.24, bg: "#c9a14a" }); p.position.set(0, 2.25, 0.61); or.add(p); }

  // ---------- the archive (chat log) ----------
  const ar = new THREE.Group(); root.add(ar);
  for (let i = 0; i < 4; i++) { const cab = new THREE.Group(); cab.position.set(15.4, 0, -2.0 + i * 1.0); cab.rotation.y = -Math.PI / 2; ar.add(cab); block(cab, 0.9, 1.6, 0.7, "#6d7a6a", 0, 0, 0); for (let d = 0; d < 4; d++) { block(cab, 0.8, 0.34, 0.04, "#7f8d7b", 0, 0.06 + d * 0.38, 0.36); block(cab, 0.22, 0.05, 0.05, BRASS, 0, 0.2 + d * 0.38, 0.39); } }
  const adesk = new THREE.Group(); adesk.position.set(...L.ARCHIVE.desk); ar.add(adesk);
  block(adesk, 1.0, 0.08, 1.8, WOOD_L, -0.3, 0.74, 0); block(adesk, 0.9, 0.74, 0.08, WOOD, -0.3, 0, -0.85); block(adesk, 0.9, 0.74, 0.08, WOOD, -0.3, 0, 0.85);
  nameplate(adesk, "CHAT LOG", -0.82, 0.5, 0, -Math.PI / 2, 0.8);
  // the ledger (open book) and the pile of filled pages = log entries written so far
  const ledger = new THREE.Group(); ledger.position.set(-0.45, 0.82, 0.1); adesk.add(ledger);
  block(ledger, 0.5, 0.04, 0.7, "#6b2b2b", 0, 0, 0); block(ledger, 0.44, 0.03, 0.32, PAPER, 0, 0.04, -0.17); block(ledger, 0.44, 0.03, 0.32, PAPER, 0, 0.04, 0.17);
  const pageTex = canvasTex(64, 96, () => {}); const pageM = new THREE.MeshLambertMaterial({ map: pageTex });
  const pageFace = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), pageM); pageFace.rotation.x = -Math.PI / 2; pageFace.rotation.z = -Math.PI / 2; pageFace.position.set(0, 0.072, 0.17); ledger.add(pageFace);
  const filed = new THREE.Group(); filed.position.set(-0.4, 0.78, -0.7); adesk.add(filed);
  const binders = []; for (let i = 0; i < 12; i++) { const b = box(0.08, 0.3, 0.26, ["#2b5a8a", "#8a2b2b", "#2b8a5a", "#8a7a2b"][i % 4]); b.position.set(-0.04 - (i % 6) * 0.0 , 0.15 + Math.floor(i / 6) * 0.0, 0); b.position.set(0, 0.15, 0); b.position.z = -0.0; b.position.x = 0; b.visible = false; filed.add(b); binders.push(b); }
  binders.forEach((b, i) => { b.position.set(0.25 - (i % 6) * 0.09, 0.15 + Math.floor(i / 6) * 0.32, 0); });
  const pileStack = paperStack(adesk, -0.4, 0.82, 0.62, 10);

  // ---------- the storeroom (workspace and its six packages) ----------
  const st = new THREE.Group(); root.add(st);
  block(st, 0.12, 2.6, 4.8, "#9a8a72", -9.2, 0, -10.6); block(st, 3.6, 2.6, 0.12, "#9a8a72", -14.2, 0, -8.2);
  block(st, 4.2, 0.08, 2.4, WOOD_D, -13.6, 0.95, -11.5); block(st, 4.2, 0.08, 2.4, WOOD_D, -13.6, 0.0, -11.5);
  for (const x of [-15.6, -11.6]) for (const z of [-12.6, -10.4]) block(st, 0.08, 1.0, 0.08, WOOD_D, x, 0, z);
  const crates = L.CRATES.map(([x, z], i) => { const cg = new THREE.Group(); cg.position.set(x, 1.03, z); st.add(cg); block(cg, 1.0, 0.7, 0.9, "#b98b55", 0, 0, 0); block(cg, 1.02, 0.06, 0.92, "#8a6436", 0, 0.32, 0); block(cg, 1.02, 0.06, 0.92, "#8a6436", 0, 0.05, 0); const lid = block(cg, 1.04, 0.06, 0.94, "#a77a45", 0, 0.7, 0); const fill = block(cg, 0.9, 0.02, 0.8, "#5aa8ff", 0, 0.08, 0, { mat: { emissive: "#2a6ad0", emissiveIntensity: 0.5 } }); fill.visible = false; return { cg, lid, fill }; });
  // the storekeeper's stool
  block(st, 0.5, 0.55, 0.5, WOOD, L.STORE.keeper[0], 0, L.STORE.keeper[2] - 0.05);
  nameplate(st, "WORKSPACE", -14.2, 1.9, -8.12, 0, 1.0);

  // ---------- reception (the stage: where the people at the keyboards hand work in) ----------
  const rc = new THREE.Group(); root.add(rc);
  block(rc, 2.8, 1.05, 0.7, "#6d4a8a", -12.4, 0, 9.0); block(rc, 3.0, 0.08, 0.86, WOOD_L, -12.4, 1.05, 9.0);
  block(rc, 0.7, 1.05, 1.8, "#6d4a8a", -10.65, 0, 9.85);
  nameplate(rc, "RECEPTION", -12.4, 0.7, 9.37, 0, 1.0);
  const bell = new THREE.Group(); bell.position.set(...L.STAGE.bell); root.add(bell);
  { const b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(BRASS)); bell.add(b); const k = box(0.03, 0.06, 0.03, "#333"); k.position.y = 0.14; bell.add(k); const base = cyl(0.15, 0.03, "#333"); base.position.y = -0.01; bell.add(base); }
  // the customer window behind reception: a hatch with a lit sign (people hand their typing in here)
  const hatch = new THREE.Group(); hatch.position.set(-15.85, 0, 9.2); root.add(hatch);
  block(hatch, 0.1, 1.2, 1.7, "#3d2a1a", 0, 1.0, 0); const hatchIn = block(hatch, 0.12, 1.0, 1.5, "#ffe7a8", 0.01, 1.1, 0, { mat: { emissive: "#ffcf6a", emissiveIntensity: 0.35 } });
  const people = []; for (let i = 0; i < 3; i++) { const ph = new THREE.Group(); ph.position.set(-0.02, 1.15, -0.5 + i * 0.5); hatch.add(ph); const hd = box(0.04, 0.26, 0.26, "#6a4a3a"); hd.position.y = 0.5; ph.add(hd); const bd = box(0.04, 0.4, 0.36, ["#3c6aa8", "#a83c5a", "#3ca87a"][i]); bd.position.y = 0.17; ph.add(bd); people.push(ph); }
  { const p = plate("PEOPLE AT THE KEYBOARDS", { w: 1.5, h: 0.16, bg: "#ffe7a8", fg: "#4a2a10" }); p.position.set(0.08, 1.95, 0); p.rotation.y = Math.PI / 2; hatch.add(p); }

  // ---------- the wall clock (timers) ----------
  const clk = new THREE.Group(); clk.position.set(...L.CLOCK.at); root.add(clk);
  const face = canvasTex(256, 256, (g) => { g.fillStyle = "#f8f1dc"; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#3a2a1a"; g.lineWidth = 10; g.stroke(); g.fillStyle = "#3a2a1a"; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.fillRect(128 + Math.sin(a) * 100 - 4, 128 - Math.cos(a) * 100 - 10, 8, 20); } });
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.85, 32), new THREE.MeshLambertMaterial({ map: face })); clockFace.position.z = 0.09; clk.add(clockFace);
  const rimC = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.07, 8, 32), mat(WOOD_D)); rimC.position.z = 0.08; clk.add(rimC);
  const back = cyl(0.9, 0.12, WOOD, 24); back.rotation.x = Math.PI / 2; clk.add(back);
  const handM = box(0.06, 0.7, 0.02, "#1b1b1b"); const handMg = new THREE.Group(); handMg.position.z = 0.12; handM.position.y = 0.32; handMg.add(handM); clk.add(handMg);
  const handS = box(0.03, 0.78, 0.02, "#b8322c"); const handSg = new THREE.Group(); handSg.position.z = 0.13; handS.position.y = 0.3; handSg.add(handS); clk.add(handSg);
  const bells = [-0.55, 0.55].map((x) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(BRASS)); b.position.set(x, 0.95, 0.05); clk.add(b); return b; });
  // pendulum box below: swings while the clock runs (the visitor's play/pause)
  const pend = new THREE.Group(); pend.position.set(0, -0.8, 0.12); clk.add(pend); const rod = box(0.04, 0.8, 0.02, BRASS); rod.position.y = -0.4; pend.add(rod); const bob = cyl(0.15, 0.04, BRASS, 16); bob.rotation.x = Math.PI / 2; bob.position.y = -0.82; pend.add(bob);
  const caseB = block(clk, 0.55, 1.15, 0.08, WOOD_D, 0, -2.0, 0.0); caseB.castShadow = false;
  // speed lever: three notches (slow, normal, fast) on the clock case
  const lever = new THREE.Group(); lever.position.set(0.55, -1.0, 0.12); clk.add(lever); const lv = box(0.05, 0.36, 0.05, "#1b1b1b"); lv.position.y = 0.16; lever.add(lv); const lk = box(0.12, 0.12, 0.12, "#c43b2e"); lk.position.y = 0.34; lever.add(lk);
  const leverPlate = plate("½  1  2", { w: 0.42, h: 0.12, bg: "#e9dcb4", font: "bold 60px Georgia, serif" }); leverPlate.position.set(0.55, -0.65, 0.12); clk.add(leverPlate);
  pick.push({ object: clockFace, kind: "clock" }, { object: back, kind: "clock" }, { object: rimC, kind: "clock" }, { object: lk, kind: "lever" }, { object: lv, kind: "lever" }, { object: leverPlate, kind: "lever" });

  // ---------- board wall frame (the canvas texture is placed by main.js) ----------
  const bf = new THREE.Group(); bf.position.set(...L.BOARD.center); root.add(bf);
  { const fr = box(0.12, L.BOARD.h + 0.3, L.BOARD.w + 0.3, "#2a2a2a"); fr.position.x = -0.02; bf.add(fr); block(bf, 0.4, 0.06, L.BOARD.w, "#555", 0.2, -L.BOARD.h / 2 - 0.2, 0); }

  // ---------- update ----------
  // externals' activity from messages
  const llmBusy = []; { let open = null; for (const m of sim.messagesBetween(-1, sim.duration + 1)) { if (m.to === "llm") { open = sim.warp(m.at); } if (m.from === "llm" && m.name.startsWith("done") && open != null) { llmBusy.push([open, sim.flight(m)[0]]); open = null; } } }
  const llmSlips = sim.messagesBetween(-1, sim.duration + 1).filter((m) => m.from === "llm" && m.name === "llm.block.start").map((m) => sim.flight(m)[0]);
  const toolBusy = { terminal: [], python: [] };
  { const open = {}; for (const m of sim.messagesBetween(-1, sim.duration + 1)) { const tk = m.to.startsWith("tools.") ? m.to.slice(6) : m.from.startsWith("tools.") ? m.from.slice(6) : null; if (!tk || !toolBusy[tk]) continue; if (m.to.startsWith("tools.")) open[tk] = sim.warp(m.at); else if (open[tk] != null) { toolBusy[tk].push([open[tk], sim.flight(m)[0]]); open[tk] = null; } } }
  const logArrivals = sim.messagesBetween(-1, sim.duration + 1).filter((m) => m.to === "log").map((m) => sim.warp(m.at));
  const timerRings = sim.messagesBetween(-1, sim.duration + 1).filter((m) => m.from === "timers").map((m) => sim.flight(m)[0]);
  const stageRings = sim.messagesBetween(-1, sim.duration + 1).filter((m) => m.from === "stage").map((m) => sim.flight(m)[0]);
  const within = (spans, s) => spans.some(([a, b]) => s >= a && s <= b);
  const since = (arr, s) => { let best = Infinity; for (const x of arr) if (x <= s && s - x < best) best = s - x; return best; };
  const countBefore = (arr, s) => { let n = 0; for (const x of arr) if (x <= s) n++; return n; };

  function drawScreen(d, lines, on, color) {
    const g = d.screen.userData.ctx; g.fillStyle = on ? "#0f1a14" : "#050505"; g.fillRect(0, 0, 128, 88);
    if (on) { g.fillStyle = color; const n = Math.min(lines, 9); for (let i = 0; i < n; i++) { const w = 30 + ((i * 37 + lines * 13) % 80); g.globalAlpha = i === n - 1 ? 1 : 0.65; g.fillRect(8, 8 + i * 8, w, 4); } g.globalAlpha = 1; }
    d.screen.needsUpdate = true;
  }

  function update(playS, t, amb, ctx) {
    // client desks
    for (const [id, d] of Object.entries(desks)) {
      const a = sim.actor(id); const alive = sim.alive(id, t); const act = sim.activeAt(id, t); const v = alive ? sim.valuesAt(id, t) : {};
      const online = alive && act.includes("online");
      d.shadeM.emissiveIntensity = online ? 1.2 : 0; d.light.intensity = online ? 2.2 : 0;
      d.tray(Array.isArray(v.queue) ? v.queue.length : 0);
      const granted = Array.isArray(v.granted) ? v.granted : [];
      for (const [role, k] of Object.entries(d.keys)) k.visible = granted.includes(role);
      const running = v.running && typeof v.running === "object" ? Object.keys(v.running).length : 0;
      d.cards.forEach((k, i) => (k.visible = i < running));
      d.note.visible = !!v.rejection;
      d.slip.visible = !!(v.awaiting && Object.keys(v.awaiting).length);
      const seq = typeof v.seq === "number" ? v.seq : 0;
      d.ctr.draw(seq);
      const key = `${online}|${seq}`; if (key !== d.lastSeq) { d.lastSeq = key; drawScreen(d, seq % 10 + (seq > 0 ? 1 : 0), online && act.includes("live"), "#7dffb0"); }
      d.scrM.emissiveIntensity = online ? 0.9 : 0;
      if (d.machine) {
        const busy = within(toolBusy[id], playS); const m = d.machine;
        m.gear.rotation.z = busy ? amb * 6 : 0.3; m.crank.rotation.x = busy ? amb * 7 : 0; m.lamp.set(busy);
        m.puffs.forEach((p, i) => { p.visible = busy; const f = (amb * 0.8 + i / 3) % 1; p.position.set(0.22 + Math.sin(i * 3 + amb) * 0.05, 1.5 + f * 0.9, -0.15); p.scale.setScalar(0.14 * (0.6 + f * 1.4)); p.material.opacity = 0.8 * (1 - f); });
      }
    }
    // the exchange
    const hv = sim.valuesAt("host", t); const hact = sim.activeAt("host", t);
    turnCtr.draw(hv.turn || 0);
    const roster = hv.clients ? Object.keys(hv.clients) : [];
    for (const [cid, pg] of Object.entries(pegs)) { const on = roster.includes(cid); pg.material = on ? mat(L.CLIENTS[cid].color, { emissive: L.CLIENTS[cid].color, emissiveIntensity: 0.6 }) : mat("#333"); pg.scale.set(on ? 0.14 : 0.12, on ? 0.14 : 0.12, on ? 0.18 : 0.1); }
    const pending = hv.pending && typeof hv.pending === "object" ? Object.values(hv.pending) : [];
    const onLine = ["connecting", "thinking", "writing", "calling"].some((s) => hact.includes(s));
    for (const cid of jackOrder) { const on = cid === "llm" ? onLine : pending.includes(cid); cords[cid].visible = on; jacks[cid].lamp.set(on); }
    pcards.forEach((k, i) => (k.visible = i < pending.length));
    const steers = Array.isArray(hv.steers) ? hv.steers.length : 0; steerSlips.forEach((s, i) => (s.visible = i < steers));
    const incoming = Array.isArray(hv.incoming) ? hv.incoming.length : 0; spikeNotes.forEach((s, i) => (s.visible = i < incoming));
    const who = hv.stoppedBy || null; flagG.visible = !!who;
    if (who !== flagWho) { flagWho = who; const g = flagTex.userData.ctx; g.fillStyle = "#c8322a"; g.fillRect(0, 0, 128, 64); g.fillStyle = "#fff"; g.font = "bold 26px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(who ? "STOP · " + (L.CLIENTS[who]?.name || who) : "", 64, 33); flagTex.needsUpdate = true; }
    flag.rotation.y = Math.sin(amb * 2.2) * 0.15;
    receiverOnHook.visible = !onLine;
    // the model
    const busy = within(llmBusy, playS);
    reels.forEach((r, i) => (r.rotation.z = busy ? amb * (i ? 3.1 : 2.3) : 0));
    lamps.forEach((l, i) => l.set(busy && Math.sin(amb * (3 + (i % 5)) + i * 1.7) > 0.1));
    eyeM.emissiveIntensity = busy ? 1.2 + Math.sin(amb * 4) * 0.4 : 0.15; oracleLight.intensity = busy ? 6 : 0;
    pupil.position.x = busy ? Math.sin(amb * 1.3) * 0.08 : 0;
    const sl = since(llmSlips, playS); printout.visible = sl < 1.4; if (printout.visible) { printout.position.z = 0.62 + Math.min(1, sl / 0.5) * 0.35; printout.position.y = 0.38 - Math.max(0, sl - 0.5) * 0.2; }
    // the archive
    const nLog = countBefore(logArrivals, playS);
    pileStack(Math.min(10, nLog % 11)); binders.forEach((b, i) => (b.visible = i < Math.floor(nLog / 11)));
    if (nLog !== pageTex.userData.n) { pageTex.userData.n = nLog; const g = pageTex.userData.ctx; g.fillStyle = PAPER; g.fillRect(0, 0, 64, 96); g.fillStyle = "#3a3a6a"; for (let i = 0; i < Math.min(11, (nLog % 11) + 1); i++) g.fillRect(6, 6 + i * 8, 20 + ((i * 29) % 34), 3); pageTex.needsUpdate = true; }
    // the clock: the run's time; the second hand turns once a virtual second
    handSg.rotation.z = -((t % 1000) / 1000) * Math.PI * 2; handMg.rotation.z = -(t / sim.duration) * Math.PI * 2;
    const ring = since(timerRings, playS) < 0.9; bells.forEach((b, i) => (b.rotation.z = ring ? Math.sin(amb * 60 + i) * 0.25 : 0)); clk.position.x = L.CLOCK.at[0] + (ring ? Math.sin(amb * 70) * 0.015 : 0);
    pend.rotation.z = ctx.paused ? 0 : Math.sin(amb * 3.2) * 0.32;
    lever.rotation.z = [0.5, 0, -0.5][ctx.speedIndex ?? 1];
    // reception
    const rang = since(stageRings, playS) < 0.6; bell.rotation.z = rang ? Math.sin(amb * 55) * 0.25 : 0;
    people.forEach((p, i) => (p.position.y = 1.15 + (rang ? Math.abs(Math.sin(amb * 9 + i)) * 0.05 : 0)));
    // storeroom: package downloads (all absent in this run: closed crates)
    sim.actors.filter((a) => a.chart === "package").forEach((a, i) => { const act = sim.activeAt(a.id, t); const c = crates[i]; if (!c) return; const open = act.includes("ready") || act.includes("fetching") || act.includes("downloading"); c.lid.position.y = open ? 0.95 : 0.73; c.lid.rotation.x = open ? -0.6 : 0; c.fill.visible = act.includes("ready"); });
  }

  const stations = { llm: or, stage: rc, hatch, workspaceStore: st, archive: adesk };
  for (const [id, d] of Object.entries(desks)) if (d.machine) stations[`tools.${id}`] = d.machine.m;
  return { root, update, pick, desks, anchors: { jacks, panel, ex }, crates, stations };
}
