// world/tubes.js: the pneumatic post. Every endpoint has a spoke (mouth -> up -> the exchange's
// hub); a message rides spoke(from) + spoke(to). A few pairs have a short tube of their own
// (a client and its tool machine, the floor manager and reception, the storekeeper and the crates).
// A capsule arrives exactly at the message's effective time; its flight is Sim.flight(m).
import * as THREE from "three";
import { mat, canvasTex, ease, clamp01 } from "./kit.js";
import * as L from "./layout.js";

export const KINDS = {
  input:   { color: "#ffc93a", r: 0.1, len: 0.42, label: "typed input" },
  control: { color: "#4aa3ff", r: 0.095, len: 0.38, label: "control" },
  model:   { color: "#b07cff", r: 0.105, len: 0.44, label: "to/from the model" },
  tool:    { color: "#36d17c", r: 0.1, len: 0.42, label: "tool call / result" },
  reject:  { color: "#ff4b4b", r: 0.1, len: 0.4, label: "refusal" },
  timer:   { color: "#ff8a2a", r: 0.095, len: 0.36, label: "timer" },
  note:    { color: "#efe2c0", r: 0.08, len: 0.3, label: "script note" },
  package: { color: "#b98b55", r: 0.06, len: 0.24, label: "package" },
  log:     { color: "#9aa0aa", r: 0.045, len: 0.15, label: "log", dim: true },
};
export function kindOf(m) {
  const n = m.name;
  if (n === "log.batch" || m.to === "log" || n === "snapshot.send") return "log";
  if (/rejected/.test(n)) return "reject";
  if (m.from === "timers") return "timer";
  if (/llm/.test(n)) return "model";
  if (/^(tool\.|run$)/.test(n)) return "tool";
  if (/^(ui\.(submit|steer|interrupt)|input\.(submit|steer|interrupt)|restore)$/.test(n)) return "input";
  if (m.from === "director") return "note";
  if (/^invoke package/.test(n)) return "package";
  return "control";
}

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
function roundedPath(points, r = 0.45) {
  const path = new THREE.CurvePath();
  const P = points.map(V);
  let cur = P[0].clone();
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], p = P[i], b = P[i + 1];
    const da = p.clone().sub(a), db = b.clone().sub(p);
    const ra = Math.min(r, da.length() / 2), rb = Math.min(r, db.length() / 2);
    const s = p.clone().sub(da.normalize().multiplyScalar(ra)), e = p.clone().add(db.normalize().multiplyScalar(rb));
    if (cur.distanceTo(s) > 1e-4) path.add(new THREE.LineCurve3(cur, s));
    path.add(new THREE.QuadraticBezierCurve3(s, p.clone(), e)); cur = e;
  }
  const last = P[P.length - 1]; if (cur.distanceTo(last) > 1e-4) path.add(new THREE.LineCurve3(cur, last));
  return path;
}

