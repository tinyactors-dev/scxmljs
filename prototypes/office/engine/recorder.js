// engine/recorder.js: the FLIGHT RECORDER as a thing in the room: a small orange box on the south
// wall beside the door, one big button and an engraved plate. Pressing it saves this session's log
// (engine/log.js) as a file on the visitor's machine; nothing is sent anywhere, and the plate says
// so. The lamp blinks while the file is made and glows green once it is saved.
//
// Owns: the box, its pick targets ({object, kind: "recorder"}), its blink.
// Must never know: what the log holds, or how the app routes a click (main.js calls press()).
import * as THREE from "three";
import { box, plate } from "../world/kit.js";

const ORANGE = "#e8731f";

export function buildRecorder(scene, plan) {
  const R = plan.room, dr = plan.door;
  const root = new THREE.Group(); root.name = "flight-recorder"; scene.add(root);
  // on the south wall beside the door, at hand height, facing the room: the first thing a visitor passes
  root.position.set(dr.x - (dr.w || 1.3) / 2 - 0.6, 1.55, R.z1 - 0.17); root.rotation.y = Math.PI;
  const body = box(0.42, 0.34, 0.16, ORANGE); body.position.z = 0.08; root.add(body);
  const bezel = box(0.17, 0.17, 0.03, "#2a2a2a"); bezel.position.set(-0.07, -0.02, 0.17); root.add(bezel);
  const capM = new THREE.MeshLambertMaterial({ color: "#c43b2e", emissive: "#5a0d08", emissiveIntensity: 0.4 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.05, 20), capM); cap.rotation.x = Math.PI / 2; cap.position.set(-0.07, -0.02, 0.2); root.add(cap);
  const lampM = new THREE.MeshLambertMaterial({ color: "#3a3a3a", emissive: "#ff9a2a", emissiveIntensity: 0 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), lampM); lamp.position.set(0.12, 0.06, 0.17); root.add(lamp);
  const grill = box(0.1, 0.05, 0.01, "#3a2a1a"); grill.position.set(0.12, -0.06, 0.165); root.add(grill);
  const title = plate("FLIGHT RECORDER", { w: 0.4, h: 0.07, bg: "#1d1d1d", fg: "#ffb35a", border: "#ffb35a" }); title.position.set(0, 0.215, 0.165); root.add(title);
  const note = plate("SAVES A FILE · SENDS NOTHING", { w: 0.42, h: 0.06, bg: "#f6f0de", fg: "#2a1d12", border: "#8a6a22", font: "bold 40px Georgia, serif" }); note.position.set(0, -0.215, 0.165); root.add(note);
  const bracket = box(0.46, 0.04, 0.12, "#3a2a1a"); bracket.position.set(0, -0.19, 0.06); root.add(bracket);
  for (const o of [body, bezel, cap, lamp, grill, title, note]) o.userData.recorder = true;
  let pressedAt = -1e9, savedAt = -1e9, busy = false;
  function press(save) {
    if (busy) return; busy = true; pressedAt = performance.now();
    Promise.resolve().then(save).then(() => { savedAt = performance.now(); }).catch((e) => console.error("flight recorder:", e)).finally(() => { busy = false; });
  }
  function update() {
    const now = performance.now(), k = (now - pressedAt) / 1000;
    cap.position.z = k < 0.25 ? 0.18 : 0.2;
    const saved = (now - savedAt) / 1000;
    if (busy || k < 0.6) { lampM.emissive.set("#ff9a2a"); lampM.emissiveIntensity = Math.sin(now / 70) > 0 ? 1.6 : 0.1; }
    else if (saved < 2.5) { lampM.emissive.set("#5cff7a"); lampM.emissiveIntensity = 1.5 * (1 - saved / 2.5); }
    else lampM.emissiveIntensity = 0;
    lampM.color.set(lampM.emissiveIntensity > 0.2 ? "#fff" : "#3a3a3a");
  }
  const center = () => root.getWorldPosition(new THREE.Vector3());
  return { root, pick: [body, bezel, cap, lamp, grill, title, note].map((object) => ({ object, kind: "recorder" })), press, update, center, box: () => new THREE.Box3().setFromObject(root) };
}
