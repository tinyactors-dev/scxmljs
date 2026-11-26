// engine/overlay.js: what is drawn over the 3D view, in screen pixels, after the scene: so it is never hidden by
// anything in the room (tubes, people, machines) and always lies inside the viewport.
//   - the iris: a black circle closing on a point and opening again, for going from one place to another;
//   - cards: a paper card (title, a line under it, a body, wrapped) pinned to a point of the world by a thin
//     leader, placed beside the point and kept wholly on screen, with a round red CLOSE stamp at its top-right
//     corner (44 px to hit, it brightens under the pointer);
//   - the exit: a big door-shaped control at the top left with a plaque beside it (whose place this is), shown
//     while the visitor is somewhere they leave by it.
// Hits are tested on the drawn rectangles (hit(x, y)), in CSS pixels, before anything in the 3D view.
//
// Owns: the overlay's layout, drawing and hit rectangles. Must never know: a system, a message's shape, the
// app's modes (the caller says what to show).
import * as THREE from "three";

const PAD = 12;        // a card's least distance from the screen's edges (px)
const STAMP = 44;      // the close stamp's hit square (px)
const RES = 2;         // canvas pixels per CSS pixel (crisp on any screen)

export function createOverlay() {
  let W = innerWidth, H = innerHeight;
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, W, 0, -H, -10, 10);
  const place = (m, x, y, w, h) => { m.position.set(x + w / 2, -(y + h / 2), 0); m.scale.set(w, h, 1); };
  const plane = new THREE.PlaneGeometry(1, 1);
  const texOf = () => { const c = document.createElement("canvas"); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; };
  const quad = (order) => { const m = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: texOf(), transparent: true, depthTest: false, depthWrite: false, toneMapped: false })); m.renderOrder = order; m.visible = false; scene.add(m); return m; };
  const ctxFor = (m, w, h) => { const c = m.material.map.image; if (c.width !== Math.ceil(w * RES) || c.height !== Math.ceil(h * RES)) { c.width = Math.ceil(w * RES); c.height = Math.ceil(h * RES); m.material.map.dispose(); } const g = c.getContext("2d"); g.setTransform(RES, 0, 0, RES, 0, 0); g.clearRect(0, 0, w, h); return g; };
  const round = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  function wrap(g, text, maxW, maxLines) { // words onto lines; a word longer than a line is cut where it must be
    const out = []; let line = "";
    const push = (s) => { out.push(s); return out.length >= maxLines; };
    for (let wd of String(text).split(/\s+/).filter(Boolean)) {
      const t = line ? line + " " + wd : wd;
      if (g.measureText(t).width <= maxW) { line = t; continue; }
      if (line) { if (push(line)) return clip(out, g, maxW); line = ""; }
      while (g.measureText(wd).width > maxW) { let n = wd.length - 1; while (n > 1 && g.measureText(wd.slice(0, n)).width > maxW) n--; if (push(wd.slice(0, n))) return clip(out, g, maxW); wd = wd.slice(n); }
      line = wd;
    }
    if (line) out.push(line);
    return out.slice(0, maxLines);
  }
  function clip(out, g, maxW) { let s = out[out.length - 1]; while (s.length && g.measureText(s + " …").width > maxW) s = s.slice(0, -1); out[out.length - 1] = s + " …"; return out; }

  // ---------------------------------------------------------------- the iris
  const irisM = new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uC: { value: new THREE.Vector2() }, uR: { value: 1e4 }, uRes: { value: new THREE.Vector2(W, H) } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec2 uC; uniform float uR; uniform vec2 uRes; varying vec2 vUv; void main(){ vec2 p = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y); float d = length(p - uC); float a = smoothstep(uR - 3.0, uR + 3.0, d); float rim = smoothstep(uR - 3.0, uR, d) * (1.0 - smoothstep(uR + 2.0, uR + 9.0, d)); vec3 c = mix(vec3(0.03, 0.025, 0.02), vec3(0.79, 0.64, 0.30), rim); gl_FragColor = vec4(c, max(a, rim)); }" });
  const iris = new THREE.Mesh(plane, irisM); iris.renderOrder = 100; iris.visible = false; scene.add(iris);
  /** k: 0 open (nothing drawn) .. 1 closed; (cx, cy) the point it closes on, in px */
  function setIris(k, cx = W / 2, cy = H / 2) {
    const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy)) + 12;
    iris.visible = k > 0.002; irisM.uniforms.uC.value.set(cx, cy); irisM.uniforms.uR.value = (1 - k) * far - (k >= 1 ? 20 : 0); irisM.uniforms.uRes.value.set(W, H); place(iris, 0, 0, W, H);
  }

  // ---------------------------------------------------------------- the card
  const card = quad(50); let cardC = null, cardR = null, cardAt = 0, stampHot = false;
  const leader = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xfbf5e2, transparent: true, opacity: 0.9, depthTest: false })); leader.renderOrder = 49; leader.visible = false; scene.add(leader);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(5, 18), new THREE.MeshBasicMaterial({ color: 0xfbf5e2, depthTest: false, transparent: true })); dot.renderOrder = 49; dot.visible = false; scene.add(dot);
  const cardW = () => Math.min(420, W - 2 * PAD);
  function drawCard() {
    const c = cardC, w = cardW(); const scratch = card.material.map.image.getContext("2d");
    const inner = w - 36; const fonts = { title: "bold 22px 'DejaVu Sans Mono', monospace", sub: "17px Georgia, serif", body: "14px 'DejaVu Sans Mono', monospace" };
    scratch.font = fonts.title; const title = wrap(scratch, c.title, inner - STAMP + 4, 2);
    scratch.font = fonts.sub; const sub = c.sub ? wrap(scratch, c.sub, inner, 3) : [];
    scratch.font = fonts.body; const body = c.body ? wrap(scratch, c.body, inner, 8) : [];
    const h = 20 + title.length * 28 + 4 + sub.length * 22 + (body.length ? 10 + body.length * 19 : 0) + 18;
    const g = ctxFor(card, w, h);
    g.fillStyle = "rgba(0,0,0,0.35)"; round(g, 3, 5, w - 3, h - 5, 10); g.fill(); // its shadow
    g.fillStyle = "#fbf5e2"; round(g, 0, 0, w - 4, h - 6, 10); g.fill();
    g.fillStyle = c.accent || "#888"; round(g, 0, 0, w - 4, 8, 4); g.fill();
    let y = 20; g.textBaseline = "top"; g.fillStyle = "#2b2418"; g.font = fonts.title; for (const s of title) { g.fillText(s, 18, y); y += 28; }
    y += 4; g.fillStyle = "#6b5a3a"; g.font = fonts.sub; for (const s of sub) { g.fillText(s, 18, y); y += 22; }
    if (body.length) { y += 10; g.fillStyle = "#2b2418"; g.font = fonts.body; for (const s of body) { g.fillText(s, 18, y); y += 19; } }
    // the close stamp: a red disc with a white X, at the corner, brighter under the pointer
    const sx = w - 4 - 28, sy = 28, r = stampHot ? 19 : 17;
    g.fillStyle = stampHot ? "#e0392b" : "#b3261e"; g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#fff4e6"; g.lineWidth = stampHot ? 4 : 3.4; g.lineCap = "round"; const q = 7; g.beginPath(); g.moveTo(sx - q, sy - q); g.lineTo(sx + q, sy + q); g.moveTo(sx + q, sy - q); g.lineTo(sx - q, sy + q); g.stroke();
    card.material.map.needsUpdate = true; card.userData.size = [w, h];
  }
  /** show a card: {title, sub, body, accent}; it eases in over 0.2 s of the overlay's clock */
  function openCard(c, now = 0) { cardC = c; cardAt = now; stampHot = false; cardR = null; drawCard(); card.visible = true; }
  function closeCard() { cardC = null; cardR = null; card.visible = false; leader.visible = dot.visible = false; }
  /** pin the open card to a screen point (px; null: it stays where it is, without a leader) */
  function pinCard(anchor, now = 0) {
    if (!cardC) return; const [w, h] = card.userData.size;
    if (anchor) {
      const ax = anchor.x, ay = anchor.y, gap = 26;
      let x = ax + gap, y = ay - h - gap; // above and to the right of the point, else the other side
      if (x + w > W - PAD) x = ax - gap - w; if (y < PAD) y = ay + gap;
      x = Math.min(W - PAD - w, Math.max(PAD, x)); y = Math.min(H - PAD - h, Math.max(PAD, y));
      cardR = { x, y, w, h };
      const inside = ax >= 0 && ax <= W && ay >= 0 && ay <= H;
      if (inside) { const cx = Math.min(x + w, Math.max(x, ax)), cy = Math.min(y + h, Math.max(y, ay)); const p = leader.geometry.attributes.position; p.setXYZ(0, ax, -ay, 0); p.setXYZ(1, cx, -cy, 0); p.needsUpdate = true; leader.visible = Math.hypot(cx - ax, cy - ay) > 4; dot.position.set(ax, -ay, 0); dot.visible = true; }
      else leader.visible = dot.visible = false;
    } else { leader.visible = dot.visible = false; if (!cardR) cardR = { x: (W - w) / 2, y: Math.max(PAD, H * 0.18), w, h }; cardR.x = Math.min(W - PAD - w, Math.max(PAD, cardR.x)); cardR.y = Math.min(H - PAD - h, Math.max(PAD, cardR.y)); }
    const e = Math.min(1, Math.max(0, (now - cardAt) / 0.2)); const k = 0.92 + 0.08 * e;
    place(card, cardR.x + (w * (1 - k)) / 2, cardR.y + (h * (1 - k)) / 2, w * k, h * k); card.material.opacity = e;
  }

  // ---------------------------------------------------------------- the exit and its plaque
  const exitB = quad(60), plaque = quad(60); let exitC = null, exitHot = false, exitR = null, plaqueR = null;
  function drawExit() {
    const w = exitR.w, h = exitR.h, g = ctxFor(exitB, w, h);
    g.fillStyle = exitHot ? "#5a3a22" : "#3b2716"; round(g, 1, 1, w - 2, h - 2, 9); g.fill();
    g.strokeStyle = exitHot ? "#ffd27a" : "#c9a44c"; g.lineWidth = exitHot ? 4 : 3; round(g, 2, 2, w - 4, h - 4, 8); g.stroke();
    // a door standing ajar, an arrow out through it
    const dx = 16, dy = 10, dw = 30, dh = h - 20;
    g.fillStyle = "#1a120b"; g.fillRect(dx, dy, dw, dh); g.fillStyle = exitHot ? "#ffe9b0" : "#f3dfae"; g.fillRect(dx + 2, dy + 2, dw - 4, dh - 2);
    g.fillStyle = "#8a5a32"; g.beginPath(); g.moveTo(dx + dw - 2, dy + 2); g.lineTo(dx + dw - 14, dy + 7); g.lineTo(dx + dw - 14, dy + dh - 3); g.lineTo(dx + dw - 2, dy + dh); g.closePath(); g.fill();
    g.strokeStyle = "#ffd27a"; g.lineWidth = 3; g.lineCap = "round"; g.beginPath(); g.moveTo(dx + 6, dy + dh / 2); g.lineTo(dx - 9, dy + dh / 2); g.moveTo(dx - 3, dy + dh / 2 - 6); g.lineTo(dx - 9, dy + dh / 2); g.lineTo(dx - 3, dy + dh / 2 + 6); g.stroke();
    g.fillStyle = "#f3dfae"; g.textBaseline = "middle"; g.font = "bold 16px Georgia, serif"; g.fillText("BACK TO THE OFFICE", 58, h / 2 - 8);
    g.fillStyle = "#c9a44c"; g.font = "13px 'DejaVu Sans Mono', monospace"; g.fillText("click here, or press Esc", 58, h / 2 + 11);
    exitB.material.map.needsUpdate = true;
  }
  function drawPlaque() {
    const c = exitC, w = plaqueR.w, h = plaqueR.h, g = ctxFor(plaque, w, h);
    g.fillStyle = "rgba(20,14,9,0.82)"; round(g, 0, 0, w, h, 9); g.fill(); g.strokeStyle = "#7a5a32"; g.lineWidth = 2; round(g, 1, 1, w - 2, h - 2, 8); g.stroke();
    let x = 12; if (c.face) { const s = h - 16; g.fillStyle = c.accent || "#5b7bd5"; g.fillRect(x - 2, 6, s + 4, s + 4); try { g.drawImage(c.face, x, 8, s, s); } catch { /* no face */ } x += s + 12; }
    g.textBaseline = "middle"; g.fillStyle = "#f3dfae"; g.font = "bold 16px Georgia, serif"; const t1 = wrap(g, c.title, w - x - 10, 1)[0] || ""; g.fillText(t1, x, h / 2 - 9);
    g.fillStyle = "#c9b48a"; g.font = "13px Georgia, serif"; const t2 = wrap(g, c.sub || "", w - x - 10, 1)[0] || ""; g.fillText(t2, x, h / 2 + 11);
    plaque.material.map.needsUpdate = true;
  }
  function layoutExit() {
    if (!exitC) return; // the exit at the top left, whose place this is just under it
    exitR = { x: PAD + 4, y: PAD + 4, w: Math.min(250, W - 2 * PAD - 8), h: 60 };
    plaqueR = { x: exitR.x, y: exitR.y + exitR.h + 6, w: Math.min(300, W - 2 * PAD - 8), h: 48 };
    drawExit(); drawPlaque(); place(exitB, exitR.x, exitR.y, exitR.w, exitR.h); place(plaque, plaqueR.x, plaqueR.y, plaqueR.w, plaqueR.h);
  }
  /** the exit control and its plaque ({title, sub, face (a canvas), accent}), or null for none */
  function setExit(c) { exitC = c; exitHot = false; exitB.visible = plaque.visible = !!c; if (c) layoutExit(); }

  // ---------------------------------------------------------------- hits, hover, size, drawing
  const inR = (r, x, y) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  /** what of the overlay is at (x, y): "card-close", "card", "exit", or null */
  function hit(x, y) {
    if (cardC && cardR) { const [w] = card.userData.size; if (x >= cardR.x + w - STAMP - 8 && x <= cardR.x + w + 2 && y >= cardR.y - 2 && y <= cardR.y + STAMP + 6) return "card-close"; if (inR(cardR, x, y)) return "card"; }
    if (exitC && inR(exitR, x, y)) return "exit";
    return null;
  }
  function hover(x, y) {
    const h = x == null ? null : hit(x, y);
    if ((h === "card-close") !== stampHot && cardC) { stampHot = h === "card-close"; drawCard(); }
    if ((h === "exit") !== exitHot && exitC) { exitHot = h === "exit"; drawExit(); }
    return h;
  }
  function resize(w, h) { W = w; H = h; cam.right = W; cam.bottom = -H; cam.updateProjectionMatrix(); if (cardC) drawCard(); layoutExit(); }
  function render(renderer) {
    if (!iris.visible && !card.visible && !exitB.visible) return;
    const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(scene, cam); renderer.autoClear = ac;
  }
  const r4 = (r) => (r ? [Math.round(r.x), Math.round(r.y), Math.round(r.x + r.w), Math.round(r.y + r.h)] : null);
  return { setIris, openCard, closeCard, pinCard, setExit, hit, hover, resize, render,
    get cardOpen() { return !!cardC; }, rects: () => ({ card: cardC ? r4(cardR) : null, exit: exitC ? r4(exitR) : null }) };
}