export function buildTubes(scene, sim) {
  const root = new THREE.Group(); scene.add(root);
  const Y = L.TUBE_Y, H = L.HUB;
  // endpoints: the spoke from the mouth to the hub
  const spoke = {};
  const up = (m, extra = []) => [m, ...extra, [m[0], Y, m[2]], H];
  for (const id of Object.keys(L.CLIENTS)) spoke[id] = up(L.clientMouth(id));
  spoke.host = [L.HOST.mouth, [L.HOST.mouth[0], Y - 0.6, L.HOST.mouth[2]], H];
  spoke.llm = [L.MODEL.mouth, L.MODEL.port, H];
  spoke.log = up(L.ARCHIVE.mouth);
  spoke.stage = up(L.STAGE.mouth);
  spoke.director = spoke.stage;
  spoke.timers = [L.CLOCK.mouth, [L.CLOCK.mouth[0], Y, L.CLOCK.mouth[2] + 0.4], H];
  spoke.workspace = up(L.STORE.mouth);
  const mouths = {}; for (const [k, s] of Object.entries(spoke)) mouths[k] = V(s[0]);
  // short tubes of their own
  const direct = {};
  for (const id of ["terminal", "python"]) {
    const x = L.CLIENTS[id].x, [mx, , mz] = L.toolMachine(id);
    direct[`${id}|tools.${id}`] = [[x + 1.05, 0.9, L.SEAT_Z + 0.6], [x + 1.3, 1.45, L.SEAT_Z + 0.55], [mx, 1.45, mz], [mx, 1.15, mz]];
    mouths[`tools.${id}`] = V([mx, 1.15, mz]);
  }
  direct["director|stage"] = [[L.DIRECTOR.stand[0] + 0.3, 1.25, L.DIRECTOR.stand[2] - 0.35], [L.DIRECTOR.stand[0] + 0.6, 1.7, L.DIRECTOR.stand[2] - 0.6], [L.STAGE.bell[0], 1.6, L.STAGE.bell[2]], [L.STAGE.bell[0], 1.25, L.STAGE.bell[2]]];
  sim.actors.filter((a) => a.chart === "package").forEach((a, i) => { const [cx, cz] = L.CRATES[i]; direct[`workspace|${a.id}`] = [L.STORE.mouth, [L.STORE.mouth[0], 2.4, L.STORE.mouth[2]], [cx, 2.4, cz], [cx, 1.8, cz]]; mouths[a.id] = V([cx, 1.8, cz]); });

  // the glass tubes
  const glass = new THREE.MeshPhongMaterial({ color: "#d9f2ff", transparent: true, opacity: 0.34, shininess: 90, specular: "#ffffff", depthWrite: false });
  const brass = mat("#c9a14a");
  const drawn = new Set();
  function drawTube(points, radius = 0.13) {
    const key = JSON.stringify(points); if (drawn.has(key)) return; drawn.add(key);
    const curve = roundedPath(points);
    const geo = new THREE.TubeGeometry(curve, Math.max(24, Math.ceil(curve.getLength() * 6)), radius, 10, false);
    const mesh = new THREE.Mesh(geo, glass); mesh.renderOrder = 2; root.add(mesh);
    const len = curve.getLength(); const ringGeo = new THREE.TorusGeometry(radius + 0.012, 0.018, 6, 14);
    for (let d = 0.25; d < len; d += 1.3) { const u = d / len; const p = curve.getPointAt(u), tg = curve.getTangentAt(u); const ring = new THREE.Mesh(ringGeo, brass); ring.position.copy(p); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tg); root.add(ring); }
    // mouth: a brass funnel
    const m0 = V(points[0]); const f = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.07, radius + 0.02, 0.2, 12, 1, true), new THREE.MeshLambertMaterial({ color: "#c9a14a", side: THREE.DoubleSide })); f.position.copy(m0).add(new THREE.Vector3(0, -0.05, 0)); root.add(f);
  }
  for (const s of Object.values(spoke)) drawTube(s);
  // a little wire basket under every mouth: the last capsule that came lies in it
  const basketM = mat("#8d96a3");
  for (const [k, m] of Object.entries(spoke)) { if (k === "director") continue; const p = V(m[0]); const b = new THREE.Group(); b.position.copy(p).add(new THREE.Vector3(0, -0.46, 0)); root.add(b); const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.28), basketM); b.add(base); for (const sz of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.02), basketM); w.position.set(0, 0.05, sz * 0.13); b.add(w); } const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.03), basketM); post.position.set(0, 0.22, -0.13); b.add(post); }
  for (const s of Object.values(direct)) drawTube(s, 0.08);
  // the hub: a brass manifold the spokes meet in, a distributor wheel that spins with traffic
  const hub = new THREE.Group(); hub.position.copy(V(H)); root.add(hub);
  const hubBody = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 16), brass); hub.add(hubBody);
  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.55, 0.25, 16), mat("#a5803a")); hubCap.position.y = 0.37; hub.add(hubCap);
  const wheel = new THREE.Group(); wheel.position.y = -0.33; hub.add(wheel);
  for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.08), mat("#6b4a1f")); sp.rotation.y = (i * Math.PI) / 6; wheel.add(sp); }
  const hubLamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshLambertMaterial({ color: "#ffefb0", emissive: "#ffcf6a", emissiveIntensity: 0.2 })); hubLamp.position.y = -0.45; hub.add(hubLamp);
  // a pipe up from the hub into the ceiling
  const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.6, 10), brass); riser.position.y = 0.7; hub.add(riser);

  // routes
  const routes = new Map();
  function route(from, to) {
    const key = `${from}>${to}`; if (routes.has(key)) return routes.get(key);
    let pts = null;
    if (direct[`${from}|${to}`]) pts = direct[`${from}|${to}`];
    else if (direct[`${to}|${from}`]) pts = direct[`${to}|${from}`].slice().reverse();
    else { const a = spoke[from], b = spoke[to]; if (a && b) pts = a === b ? [a[0], a[1], a[0]] : [...a, ...b.slice(0, -1).reverse()]; }
    const r = pts ? roundedPath(pts) : null; routes.set(key, r); return r;
  }

  // capsules: precompute every message's flight
  const all = sim.messagesBetween(-1, sim.duration + 1).map((m) => { const [s0, s1] = sim.flight(m); return { ...m, s0, s1, kind: kindOf(m) }; }).filter((m) => route(m.from, m.to));
  const byId = new Map(all.map((m) => [m.id, m]));
  const capGeo = new THREE.CylinderGeometry(1, 1, 1, 10); const capEnd = new THREE.SphereGeometry(1, 10, 6);
  const hitGeo = new THREE.SphereGeometry(1, 8, 6); const hitM = new THREE.MeshBasicMaterial({ visible: false });
  const kindMat = {}; for (const [k, v] of Object.entries(KINDS)) kindMat[k] = new THREE.MeshLambertMaterial({ color: v.color, emissive: v.color, emissiveIntensity: v.dim ? 0.05 : 0.35 });
  const bandM = mat("#3a2a10");
  const pool = [];
  function capsule() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(capGeo, kindMat.control); g.add(body);
    const e1 = new THREE.Mesh(capEnd, kindMat.control), e2 = new THREE.Mesh(capEnd, kindMat.control); g.add(e1, e2);
    const band = new THREE.Mesh(capGeo, bandM); g.add(band);
    const hit = new THREE.Mesh(hitGeo, hitM); hit.scale.setScalar(0.32); g.add(hit);
    g.userData = { body, e1, e2, band, hit }; root.add(g); return g;
  }
  function styleCapsule(g, kind, glow) {
    const k = KINDS[kind]; const u = g.userData; const m = kindMat[kind];
    u.body.material = m; u.e1.material = m; u.e2.material = m;
    u.body.scale.set(k.r, k.len, k.r); u.e1.scale.setScalar(k.r); u.e2.scale.setScalar(k.r); u.e1.position.y = k.len / 2; u.e2.position.y = -k.len / 2;
    u.band.scale.set(k.r * 1.06, 0.03, k.r * 1.06); u.band.visible = !k.dim;
    u.hit.visible = true; u.hit.scale.setScalar(k.dim ? 0.18 : 0.3);
    g.scale.setScalar(glow ? 1.6 : 1);
  }
  const yAxis = new THREE.Vector3(0, 1, 0);
  // resting capsules: the last (non-log) message each endpoint received lies in the basket under its mouth
  const restFor = {}; for (const m of all) if (m.kind !== "log") (restFor[m.to] ||= []).push(m);

  const active = []; // {msg, group, pos}
  function update(playS, highlight) {
    let used = 0; active.length = 0;
    const place = (m, pos, tan, glow, resting = false) => { const g = pool[used] || (pool[used] = capsule()); used++; g.visible = true; styleCapsule(g, m.kind, glow); g.position.copy(pos); if (tan) g.quaternion.setFromUnitVectors(yAxis, tan); else g.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2); g.userData.msgId = m.id; active.push({ msg: m, group: g, pos: pos.clone(), resting }); };
    let hubTraffic = 0;
    for (const m of all) {
      if (playS < m.s0 || playS > m.s1) continue;
      const r = route(m.from, m.to); const f = m.s1 > m.s0 ? clamp01((playS - m.s0) / (m.s1 - m.s0)) : 1;
      const u = ease(f) * 0.96 + f * 0.04; const p = r.getPointAt(Math.min(1, u)); const tg = r.getTangentAt(Math.min(0.999, u));
      if (p.distanceTo(hubPos) < 1.0) hubTraffic++;
      place(m, p, tg, highlight && highlight.has(m.id));
    }
    for (const [to, list] of Object.entries(restFor)) {
      let last = null; for (const m of list) { if (m.s1 <= playS) last = m; else break; }
      if (!last || !mouths[to] || to === "host" && false) continue;
      if (playS - last.s1 > 25) continue; // a capsule left too long is filed away
      const p = mouths[to].clone().add(new THREE.Vector3(0.0, spoke[to] && to !== "director" ? -0.36 : -0.3, 0)); place(last, p, null, highlight && highlight.has(last.id), true);
    }
    for (let i = used; i < pool.length; i++) pool[i].visible = false;
    wheel.rotation.y += 0; wheel.rotation.y = playS * (hubTraffic ? 6 : 0.4); hubLamp.material.emissiveIntensity = hubTraffic ? 1.6 : 0.2;
    return active;
  }
  const hubPos = V(H);
  return { root, update, route, byId, all, mouths, active, kindOf };
}

