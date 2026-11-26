// world/kit.js: blocky building blocks, materials and canvas-drawn textures (no external assets).
import * as THREE from "three";

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!opts.unique && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshLambertMaterial({ color, ...Object.fromEntries(Object.entries(opts).filter(([k]) => k !== "unique")) });
  if (!opts.unique) matCache.set(key, m);
  return m;
}
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
// a box of size (w,h,d) whose position is its centre
export function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(boxGeo, opts.material || mat(color, opts.mat || {}));
  m.scale.set(w, h, d);
  if (opts.cast !== false) m.castShadow = true;
  m.receiveShadow = opts.receive !== false;
  return m;
}
// a box placed with its bottom at y (convenient for furniture)
export function block(parent, w, h, d, color, x, y, z, opts) {
  const m = box(w, h, d, color, opts); m.position.set(x, y + h / 2, z); parent.add(m); return m;
}
export function cyl(r, h, color, seg = 12, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(opts.r2 ?? r, r, h, seg), opts.material || mat(color, opts.mat || {}));
  m.castShadow = opts.cast !== false; m.receiveShadow = true; return m;
}

export function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts.pixel) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  else t.anisotropy = 4;
  t.userData.canvas = c; t.userData.ctx = g;
  return t;
}

// a small engraved plate with text: brass or paper. Returns a mesh lying in its local XY plane.
export function plate(text, { w = 0.9, h = 0.22, bg = "#c9a24a", fg = "#3a2a0c", font = "bold 46px Georgia, serif", border = "#8a6a22" } = {}) {
  const px = 512, py = Math.round((512 * h) / w);
  const tex = canvasTex(px, py, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, px, py);
    g.strokeStyle = border; g.lineWidth = 10; g.strokeRect(5, 5, px - 10, py - 10);
    g.fillStyle = fg; g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
    let size = parseInt(font.match(/(\d+)px/)[1], 10);
    while (size > 12) { g.font = font.replace(/\d+px/, size + "px"); if (g.measureText(text).width < px - 40) break; size -= 2; }
    g.fillText(text, px / 2, py / 2 + 2);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
  return m;
}

// pixel-art face: 16x16 drawn into 64x64
export function faceTex({ skin = "#f0c8a0", eye = "#2b2b38", mouth = "#8a4b3a", closed = false, glasses = false, beard = null, blush = true } = {}) {
  return canvasTex(16, 16, (g) => {
    g.fillStyle = skin; g.fillRect(0, 0, 16, 16);
    if (beard) { g.fillStyle = beard; g.fillRect(2, 11, 12, 5); g.fillRect(1, 8, 2, 5); g.fillRect(13, 8, 2, 5); }
    if (closed) { g.fillStyle = eye; g.fillRect(3, 8, 3, 1); g.fillRect(10, 8, 3, 1); }
    else {
      g.fillStyle = "#ffffff"; g.fillRect(3, 6, 3, 3); g.fillRect(10, 6, 3, 3);
      g.fillStyle = eye; g.fillRect(4, 7, 2, 2); g.fillRect(11, 7, 2, 2);
    }
    if (glasses) { g.strokeStyle = "#222"; g.lineWidth = 1; g.strokeRect(2.5, 5.5, 4, 4); g.strokeRect(9.5, 5.5, 4, 4); g.fillStyle = "#222"; g.fillRect(6, 7, 4, 1); }
    if (blush) { g.fillStyle = "rgba(230,120,110,0.55)"; g.fillRect(2, 10, 2, 1); g.fillRect(12, 10, 2, 1); }
    g.fillStyle = mouth; g.fillRect(6, 12, 4, 1); if (!closed) { g.fillRect(5, 11, 1, 1); g.fillRect(10, 11, 1, 1); }
  }, { pixel: true });
}

// a woven / patterned texture for floors and walls
export function patternTex(draw, size = 128, repeat = [1, 1]) {
  const t = canvasTex(size, size, draw, { pixel: false });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
  return t;
}

export const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, f) => a + (b - a) * f;
// a pseudo-random but deterministic number in [0,1) for an integer seed
export function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
