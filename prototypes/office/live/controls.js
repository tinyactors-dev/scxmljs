// live/controls.js: the physical controls of live mode, as things in the room.
//
//   consoles  a bakelite lectern per place an input enters (a station, a desk), one brass-rimmed
//             push button per control with its engraved label under it. Enabled: a coloured cap
//             standing proud; inert: a grey cap sunk into its bezel. Pressing pushes the cap in.
//   the time console under the wall clock: ADVANCE (to the next due timer), ONE HOP (release
//             one causal hop), and a FLOW/STEP lever; a red flag on the clock and a plate tell
//             what is pending.
//   reset     a big red lever on a post by the door.
// When the room is at rest, the controls that would do something breathe (a slow glow): the only
// idle motion of live mode (`still` turns it off, for tests).
import * as THREE from "three";
import { canvasTex, cyl, mat } from "../world/kit.js";
import { seatPoint } from "../world/desks.js";

const RED = new THREE.Color("#e0321f");
const BAKELITE = "#2a1f1a", BAKELITE_L = "#4a382c", BRASS = "#c9a14a", BRASS_D = "#8a6a22";
const CAPS = ["#d8432f", "#3b9a5a", "#e2b33c", "#3d73c4", "#2fa3a3", "#9a4fb0"];
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const CELL_W = 0.48, CELL_H = 0.42;
const SCALE_DESK = 0.72; // a console beside a desk is smaller than a station's: it must not hide the person
export const SIDE = [-2.05, 0, 2.05], SIDE_TURN = 0.55; // where a desk's console stands, in the seat frame (world/layout.js)

// an engraved label: dark letters cut into brass, on two lines when long; drawn at a resolution
// that keeps the letters crisp at 2 m whatever the plate's size
function labelTex(text, { w = 0.42, h = 0.13, bg = "#d9b866", fg = "#2a1a06" } = {}) {
  const px = Math.min(2048, Math.round(1200 * w)), py = Math.max(24, Math.round((px * h) / w));
  return canvasTex(px, py, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, px, py);
    g.strokeStyle = BRASS_D; g.lineWidth = Math.max(3, py * 0.06); g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, px - g.lineWidth, py - g.lineWidth);
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
    const words = String(text).split(/\s+/).filter(Boolean);
    const fit = (ls, size) => { g.font = `bold ${size}px Georgia, serif`; return ls.every((l) => g.measureText(l).width < px * 0.9) && size * 1.05 * ls.length < py * 0.92; };
    let lines = [words.join(" ")], size = Math.round(py * 0.66);
    while (size > py * 0.4 && !fit(lines, size)) size--;
    if (!fit(lines, size) && words.length > 1) { const k = Math.ceil(words.length / 2); lines = [words.slice(0, k).join(" "), words.slice(k).join(" ")]; size = Math.round(py * 0.42); while (size > 8 && !fit(lines, size)) size--; }
    else while (size > 8 && !fit(lines, size)) size--;
    g.font = `bold ${size}px Georgia, serif`;
    lines.forEach((l, i) => g.fillText(l, px / 2, py / 2 + (i - (lines.length - 1) / 2) * size * 1.05 + size * 0.06));
  });
}
function textPlate(text, w, h, opts) { const t = labelTex(text, { w, h, ...opts }); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: t })); m.userData.tex = t; return m; }

/** One push button: bezel, cap, label. Local frame: the panel's surface is the XY plane, +z out. */
function makeButton(c, color) {
  const g = new THREE.Group();
  const bez = cyl(0.12, 0.04, BRASS, 20); bez.rotation.x = Math.PI / 2; bez.position.set(0, 0.05, 0.02); g.add(bez);
  const well = cyl(0.1, 0.045, "#111", 20); well.rotation.x = Math.PI / 2; well.position.set(0, 0.05, 0.03); g.add(well);
  const capM = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.09, 0.07, 20), capM); cap.rotation.x = Math.PI / 2; cap.position.set(0, 0.05, 0.06); cap.castShadow = true; g.add(cap);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), capM); dome.rotation.x = Math.PI / 2; dome.scale.set(1, 0.35, 1); dome.position.set(0, 0.05, 0.095); g.add(dome);
  const lab = textPlate(c.label, 0.44, 0.13); lab.position.set(0, -0.13, 0.012); g.add(lab);
  // a refusal: the reason replaces the label for a while, white on red (labelTex for the reason is made on demand)
  lab.userData.base = lab.material.map;
  // a hit area bigger than the cap: the cell, so a thumb finds it
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(CELL_W - 0.02, CELL_H - 0.02), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(0, -0.02, 0.1); g.add(hit);
  const capG = [cap, dome];
  return { group: g, hit, capM, capG, color: new THREE.Color(color), grey: new THREE.Color("#5b5650"), labM: lab.material, lab, pressedAt: -1, enabled: null };
}

