// world/machineroom.js: the machine room, a place of its own that a visitor enters from the office to see one
// person's machines (head/head.js's createHead, at its own scale: one head unit is one unit here). It is a
// separate THREE.Scene: nothing of the office is in it and nothing of it is in the office, so neither can show
// through the other. A plank floor (where the head's table legs stand), a panelled round wall, its own lights,
// and the mail pipe: the head's inlet runs back to the wall, where a plate says the mail comes from the office.
// The visitor walks here on foot (engine/player.js) at a scale of their own (`mount(group, s)`: their eye a little
// above the machines), and leaves by a real door in the wall (world/door.js, the same as the office's) with a
// sign over it: walking up to it opens it, walking through it goes back to the office. Escape leaves too. A
// plaque on a post beside where they come in says whose machines these are.
//
// The camera looks at the machines along (0, 0.3, 1), the direction head/head.js fits its layout to (main.js
// roomEntryView frames the whole machine from there); on a narrow screen the field of view widens up to 90 degrees
// (fovFor), so a wide machine is not seen from far away.
//
// Owns: the room's geometry, lights and the camera's bounds in it. Must never know: a system, a chart, the
// office's layout, the app's modes.
import * as THREE from "three";
import { buildDoor } from "./door.js";

export const ROOM = {
  floor: -4.6,          // the head's table legs reach this (head.js ROOM_FLOOR)
  wallR: 23,            // the round wall's radius; the camera stays well inside it
  camR: 20, camTop: 14, // the camera's own bounds: within camR of the centre, below camTop, above the floor
  fov: 42,
  maxDist: 17, minDist: 4, // the orbit's limits round the machines (main.js widens them for a machine framed nearer or farther)
  inlet: [0, 4.3 + 2.4, -4.6], // the top of the head's inlet pipe (head.js INLET, its pipe 2.4 tall)
};
const REF_TAN = Math.tan((ROOM.fov / 2) * Math.PI / 180) * 1.6;
/** the field of view for an aspect: 42 degrees on a landscape screen, wider (up to 90) on a narrow one */
export const fovFor = (aspect) => Math.min(90, Math.max(ROOM.fov, (2 * Math.atan(REF_TAN / aspect) * 180) / Math.PI));