// the slip of paper inside a capsule, drawn on a canvas: event name, who to whom, the summary
export function makeSlip() {
  const tex = canvasTex(512, 320, () => {});
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.94), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: true, side: THREE.DoubleSide }));
  m.renderOrder = 5; m.visible = false;
  m.userData.draw = (msg, names) => {
    const g = tex.userData.ctx; g.clearRect(0, 0, 512, 320);
    g.fillStyle = "#fbf5e2"; g.beginPath(); g.moveTo(8, 14); g.lineTo(504, 6); g.lineTo(500, 306); g.lineTo(12, 314); g.closePath(); g.fill();
    g.strokeStyle = KINDS[msg.kind].color; g.lineWidth = 10; g.beginPath(); g.moveTo(12, 18); g.lineTo(500, 10); g.stroke();
    g.fillStyle = "#2b2418"; g.font = "bold 40px 'DejaVu Sans Mono', monospace"; g.fillText(msg.name, 28, 70);
    g.font = "24px Georgia, serif"; g.fillStyle = "#6b5a3a"; g.fillText(`${names(msg.from)}  →  ${names(msg.to)}`, 28, 108);
    g.font = "22px 'DejaVu Sans Mono', monospace"; g.fillStyle = "#2b2418";
    const text = summaryText(msg.summary); let line = "", y = 150;
    for (const ch of text) { if (g.measureText(line + ch).width > 456) { const cut = line.lastIndexOf(" "); const keep = cut > 20 ? line.slice(0, cut) : line; g.fillText(keep, 28, y); y += 30; line = (cut > 20 ? line.slice(cut + 1) : "") + ch; if (y > 290) { line = ""; break; } } else line += ch; }
    if (y <= 290 && line) g.fillText(line, 28, y);
    tex.needsUpdate = true;
  };
  return m;
}
function summaryText(s) {
  if (!s) return "(no data)";
  try { return flat(JSON.parse(s)); } catch { return String(s).replace(/[{}\[\]"]/g, "").replace(/,/g, " · ").replace(/:/g, ": ").replace(/\\n/g, " "); }
}
function flat(v, d = 0) {
  if (v == null) return String(v);
  if (typeof v === "string") return v.length > 90 ? v.slice(0, 88) + "…" : v;
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return `[${v.slice(0, 3).map((x) => flat(x, d + 1)).join(", ")}${v.length > 3 ? ", …" : ""}]`;
  if (d > 1) return "{…}";
  return Object.entries(v).slice(0, 5).map(([k, x]) => `${k}: ${flat(x, d + 1)}`).join("  ·  ");
}