/** A lever: a slot, an arm with a ball handle. Pulled = rotated toward the visitor. */
function makeLever(c, { color = "#c43b2e", size = 1 } = {}) {
  const g = new THREE.Group();
  // a brass plate with a slot above the engraved label; the arm sticks out of the slot
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.07 * size, 0.2 * size, 0.04), mat("#111")); slot.position.set(0, 0.15 * size, 0.02); g.add(slot);
  const plateB = new THREE.Mesh(new THREE.BoxGeometry(0.18 * size, 0.28 * size, 0.03), mat(BRASS)); plateB.position.set(0, 0.15 * size, 0.0); g.add(plateB);
  const pivot = new THREE.Group(); pivot.position.set(0, 0.15 * size, 0.04); g.add(pivot);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04 * size, 0.36 * size, 0.04 * size), mat("#2b2b2b")); arm.position.y = 0.18 * size; pivot.add(arm);
  const knobM = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0 });
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07 * size, 14, 10), knobM); knob.position.y = 0.38 * size; knob.castShadow = true; pivot.add(knob);
  const lab = textPlate(c.label, 0.44 * Math.max(1, size * 0.8), 0.13 * Math.max(1, size * 0.8)); lab.position.set(0, -0.08 * size, 0.02); g.add(lab);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.4 * size, 0.8 * size, 0.3 * size), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(0, 0.05, 0.1); g.add(hit);
  lab.userData.base = lab.material.map;
  return { group: g, hit, pivot, capM: knobM, capG: [], color: new THREE.Color(color), grey: new THREE.Color("#5b5650"), labM: lab.material, lab, pressedAt: -1, enabled: null, lever: true };
}

/** A lectern holding a grid of controls, facing local +z. Returns its group and each cell's frame. */
function makeConsole(n, { cols = 3, title = null, tilt = 0.75, height = 0.95 } = {}) {
  cols = Math.max(1, Math.min(cols, n));
  const rows = Math.ceil(n / cols);
  const W = cols * CELL_W + 0.12, Hh = rows * CELL_H + (title ? 0.16 : 0) + 0.16;
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.26, height, 0.26), mat(BAKELITE)); post.position.y = height / 2; post.castShadow = true; g.add(post);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.6, W * 0.7), 0.06, 0.55), mat(BAKELITE)); foot.position.y = 0.03; g.add(foot);
  const panel = new THREE.Group(); panel.position.set(0, height, 0.05); panel.rotation.x = -tilt; g.add(panel);
  const board = new THREE.Mesh(new THREE.BoxGeometry(W, Hh, 0.06), mat(BAKELITE_L)); board.position.set(0, Hh / 2 - 0.04, -0.03); board.castShadow = true; panel.add(board);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.03, 0.08), mat(BRASS)); rim.position.set(0, -0.055, -0.01); panel.add(rim);
  let titleMesh = null;
  if (title) { titleMesh = textPlate(title, W - 0.1, 0.12, { bg: "#2a1d12", fg: "#e9c46a" }); titleMesh.position.set(0, Hh - 0.11, 0.005); panel.add(titleMesh); }
  const cells = [];
  for (let i = 0; i < n; i++) { const r = Math.floor(i / cols), c = i % cols; const cell = new THREE.Group(); cell.position.set(-W / 2 + 0.06 + (c + 0.5) * CELL_W, (rows - 1 - r) * CELL_H + 0.2, 0.0); panel.add(cell); cells.push(cell); }
  return { group: g, cells, panel, W, rows, titleMesh };
}

