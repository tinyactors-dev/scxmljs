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
  else t.anisotropy = 8;
  t.userData.canvas = c; t.userData.ctx = g;
  return t;
}

// a small engraved plate with text: brass or paper. Returns a mesh lying in its local XY plane.
// every plate made, for the flight recorder's view sampler (engine/view.js); detached ones are pruned there
export const PLATES = new Set();
export function plate(text, { w = 0.9, h = 0.22, bg = "#c9a24a", fg = "#3a2a0c", font = "bold 46px Georgia, serif", border = "#8a6a22" } = {}) {
  // drawn once, at a resolution that keeps the letters ~60 % of the plate's height, mipmapped and
  // anisotropic, so it reads crisply near and fades cleanly far (no shimmer)
  let glyph = 0.6;
  const px = 768, py = Math.max(48, Math.round((768 * h) / w)); const bw = Math.max(4, Math.round(py * 0.07));
  const tex = canvasTex(px, py, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, px, py);
    g.strokeStyle = border; g.lineWidth = bw; g.strokeRect(bw / 2, bw / 2, px - bw, py - bw);
    g.fillStyle = fg; g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
    let size = Math.round(py * 0.6);
    while (size > 12) { g.font = font.replace(/\d+px/, size + "px"); if (g.measureText(text).width < px - 3 * bw - 16) break; size -= 2; }
    g.fillText(text, px / 2, py / 2 + 2); glyph = size / py; // the font size that fitted, as a share of the plate (head/inspect counts the same way)
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
  m.userData.plate = { text, glyph }; PLATES.add(m); // log: the view sampler counts readable plates
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

// many static boxes as ONE mesh with vertex colours (furniture, partitions, counters): one draw call
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
export class BoxBatch {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  // a box of size w,h,d whose BOTTOM centre is at x,y,z, rotated ry around y (about the group origin given by ox,oz)
  add(w, h, d, color, x, y, z, ry = 0, ox = 0, oz = 0) {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0);
    _m4.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(0, 0, 0)), _s.set(1, 1, 1));
    if (ry) { const r = new THREE.Matrix4().makeRotationY(ry); const t0 = new THREE.Matrix4().makeTranslation(ox, 0, oz); const t1 = new THREE.Matrix4().makeTranslation(-ox, 0, -oz); _m4.premultiply(t1).premultiply(r).premultiply(t0); }
    g.applyMatrix4(_m4);
    const p = g.attributes.position.array, n = g.attributes.normal.array, idx = g.index.array; _c.set(color);
    for (const i of idx) { this.pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); this.nor.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]); this.col.push(_c.r, _c.g, _c.b); }
    g.dispose(); return this;
  }
  mesh(opts = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = opts.cast !== false; m.receiveShadow = true; return m;
  }
}

// stable colour for a string (capsule families, shirts)
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function hueColor(s, sat = 0.62, light = 0.56) { const h = (hashStr(s) % 360) / 360; return new THREE.Color().setHSL(h, sat, light).getStyle(); }
