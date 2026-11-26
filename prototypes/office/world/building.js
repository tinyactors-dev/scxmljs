// world/building.js: the room the plan asks for: floor, walls, door, windows, the wall clock (the
// play control), the board's frame, the directory of systems by the door (switch systems in-world).
import * as THREE from "three";
import { box, block, cyl, mat, plate, canvasTex, patternTex, BoxBatch } from "./kit.js";

const WOOD = "#a8743f", WOOD_D = "#7d5330", WOOD_L = "#c99a62", BRASS = "#c9a14a";
export const WALL_H = 4.6;

export function buildBuilding(scene, plan, { systems = [], current = "" } = {}) {
  const root = new THREE.Group(); scene.add(root);
  const R = plan.room, W = R.x1 - R.x0, D = R.z1 - R.z0, cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
  const pick = [];
  // lawn and path outside
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: "#8fae6a" })); lawn.rotation.x = -Math.PI / 2; lawn.position.y = -0.06; lawn.receiveShadow = true; root.add(lawn);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(W + 5, D + 5), new THREE.MeshLambertMaterial({ color: "#cdbf9f" })); path.rotation.x = -Math.PI / 2; path.position.set(cx, -0.04, cz); path.receiveShadow = true; root.add(path);
  // floor
  const floorTex = patternTex((g, w, h) => { g.fillStyle = "#c79a64"; g.fillRect(0, 0, w, h); for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#bf915a" : "#cfa36c"; g.fillRect(0, i * 16, w, 15); g.fillStyle = "rgba(90,60,30,.25)"; g.fillRect((i * 53) % w, i * 16, 2, 15); g.fillRect((i * 53 + 70) % w, i * 16, 2, 15); } }, 128, [W / 1.9, D / 1.9]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: floorTex })); floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz); floor.receiveShadow = true; root.add(floor);
  pick.push({ object: floor, kind: "floor" });
  // walls: tall north and west (with the door), low south and east (cut away for the visitor)
  const wallTex = patternTex((g, w, h) => { g.fillStyle = "#e9dcc2"; g.fillRect(0, 0, w, h); g.fillStyle = "#e2d2b4"; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 7, h); }, 64, [W, 3]);
  const wallM = new THREE.MeshLambertMaterial({ map: wallTex });
  const wall = (w, h, d, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallM); b.position.set(x, y + h / 2, z); b.receiveShadow = true; b.castShadow = true; root.add(b); return b; };
  const dz = plan.door.z;
  wall(W + 0.3, WALL_H, 0.3, cx, 0, R.z0);
  wall(0.3, WALL_H, dz - 0.9 - R.z0, R.x0, 0, (R.z0 + dz - 0.9) / 2);
  wall(0.3, WALL_H, R.z1 - (dz + 0.9), R.x0, 0, (R.z1 + dz + 0.9) / 2);
  wall(0.3, WALL_H - 2.8, 1.8, R.x0, 2.8, dz);
  const trim = new BoxBatch();
  trim.add(W, 1.0, 0.06, WOOD_D, cx, 0, R.z0 + 0.18).add(0.06, 1.0, D, WOOD_D, R.x0 + 0.18, 0, cz);
  trim.add(W + 0.3, 0.9, 0.3, "#e2d2b4", cx, 0, R.z1).add(0.3, 0.9, D, "#e2d2b4", R.x1, 0, cz);
  trim.add(W + 0.6, 0.08, 0.42, WOOD, cx, 0.9, R.z1).add(0.42, 0.08, D + 0.3, WOOD, R.x1, 0.9, cz);
  trim.add(1.2, 0.02, 1.6, "#3a4a6a", R.x0 + 0.75, 0, dz);
  root.add(trim.mesh());
  const door = block(root, 0.08, 2.75, 1.6, "#6b4a2b", R.x0 + 0.5, 0, dz - 1.25); door.rotation.y = 1.25;
  const occluders = root.children.filter((o) => o.isMesh && o.geometry.type === "BoxGeometry" && o.material === wallM);
  // the ceiling, its beams and lamps, and the upper parts of the south and east walls: shown when the
  // camera is inside the room below the ceiling (eye level), hidden for the high overview
  const inside = new THREE.Group(); root.add(inside);
  { const ceilM = new THREE.MeshLambertMaterial({ color: "#efe6d2", side: THREE.DoubleSide }); const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.3, D + 0.3), ceilM); ceil.rotation.x = Math.PI / 2; ceil.position.set(cx, WALL_H, cz); inside.add(ceil);
    const beams = new BoxBatch(); for (let x = R.x0 + 2.5; x < R.x1 - 1; x += 3.2) beams.add(0.22, 0.3, D, WOOD_D, x, WALL_H - 0.3, cz); beams.add(W, 0.18, 0.18, WOOD_D, cx, WALL_H - 0.18, R.z0 + 0.25).add(0.18, 0.18, D, WOOD_D, R.x0 + 0.25, WALL_H - 0.18, cz);
    const bm = beams.mesh({ cast: false }); bm.receiveShadow = false; inside.add(bm);
    const lampM = new THREE.MeshLambertMaterial({ color: "#fff6dc", emissive: "#fff0c8", emissiveIntensity: 0.9 });
    for (let x = R.x0 + 4.1; x < R.x1 - 1.5; x += 6.4) for (let z = R.z0 + 3; z < R.z1 - 1.5; z += 5) { const l = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.4), lampM); l.position.set(x, WALL_H - 0.36, z); inside.add(l); }
    const upM = new THREE.MeshLambertMaterial({ map: wallTex }); const up = (w, h, d, x, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), upM); b.position.set(x, 0.9 + h / 2, z); inside.add(b); occluders.push(b); };
    up(W + 0.3, WALL_H - 0.9, 0.3, cx, R.z1); up(0.3, WALL_H - 0.9, D, R.x1, cz);
    inside.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } }); }
  // windows high on the north wall, where no station stands below
  const taken = [...plan.stations.filter((s) => s.wall === "north").map((s) => s.x), plan.clock.x, ...(plan.board.wall === "north" ? [plan.board.x - plan.board.w / 2 + 1.3, plan.board.x, plan.board.x + plan.board.w / 2 - 1.3] : [])]; // no window behind a board
  for (let x = R.x0 + 3; x < R.x1 - 2; x += 5.5) { if (taken.some((t) => Math.abs(t - x) < 2.6)) continue; block(root, 2.6, 1.6, 0.1, WOOD_D, x, 2.2, R.z0 + 0.16); const g = block(root, 2.3, 1.3, 0.12, "#bfe3ff", x, 2.35, R.z0 + 0.18, { mat: { emissive: "#6fa6d6", emissiveIntensity: 0.55 } }); g.castShadow = false; }
  // plants in the corners
  const plant = (x, z, s = 1) => { block(root, 0.5 * s, 0.5 * s, 0.5 * s, "#b5643a", x, 0, z); for (let i = 0; i < 5; i++) { const l = box(0.18 * s, 0.6 * s, 0.18 * s, i % 2 ? "#3f8a3e" : "#4fa04a"); l.position.set(x + Math.sin(i * 2.4) * 0.15 * s, 0.75 * s + (i % 3) * 0.12, z + Math.cos(i * 2.4) * 0.15 * s); l.rotation.z = Math.sin(i * 2.4) * 0.5; l.rotation.x = Math.cos(i * 2.4) * 0.5; root.add(l); } };
  plant(R.x1 - 0.8, R.z1 - 0.8, 1.2); plant(R.x1 - 0.8, R.z0 + 0.8, 1.3);

  // ---- the wall clock: the run's time, and the play control (face = pause, lever = speed) ----
  const clk = new THREE.Group(); clk.position.set(plan.clock.x, 3.2, R.z0 + 0.18); root.add(clk);
  const face = canvasTex(256, 256, (g) => { g.fillStyle = "#f8f1dc"; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#3a2a1a"; g.lineWidth = 10; g.stroke(); g.fillStyle = "#3a2a1a"; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.fillRect(128 + Math.sin(a) * 100 - 4, 128 - Math.cos(a) * 100 - 10, 8, 20); } });
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.85, 32), new THREE.MeshLambertMaterial({ map: face })); clockFace.position.z = 0.09; clk.add(clockFace);
  const rimC = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.07, 8, 32), mat(WOOD_D)); rimC.position.z = 0.08; clk.add(rimC);
  const back = cyl(0.9, 0.12, WOOD, 24); back.rotation.x = Math.PI / 2; clk.add(back);
  const handM = box(0.06, 0.7, 0.02, "#1b1b1b"); const handMg = new THREE.Group(); handMg.position.z = 0.12; handM.position.y = 0.32; handMg.add(handM); clk.add(handMg);
  const handS = box(0.03, 0.78, 0.02, "#b8322c"); const handSg = new THREE.Group(); handSg.position.z = 0.13; handS.position.y = 0.3; handSg.add(handS); clk.add(handSg);
  const bells = [-0.55, 0.55].map((x) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(BRASS)); b.position.set(x, 0.95, 0.05); clk.add(b); return b; });
  const pend = new THREE.Group(); pend.position.set(0, -0.8, 0.12); clk.add(pend); { const rod = box(0.04, 0.8, 0.02, BRASS); rod.position.y = -0.4; pend.add(rod); const bob = cyl(0.15, 0.04, BRASS, 16); bob.rotation.x = Math.PI / 2; bob.position.y = -0.82; pend.add(bob); }
  block(clk, 0.55, 1.15, 0.08, WOOD_D, 0, -2.0, 0.0).castShadow = false;
  const lever = new THREE.Group(); lever.position.set(0.55, -1.0, 0.12); clk.add(lever); const lv = box(0.05, 0.36, 0.05, "#1b1b1b"); lv.position.y = 0.16; lever.add(lv); const lk = box(0.12, 0.12, 0.12, "#c43b2e"); lk.position.y = 0.34; lever.add(lk);
  const leverPlate = plate("½  1  2", { w: 0.42, h: 0.12, bg: "#e9dcb4", font: "bold 60px Georgia, serif" }); leverPlate.position.set(0.55, -0.65, 0.12); clk.add(leverPlate);
  { const out = cyl(0.13, 0.12, BRASS, 14); out.position.set(1.25, 2.45 - 3.2, 0.22); clk.add(out); const pipe = box(0.06, 0.06, 0.2, BRASS); pipe.position.set(1.25, 2.45 - 3.2, 0.1); clk.add(pipe); }
  pick.push({ object: clockFace, kind: "clock" }, { object: back, kind: "clock" }, { object: rimC, kind: "clock" }, { object: lk, kind: "lever" }, { object: lv, kind: "lever" }, { object: leverPlate, kind: "lever" });
  const clockMouth = new THREE.Vector3(plan.clock.x + 1.25, 2.45, R.z0 + 0.4); // beside the clock, never across its face

  // ---- the board's frame on the west wall ----
  const bf = new THREE.Group(); bf.position.set(plan.board.x, plan.board.y ?? 2.45, plan.board.z); if (plan.board.wall === "north") bf.rotation.y = -Math.PI / 2; root.add(bf); // its frame faces the room from its wall
  { const fr = box(0.12, plan.board.h + 0.3, plan.board.w + 0.3, "#2a2a2a"); fr.position.x = 0.02; bf.add(fr); block(bf, 0.4, 0.06, plan.board.w, "#555", 0.2, -plan.board.h / 2 - 0.2, 0); }

  // ---- the directory: one brass plate per system, by the door; the lit one is this floor ----
  const dir = new THREE.Group(); dir.position.set(plan.directory.x + 0.08, 1.15, plan.directory.z); dir.rotation.y = Math.PI / 2; root.add(dir);
  const cols = systems.length > 7 ? 2 : 1, rowsN = Math.ceil(Math.max(1, systems.length) / cols);
  const ph = 0.17, gap = 0.05, pw = cols === 2 ? 0.95 : 1.28; const H = rowsN * (ph + gap) + 0.45, Wd = cols * (pw + 0.08) + 0.25;
  block(dir, Wd, H, 0.06, "#3d2a1a", 0, 0, -0.04);
  { const t = plate("DIRECTORY", { w: Math.min(1.2, Wd - 0.2), h: 0.16, bg: "#2a1d12", fg: "#e9c46a", border: "#e9c46a" }); t.position.set(0, H - 0.15, 0.0); dir.add(t); }
  systems.forEach((s, i) => {
    const on = s.id === current; const c = Math.floor(i / rowsN), r = i % rowsN;
    const x = cols === 2 ? (c ? 1 : -1) * (pw / 2 + 0.04) : 0, y = H - 0.4 - r * (ph + gap);
    const p = plate((s.title || s.id).toUpperCase(), { w: pw, h: ph, bg: on ? "#f4d27a" : "#c9a14a", fg: on ? "#3a1a00" : "#3a2a0c", font: "bold 40px Georgia, serif" });
    p.position.set(x, y, 0.01); p.userData.system = s.id; dir.add(p);
    if (on) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshLambertMaterial({ color: "#ffe08a", emissive: "#ffcf6a", emissiveIntensity: 1.2 })); l.position.set(x - pw / 2 - 0.02, y, 0.05); dir.add(l); }
    pick.push({ object: p, kind: "system", id: s.id });
  });
  dir.position.y = Math.max(0.6, Math.min(1.15, WALL_H - 0.4 - H));

  function update(s, t, amb, ctx) {
    if (ctx.camera) { const c = ctx.camera.position; inside.visible = c.y < WALL_H - 0.15 && c.x > R.x0 && c.x < R.x1 && c.z > R.z0 && c.z < R.z1; }
    handSg.rotation.z = -((t % 1000) / 1000) * Math.PI * 2; handMg.rotation.z = -(t / Math.max(1, ctx.duration)) * Math.PI * 2;
    const ring = ctx.clockRing; bells.forEach((b, i) => (b.rotation.z = ring ? Math.sin(amb * 60 + i) * 0.25 : 0));
    pend.rotation.z = ctx.paused ? 0 : Math.sin(amb * 3.2) * 0.32;
    lever.rotation.z = [0.5, 0, -0.5][ctx.speedIndex ?? 1];
  }
  return { root, pick, update, clockMouth, floor, occluders, inside };
}
