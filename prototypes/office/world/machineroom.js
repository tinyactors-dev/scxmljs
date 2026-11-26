// world/machineroom.js: the machine room, a place of its own that a visitor enters from the office to see one
// person's machines (head/head.js's createHead, at its own scale: one head unit is one unit here). It is a
// separate THREE.Scene: nothing of the office is in it and nothing of it is in the office, so neither can show
// through the other. A plank floor (where the head's table legs stand), a panelled round wall, its own lights,
// and the mail pipe: the head's inlet runs back to the wall, where a plate says the mail comes from the office.
// The visitor's way out is the overlay's EXIT control (engine/overlay.js), always on screen, and Escape.
//
// The camera looks at the machines along (0, 0.3, 1), the direction head/head.js fits its layout to (main.js
// roomEntryView frames the whole machine from there); on a narrow screen the field of view widens up to 90 degrees
// (fovFor), so a wide machine is not seen from far away.
//
// Owns: the room's geometry, lights and the camera's bounds in it. Must never know: a system, a chart, the
// office's layout, the app's modes.
import * as THREE from "three";

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
  const wallH = 34;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(ROOM.wallR, ROOM.wallR, wallH, 96, 1, true), new THREE.MeshStandardMaterial({ map: wt, side: THREE.BackSide, roughness: 0.85 }));
  wall.position.y = ROOM.floor + wallH / 2 - 0.05; scene.add(wall);

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

  let mounted = null;
  /** stand a head's group in the room (one at a time), at the centre, facing the entry view */
  function mount(group) { if (mounted === group) return; unmount(); mounted = group; group.position.set(0, 0, 0); group.rotation.set(0, 0, 0); group.scale.setScalar(1); group.visible = true; scene.add(group); }
  function unmount() { if (mounted) scene.remove(mounted); mounted = null; }
  /** keep a camera position inside the room: within camR of the centre, under camTop, over the floor */
  function contain(p) { const h = Math.hypot(p.x, p.z); if (h > ROOM.camR) { p.x *= ROOM.camR / h; p.z *= ROOM.camR / h; } p.y = Math.min(ROOM.camTop, Math.max(ROOM.floor + 0.4, p.y)); return p; }
  function dispose() { unmount(); scene.traverse((o) => { o.geometry?.dispose(); if (o.material) o.material.dispose(); }); for (const t of owned) t.dispose(); }
  return { scene, mount, unmount, contain, dispose, get mounted() { return mounted; } };
}