export function createControls({ scene, live, still = false }) {
  const root = new THREE.Group(); root.name = "live-controls"; scene.add(root);
  let world = null;
  const items = new Map(); // control id -> {c, ui}
  let consoles = []; // {key, group}
  let layoutKey = "";
  const fixed = {}; // clock console, reset lever, flag
  const tmp = new THREE.Vector3();

  const disposeTree = (o) => o.traverse((x) => { if (x.geometry && x.geometry !== undefined) x.geometry.dispose?.(); if (x.material && x.material.map) x.material.map.dispose(); });

  // ---- where a control stands ----
  function anchor(at) {
    if (!world) return null;
    const { plan, stations } = world;
    const st = stations.byId.get(at);
    if (st) { const p = st.group.position, ry = st.group.rotation.y; const off = new THREE.Vector3(st.kind === "user" ? 0 : 1.15, 0, st.kind === "user" ? 1.15 : 1.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry); return { x: p.x + off.x, z: p.z + off.z, ry }; }
    const sim = world.sim; const a = sim.actor(at);
    if (a && !a.external) {
      const t = world.t(); const seat = plan.seatOf(at, t);
      if (seat && Number.isFinite(seat.x)) {
        if (seat.hub) return { x: seat.x + 2.6, z: seat.z + 2.6, ry: 0 };
        if (seat.visitor) return { x: seat.x + 0.9, z: seat.z + 0.5, ry: 0 };
        // beside the desk's front corner on the sitter's right (the machine side is their left), past the
        // partition's end, turned toward where a visitor stands in front of the desk: never between them
        const p = seatPoint(seat, SIDE); return { x: p.x, z: p.z, ry: (seat.facing || 0) + SIDE_TURN, desk: true };
      }
    }
    return null;
  }

  function buildButtons(list) {
    // one console per (anchor, group), in order
    for (const k of consoles) { root.remove(k.group); disposeTree(k.group); }
    consoles = []; for (const [, it] of items) if (!it.fixed) items.delete(it.c.id);
    const byKey = new Map();
    // an input that drives one person stands beside that person's desk, whoever sends it
    const placeOf = (c) => (c.event && c.actor && world.sim.actor(c.actor) && !world.sim.actor(c.actor).external && anchor(c.actor) ? c.actor : c.at);
    for (const c of list) { const k = `${placeOf(c)}|${c.console || c.group || ""}`; (byKey.get(k) || byKey.set(k, []).get(k)).push(c); }
    const usedAt = new Map();
    for (const [k, cs] of byKey) {
      const at = placeOf(cs[0]); const a = anchor(at); if (!a) continue;
      const n = usedAt.get(at) || 0; usedAt.set(at, n + 1);
      const deskish = !world.stations.byId.has(at);
      const title = cs[0].title ?? (cs[0].group && cs[0].group !== at ? world.nameOf(cs[0].group) : deskish ? world.nameOf(at) : null);
      const k2 = makeConsole(cs.length, { cols: deskish ? 2 : Math.min(4, Math.ceil(Math.sqrt(cs.length * 2))), title: title ? String(title).toUpperCase() : null, height: a.desk ? 1.05 : 0.95 });
      const sc = a.desk ? SCALE_DESK : 1; k2.group.scale.setScalar(sc);
      // several consoles at one place stand side by side (outward, away from the desk)
      const side = new THREE.Vector3((a.desk ? -1 : n % 2 ? 1 : -1) * (a.desk ? n : Math.ceil(n / 2)) * (k2.W * sc + 0.3), 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), a.ry);
      k2.group.position.set(a.x + side.x, 0, a.z + side.z); k2.group.rotation.y = a.ry; root.add(k2.group);
      cs.forEach((c, i) => {
        const ui = c.kind === "lever" ? makeLever(c) : makeButton(c, c.color || CAPS[hash(c.event || c.label) % CAPS.length]);
        k2.cells[i].add(ui.group); ui.hit.userData.liveControl = c.id;
        items.set(c.id, { c, ui });
      });
      consoles.push({ key: k, group: k2.group, at, desk: !!a.desk, actors: [...new Set(cs.map((c) => c.actor).filter(Boolean))], W: k2.W * sc });
    }
  }

  function buildFixed() {
    for (const f of Object.values(fixed)) if (f && f.group) { root.remove(f.group); disposeTree(f.group); }
    for (const [id, it] of items) if (it.fixed) items.delete(id);
    const { plan } = world;
    const R = plan.room;
    // the time console under the wall clock
    const tc = makeConsole(3, { cols: 3, title: "NO TIMER SET", height: 1.0, tilt: 0.6 }); // its title plate says what is pending
    tc.group.position.set(plan.clock.x, 0, R.z0 + 1.3); root.add(tc.group);
    const timeCs = [
      { id: "time:advance", kind: "button", label: "ADVANCE TIME", color: "#e2b33c", press: () => (live.viewingPast ? live.returnToNow() : live.advance()) },
      { id: "time:hop", kind: "button", label: "ONE HOP", color: "#3d73c4", press: () => live.step() },
      { id: "time:mode", kind: "lever", label: "FLOW · STEP", color: "#3d73c4", press: () => live.setStepping(!live.stepping) },
    ];
    timeCs.forEach((c, i) => { const ui = c.kind === "lever" ? makeLever(c) : makeButton(c, c.color); tc.cells[i].add(ui.group); ui.hit.userData.liveControl = c.id; items.set(c.id, { c, ui, fixed: true }); });
    // what is pending: a plate on the wall under the clock, and a red flag on the clock
    const pend = tc.titleMesh;
    const flag = new THREE.Group(); flag.position.set(plan.clock.x + 0.95, 3.2, R.z0 + 0.3); root.add(flag);
    { const pole = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.7, 0.03), mat("#2b2b2b")); pole.position.y = 0.35; flag.add(pole); const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.02), mat("#d8432f")); cloth.position.set(0.18, 0.58, 0); flag.add(cloth); }
    fixed.time = { group: tc.group }; fixed.pend = { group: pend, w: tc.W - 0.1, last: null }; fixed.flag = { group: flag };
    // the reset lever by the door
    const rs = new THREE.Group(); rs.position.set(plan.door.x + 0.9, 0, plan.door.z - 1.45); rs.rotation.y = Math.PI / 2; root.add(rs);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, 0.3), mat(BAKELITE)); post.position.y = 0.55; rs.add(post);
    const head = new THREE.Group(); head.position.set(0, 1.2, 0.2); rs.add(head);
    const rc = { id: "reset", kind: "lever", label: "START OVER", color: "#c43b2e", press: () => live.reset() };
    const ui = makeLever(rc, { size: 1.6 }); head.add(ui.group); ui.hit.userData.liveControl = rc.id; items.set(rc.id, { c: rc, ui, fixed: true });
    fixed.reset = { group: rs };
  }

  function rebuild(w) {
    world = w;
    buildFixed();
    layoutKey = "";
    sync(true);
  }
  // the controls the driver offers now; rebuild the consoles when the set changes
  function sync(force = false) {
    if (!world) return;
    const list = live.controls();
    const key = list.map((c) => `${c.id}@${c.at}`).join(",") + "|" + list.map((c) => `${c.at}:${JSON.stringify(anchor(c.at))}`).join(",");
    if (force || key !== layoutKey) { layoutKey = key; buildButtons(list); }
    for (const c of list) { const it = items.get(c.id); if (it) it.c = c; }
    // the time console's state
    const timers = live.pendingTimers();
    const tm = (id) => items.get(id);
    if (tm("time:advance")) tm("time:advance").c.enabled = timers.length > 0 && !live.busy && !live.viewingPast;
    if (tm("time:hop")) tm("time:hop").c.enabled = live.stepping && !live.atRest() || live.stepping && live.released() < live.restS() - 0.01;
    if (tm("time:mode")) { tm("time:mode").c.enabled = true; tm("time:mode").c.on = live.stepping; }
    if (tm("reset")) tm("reset").c.enabled = !live.busy;
    if (live.viewingPast && tm("time:advance")) tm("time:advance").c.enabled = true;
    // the plate under the clock
    const txt = live.viewingPast ? "LOOKING BACK: ADVANCE = NOW" : timers.length ? `TIMER DUE IN ${fmt(timers[0].in)}${timers.length > 1 ? ` (+${timers.length - 1})` : ""}` : "NO TIMER SET";
    if (fixed.pend && fixed.pend.last !== txt) { fixed.pend.last = txt; const t = labelTex(txt, { w: fixed.pend.w, h: 0.12, bg: timers.length ? "#f0c45a" : "#2a1d12", fg: timers.length ? "#2a1a06" : "#e9c46a" }); fixed.pend.group.material.map.dispose(); fixed.pend.group.material.map = t; fixed.pend.group.material.needsUpdate = true; }
    if (fixed.flag) fixed.flag.group.visible = timers.length > 0;
  }
  const fmt = (ms) => (ms < 1000 ? `${Math.max(0, Math.round(ms))} MS` : ms < 60000 ? `${+(ms / 1000).toFixed(1)} S` : `${+(ms / 60000).toFixed(1)} MIN`);

  function update(amb) {
    const rest = live.atRest();
    for (const it of items.values()) {
      const { c, ui } = it; const en = !!c.enabled;
      const dp = ui.pressedAt >= 0 ? Math.max(0, 1 - (performance.now() - ui.pressedAt) / 260) : 0;
      if (ui.lever) {
        const base = c.on ? 2.25 : 0.65; // up and out, or thrown down
        ui.pivot.rotation.x = base + (ui.refused ? Math.sin(dp * 40) * 0.03 * dp : dp * 0.8);
        ui.capM.color.copy(en ? ui.color : ui.grey);
      } else {
        // inert: dim and up, and it will not go down (a pressed inert cap only shivers in its bezel)
        const shake = ui.refused ? Math.sin(dp * 40) * 0.006 * dp : 0;
        for (const m of ui.capG) { m.position.z = (m === ui.capG[0] ? 0.06 : 0.095) - (ui.refused ? 0 : dp * 0.03); m.position.x = shake; }
        ui.capM.color.copy(en ? ui.color : ui.grey); ui.capM.emissive.copy(en ? ui.color : ui.grey);
      }
      // a refusal says no on the control itself: the cap flashes red and the plate gives the reason, for 2.6 s
      const no = ui.refused && ui.why && performance.now() - ui.pressedAt < 2600;
      if (no !== !!ui.showingWhy) {
        ui.showingWhy = no;
        if (no) { if (ui.whyTex) ui.whyTex.dispose(); const p = ui.lab.geometry.parameters; ui.whyTex = labelTex(ui.why.toUpperCase(), { w: p.width, h: p.height, bg: "#b3261e", fg: "#fff4e6" }); ui.labM.map = ui.whyTex; }
        else ui.labM.map = ui.lab.userData.base;
        ui.labM.needsUpdate = true;
      }
      if (no) { const k = (performance.now() - ui.pressedAt) / 1000; const f = k < 1.2 ? 0.5 + 0.5 * Math.cos(k * 14) : 0; ui.capM.color.lerp(RED, 0.4 + 0.6 * f); ui.capM.emissive.copy(RED); }
      ui.labM.color.setScalar(no ? 1 : en ? 1 : 0.55);
      const breathe = !still && rest && en && !it.fixed || (!still && rest && en && (c.id === "time:advance"));
      ui.capM.emissiveIntensity = no ? 0.5 : breathe ? 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(amb * 1.9)) : en ? 0.06 : 0;
    }
  }

  function hits() { const out = []; for (const it of items.values()) out.push(it.ui.hit); return out; }
  function pick(raycaster) { const h = raycaster.intersectObjects(hits(), false)[0]; return h ? items.get(h.object.userData.liveControl)?.c || null : null; }
  function screenOf(it, camera, w, h) { it.ui.group.getWorldPosition(tmp); const p = tmp.clone().project(camera); if (p.z > 1) return null; return { x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h }; }
  /** The control nearest to a screen point within `radius` px (for thumbs on small screens). */
  function near(x, y, camera, w, h, radius = 26) { let best = null, bd = radius; for (const it of items.values()) { const s = screenOf(it, camera, w, h); if (!s) continue; const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = it.c; } } return best; }
  /** why a control would not do anything now, in plain words */
  function whyNot(c) {
    if (live.viewingPast && c.id !== "time:advance") return "looking back: press advance";
    if (live.busy) return "busy";
    if (c.event && c.actor && live.whyNot) return live.whyNot(c.actor, c.event);
    if (c.id === "time:advance") return "no timer is due";
    if (c.id === "time:hop") return live.stepping ? "nothing to step" : "only in step mode";
    return "not now";
  }
  /** press a control: true when taken; refused: false, and the control says why (also returned as `why`) */
  function press(id) { const it = items.get(id); if (!it) return false; it.ui.pressedAt = performance.now(); it.ui.refused = !it.c.enabled; if (!it.c.enabled) { it.ui.why = whyNot(it.c); return false; } it.ui.why = null; Promise.resolve(it.c.press()).catch((e) => console.error(e)); return true; }
  const lastWhy = (id) => items.get(id)?.ui.why || null;
  function screenPositions(camera, w, h) { const out = []; for (const it of items.values()) { const s = screenOf(it, camera, w, h); const q = it.ui.group.getWorldQuaternion(new THREE.Quaternion()); const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q); n.y = 0; n.normalize(); out.push({ id: it.c.id, label: it.c.label, at: it.c.at, enabled: !!it.c.enabled, kind: it.c.kind, x: s?.x, y: s?.y, world: it.ui.group.getWorldPosition(new THREE.Vector3()).toArray(), facing: n.toArray() }); } return out; }
  return { root, rebuild, sync, update, pick, near, press, lastWhy, screenPositions, items, anchor, consoles: () => consoles };
}
