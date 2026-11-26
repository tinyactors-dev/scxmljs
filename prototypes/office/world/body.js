// world/body.js: the visitor's own body, styled like the people of the office (block arms, a shirt, skin-coloured
// hands). In first person: two arms at the bottom of the view that swing as the feet walk and poke forward when a
// hand presses something, drawn in a pass of their own after the world (so they never cut into a wall or a desk),
// and a soft shadow blob at the feet in the world. With a free camera (the film, a third-person replay): the whole
// visitor as a block person (world/avatar.js) standing or walking where they are.
//
// Owns: the arms, the blob, the full figure and their motion. Must never know: what was pressed, the rooms, the
// app's modes (the caller says where the walker is and what its hands do).
import * as THREE from "three";
import { makeAvatar, applyPose, POSES } from "./avatar.js";

export const VISITOR_LOOK = { shirt: "#d9822b", pants: "#2f4d7a", skin: "#f0c8a0", hair: "#5a3a22", hairStyle: "short", hat: "cap", hatColor: "#2f6d8a", accessory: null, face: {} };

export function createBody({ look = VISITOR_LOOK } = {}) {
  // ---- the arms (camera space: x right, y up, -z ahead)
  const scene = new THREE.Scene(); scene.name = "first-person-body";
  scene.add(new THREE.HemisphereLight("#fff3dc", "#6b5a48", 1.4));
  const key = new THREE.DirectionalLight("#ffe2b8", 1.2); key.position.set(-0.4, 1, 0.6); scene.add(key);
  const rig = new THREE.Group(); scene.add(rig);
  const shirt = new THREE.MeshLambertMaterial({ color: look.shirt }), skin = new THREE.MeshLambertMaterial({ color: look.skin }), cuff = new THREE.MeshLambertMaterial({ color: new THREE.Color(look.shirt).multiplyScalar(0.8) });
  // an arm: a sleeve from below the view's edge reaching in toward the middle, a cuff, a block hand and its thumb
  const arm = (side) => {
    const sh = new THREE.Group(); rig.add(sh);
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.34), shirt); up.position.z = -0.17; sh.add(up);
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.092, 0.04), cuff); c.position.z = -0.34; sh.add(c);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.09), skin); hand.position.z = -0.4; sh.add(hand);
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.045), skin); thumb.position.set(-side * 0.042, 0.02, -0.39); sh.add(thumb);
    return sh;
  };
  const R = arm(1), L = arm(-1);
  rig.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  let poke = -1, swing = 0, sway = 0;
  /** first-person arms: phase (walk), k (walking 0..1), dt; `press()` starts a poke */
  function update(dt, { phase = 0, k = 0, pitch = 0 } = {}) {
    swing += (k - swing) * Math.min(1, dt * 8);
    const s = Math.sin(phase) * swing, bob = Math.abs(Math.cos(phase)) * swing;
    // the shoulders sit below the view's bottom corners; the hands show at the lower edge, the right one more
    R.position.set(0.36, -0.41 - bob * 0.012, -0.3 + s * 0.04); L.position.set(-0.4, -0.44 - bob * 0.012, -0.3 - s * 0.04);
    R.rotation.set(0.5 - s * 0.1, 0.3, 0); L.rotation.set(0.5 + s * 0.1, -0.3, 0);
    // the arms dip a little when looking down, so the hands do not cover what is right under the eyes
    sway = -Math.min(0, pitch) * 0.08; rig.position.y = -sway;
    if (poke >= 0) { poke += dt; const u = poke / 0.32; if (u >= 1) poke = -1; else { const e = Math.sin(Math.min(1, u) * Math.PI); R.position.z -= 0.16 * e; R.position.y += 0.12 * e; R.position.x -= 0.08 * e; R.rotation.x = 0.5 - 0.4 * e; R.rotation.y = 0.3 - 0.15 * e; } }
  }
  function press() { poke = 0; }
  /** drawn after the world, with the depth cleared, from the camera's lens */
  const lens = new THREE.PerspectiveCamera(60, 1, 0.01, 5);
  function render(renderer, camera) { lens.fov = 60; lens.aspect = camera.aspect; lens.updateProjectionMatrix(); const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(scene, lens); renderer.autoClear = ac; }

  // ---- the shadow blob at the feet (one per scene it is in)
  const blobTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, "rgba(0,0,0,0.5)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const blob = () => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.renderOrder = 2; return m; };

  // ---- the whole figure, for a free camera
  const figure = makeAvatar(look); figure.root.visible = false; figure.root.name = "visitor";
  function pose(p, yaw, { k = 0, phase = 0 } = {}) { figure.root.position.set(p.x, p.y || 0, p.z); figure.root.rotation.y = yaw + Math.PI; applyPose(figure, k > 0.15 ? POSES.walk : POSES.stand, phase / 2.4 / 1.4, 3); } // the avatar faces +z; the walker looks along -z

  return { scene, update, press, render, blob, figure, pose };
}