export function createMachineRoom() {
  const scene = new THREE.Scene(); scene.name = "machine-room";
  scene.background = new THREE.Color("#2b211b");
  scene.fog = new THREE.Fog("#2b211b", 34, 60);
  // light: the office's own (sun, sky, fill), warmer and from the front, so the machines look as they do at the desk
  scene.add(new THREE.HemisphereLight("#fff3dc", "#6b5a48", 1.3));
  const key = new THREE.DirectionalLight("#ffe2b8", 1.6); key.position.set(-8, 16, 14); scene.add(key);
  const fill = new THREE.DirectionalLight("#cfe0ff", 0.45); fill.position.set(12, 6, -8); scene.add(fill);
  const lamp = new THREE.PointLight("#ffd89a", 30, 26, 1.6); lamp.position.set(0, 10, 3); scene.add(lamp);
  const owned = [];
  const canvasTex = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; owned.push(t); return t; };

  // the floor: planks, a disc the wall stands round
  const ft = canvasTex(512, 512, (g) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? "#6e4b30" : "#7b5536"; g.fillRect(0, i * 32, 512, 32); g.fillStyle = "#4a301e"; g.fillRect(0, i * 32, 512, 2); g.fillRect(((i * 197) % 400) + 40, i * 32, 2, 32); } });
  ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(6, 6);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ROOM.wallR + 0.5, 72), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = ROOM.floor; scene.add(floor);
  // the wall: wood panelling below, warm plaster above, brass rails; drawn from inside
  const wt = canvasTex(1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#5a4636"); gr.addColorStop(0.55, "#8a6c50"); gr.addColorStop(0.62, "#c9a44c"); gr.addColorStop(0.64, "#5b3a24"); gr.addColorStop(1, "#4a2f1d");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(0,0,0,0.22)"; for (let x = 0; x < w; x += 64) g.fillRect(x, h * 0.64, 3, h * 0.36); // panel joints
    g.fillStyle = "rgba(201,164,76,0.55)"; g.fillRect(0, h * 0.97, w, 4);
  });
  wt.wrapS = THREE.RepeatWrapping; wt.repeat.set(8, 1);
  const wallH = 34, wallM = new THREE.MeshStandardMaterial({ map: wt, side: THREE.BackSide, roughness: 0.85 });
  // the wall is built at mount (doorway): its opening is as wide as the door at the visitor's scale there
  let wall = null, lintel = null;
  // the mail pipe: from the top of the head's inlet back to the wall, where a plate says where the mail comes from
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a44c, roughness: 0.35, metalness: 0.7 });
  const [ix, iy, iz] = ROOM.inlet, wz = -Math.sqrt(ROOM.wallR ** 2 - ix * ix) + 0.15;
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), brass); elbow.position.set(ix, iy, iz); scene.add(elbow);
  const run = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, iz - wz, 14), brass); run.rotation.x = Math.PI / 2; run.position.set(ix, iy, (iz + wz) / 2); scene.add(run);
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 24), brass); flange.rotation.x = Math.PI / 2; flange.position.set(ix, iy, wz + 0.06); scene.add(flange);
  const signTex = canvasTex(1024, 300, (g, w, h) => {
    g.fillStyle = "#c9a44c"; g.fillRect(0, 0, w, h); g.fillStyle = "#3b2a18"; g.fillRect(10, 10, w - 20, h - 20);
    g.fillStyle = "#f3dfae"; g.textAlign = "center"; g.textBaseline = "middle";
    const fit = (text, px, weight = "") => { let f = px; do { g.font = `${weight} ${f}px Georgia, serif`; f -= 2; } while (g.measureText(text).width > w - 80 && f > 20); };
    fit("MAIL FROM THE OFFICE", 96, "700"); g.fillText("MAIL FROM THE OFFICE", w / 2, h * 0.4);
    fit("the office keeps running out there", 52); g.fillText("the office keeps running out there", w / 2, h * 0.76);
  });
  // the sign hangs under the pipe's end on two brass rods, low enough to be seen over the machines from the entry view
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.1), new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false })); sign.position.set(ix, iy - 3.2, wz + 0.1); scene.add(sign);
  for (const sx of [-3, 3]) { const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), brass); rod.position.set(ix + sx, iy - 1.05, wz + 0.1); scene.add(rod); }
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6.4, 8), brass); rail.rotation.z = Math.PI / 2; rail.position.set(ix, iy, wz + 0.1); scene.add(rail);

  // ---- the way out: a real door (world/door.js) in the wall, a short lit passage behind it, a sign over it
  const door = buildDoor({ w: 1.3, h: 2.45, wallT: 0.3, sign: signMesh(["BACK TO THE OFFICE", "walk through · or press Esc"], 2.2, 0.5) });
  scene.add(door.group);
  const passage = new THREE.Group(); door.group.add(passage);
  { const pm = new THREE.MeshLambertMaterial({ color: "#6a4a32", emissive: "#3a2618", side: THREE.BackSide }); const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.1, 4.2), pm); b.position.set(0, 1.55, 2.25); passage.add(b);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.2), new THREE.MeshBasicMaterial({ color: "#ffe9b8", toneMapped: false })); glow.position.set(0, 1.25, 4.3); glow.rotation.y = Math.PI; passage.add(glow);
  }
  // ---- the plaque: whose machines these are, standing on a post beside where the visitor comes in
  const plaque = new THREE.Group(); scene.add(plaque); let plaqueMesh = null;
  function signMesh(lines, w, h, { face = null, accent = null } = {}) {
    const W = 1024, H = Math.round((1024 * h) / w);
    const t = canvasTex(W, H, (g) => {
      g.fillStyle = "#c9a44c"; g.fillRect(0, 0, W, H); g.fillStyle = "#3b2a18"; g.fillRect(8, 8, W - 16, H - 16);
      let x = 40; if (face) { const sz = H - 60; g.fillStyle = accent || "#5b7bd5"; g.fillRect(x - 6, 24, sz + 12, sz + 12); try { g.drawImage(face, x, 30, sz, sz); } catch { /* no face */ } x += sz + 40; }
      g.textBaseline = "middle"; const n = lines.length;
      // the first line big, the rest smaller under it, each shrunk to fit its width (never cut)
      const top = n === 1 ? 0.5 : n === 2 ? 0.36 : 0.3, gap = n <= 2 ? 0.3 : (0.92 - top) / (n - 1) * 0.95;
      const fit = (text, f0, weight) => { let f = f0; for (;;) { g.font = `${weight} ${f}px Georgia, serif`; if (g.measureText(text).width <= W - x - 40 || f <= 10) return f; f -= 2; } };
      const sub = Math.min(...lines.slice(1).map((t) => fit(t, Math.round(H * (n > 2 ? 0.16 : 0.2)), "")), 999); // the lines under the title share one size
      lines.forEach((text, i) => { const f = i ? sub : fit(text, Math.round(H * (n > 2 ? 0.28 : 0.36)), "700"); g.font = `${i ? "" : "700"} ${f}px Georgia, serif`; g.fillStyle = i ? "#e2c98f" : "#f3dfae"; g.fillText(text, x, H * (top + i * gap)); });
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, toneMapped: false })); m.userData.plate = { text: lines.join(" · "), glyph: 0.2 }; return m;
  }
  /** what the plaque says ({title, sub, face (a canvas), accent}) */
  function setPlaque(c) {
    if (plaqueMesh) { plaque.remove(plaqueMesh); plaqueMesh.material.map.dispose(); plaqueMesh = null; }
    plaque.clear(); if (!c) return;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 0.08), brass); post.position.y = 0.575; plaque.add(post);
    plaqueMesh = signMesh([c.title, ...(c.sub || "").split(" · ")], 1.4, 0.62, c); plaqueMesh.position.set(0, 1.3, 0.03); plaqueMesh.rotation.x = -0.3; plaque.add(plaqueMesh);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.66, 0.04), brass); back.position.set(0, 1.3, 0); back.rotation.x = -0.3; plaque.add(back);
  }

  let mounted = null, scale = 1, entry = null, machine = null;
  const DOOR_ANGLE = (125 * Math.PI) / 180; // where the door is in the wall: ahead and to the right of where the visitor comes in
  /** stand a head's group in the room (one at a time), at the centre; `s` is the visitor's scale here (their eye
   *  above the machines), which sizes the door, its opening and the plaque with them */
  function mount(group, s = scale) {
    if (mounted !== group) { unmount(); mounted = group; group.position.set(0, 0, 0); group.rotation.set(0, 0, 0); group.scale.setScalar(1); group.visible = true; scene.add(group); }
    if (s !== scale || !wall) layoutWall(s);
  }
  function layoutWall(s) {
    scale = s; const hw = ((door.w / 2 + 0.1) * s) / ROOM.wallR, top = (door.h + 0.1) * s;
    if (wall) { scene.remove(wall, lintel); wall.geometry.dispose(); lintel.geometry.dispose(); }
    wall = new THREE.Mesh(new THREE.CylinderGeometry(ROOM.wallR, ROOM.wallR, wallH, 96, 1, true, DOOR_ANGLE + hw, 2 * Math.PI - 2 * hw), wallM); wall.position.y = ROOM.floor + wallH / 2 - 0.05;
    lintel = new THREE.Mesh(new THREE.CylinderGeometry(ROOM.wallR, ROOM.wallR, wallH - top, 6, 1, true, DOOR_ANGLE - hw, 2 * hw), wallM); lintel.position.y = ROOM.floor + top + (wallH - top) / 2 - 0.05;
    scene.add(wall, lintel);
    door.group.scale.setScalar(s); door.group.position.set(Math.sin(DOOR_ANGLE) * ROOM.wallR, ROOM.floor, Math.cos(DOOR_ANGLE) * ROOM.wallR); door.group.rotation.y = DOOR_ANGLE;
    plaque.scale.setScalar(s);
  }
  function unmount() { if (mounted) scene.remove(mounted); mounted = null; machine = null; }
  /** the obstacle the machines are (their table and housings), in room units */
  function setMachine(box) { machine = box ? [box.min.clone(), box.max.clone()] : null; }
  /** the visitor comes in here (feet), facing the machines; the plaque stands beside it */
  function setEntry(p, yaw) { entry = { p: p.clone(), yaw }; const side = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)); const ahead = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); plaque.position.copy(p).addScaledVector(side, 1.6 * scale).addScaledVector(ahead, 2.4 * scale); plaque.position.y = ROOM.floor; plaque.rotation.y = yaw + 0.5; }
  const tmpL = new THREE.Vector3();
  /** where p is in the door's frame (x along the wall, z outward from the room's side of the frame) */
  const local = (p) => { const c = Math.cos(DOOR_ANGLE), sn = Math.sin(DOOR_ANGLE); const dx = p.x - door.group.position.x, dz = p.z - door.group.position.z; return tmpL.set((dx * c - dz * sn) / scale, 0, (dx * sn + dz * c) / scale); };
  /** the walker's world here (engine/player.js) */
  const world = {
    floor: ROOM.floor,
    boxes: () => (machine ? [machine] : []),
    limit(p, r) {
      const L = local(p), half = door.w / 2 - r / scale;
      if (door.k > 0.55 && Math.abs(L.x) < half + 0.02 && L.z > -0.9) { // in the doorway, the door open: through it, into the passage
        if (L.z > -0.3) { const x = Math.max(-half, Math.min(half, L.x)), z = Math.min(3.6, L.z); if (x !== L.x || z !== L.z) { const c = Math.cos(DOOR_ANGLE), sn = Math.sin(DOOR_ANGLE); p.x = door.group.position.x + (x * c + z * sn) * scale; p.z = door.group.position.z + (-x * sn + z * c) * scale; } }
        return p;
      }
      const h = Math.hypot(p.x, p.z), lim = ROOM.wallR - r - 0.15 * scale; if (h > lim) { p.x *= lim / h; p.z *= lim / h; }
      return p;
    },
    get rect() { const e = ROOM.wallR + 4 * scale; return { x0: -e, x1: e, z0: -e, z1: e }; },
  };
  /** how far through the door the walker is (door units: 0 at the frame's room face, > 0.6 out in the passage) */
  const through = (p) => local(p).z;
  /** the door's centre on the floor, a point out in the passage, and the point to look at */
  function doorPoints() { const c = door.group.position.clone(); const n = new THREE.Vector3(Math.sin(DOOR_ANGLE), 0, Math.cos(DOOR_ANGLE)); return { c, out: c.clone().addScaledVector(n, 2.2 * scale), look: c.clone().add(new THREE.Vector3(0, 1.4 * scale, 0)), n }; }
  /** keep a camera position inside the room: within camR of the centre, under camTop, over the floor (free camera) */
  function contain(p) { const h = Math.hypot(p.x, p.z); if (h > ROOM.camR) { p.x *= ROOM.camR / h; p.z *= ROOM.camR / h; } p.y = Math.min(ROOM.camTop, Math.max(ROOM.floor + 0.4, p.y)); return p; }
  function dispose() { unmount(); scene.traverse((o) => { o.geometry?.dispose(); if (o.material) o.material.dispose(); }); for (const t of owned) t.dispose(); }
  return { scene, mount, unmount, contain, dispose, door, world, through, doorPoints, setEntry, setMachine, setPlaque, plaque, get entry() { return entry; }, get scale() { return scale; }, get mounted() { return mounted; } };
}
