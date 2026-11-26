// world/tubes.js: the pneumatic post for ANY floor plan, with trunks so 60 desks are not spaghetti.
//   desk mouth -> up to the bay's junction box (y1) -> the bay's trunk up to the manifold (y2) ->
//   the manifold over the hub -> the other bay's trunk -> its junction -> down to the mouth.
//   Within one bay a capsule only goes through the junction. Stations have a trunk of their own.
//   A delayed send coming due pops out of the receiver's desk timer; a self-send loops over the desk;
//   a broadcast is one capsule per receiver; mail for someone who has gone falls out of the empty
//   desk's mouth onto the floor (or, if they never sat anywhere, out of the manifold).
// Capsule colour: a stable hue per event-name family (the part before the first dot), red for
// errors, a small grey bead for log traffic; office.json "capsules": {family: colour} overrides.
// Capsules are one InstancedMesh; the static tubes are one merged mesh plus instanced rings.
import * as THREE from "three";
import { mat, canvasTex, ease, clamp01, hueColor } from "./kit.js";
import { MOUTH } from "./desks.js";

const Y1 = 3.3, Y2 = 3.95;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function family(name) { const n = String(name || ""); if (/(^|\.)error(\.|$)|^error/.test(n)) return "error"; return n.split(/[.\s:/]/)[0] || "message"; }

function roundedPath(P, r = 0.45) {
  const path = new THREE.CurvePath(); let cur = P[0].clone();
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], p = P[i], b = P[i + 1]; const da = p.clone().sub(a), db = b.clone().sub(p);
    if (da.lengthSq() < 1e-6 || db.lengthSq() < 1e-6) continue;
    const ra = Math.min(r, da.length() / 2), rb = Math.min(r, db.length() / 2);
    const s = p.clone().sub(da.normalize().multiplyScalar(ra)), e = p.clone().add(db.normalize().multiplyScalar(rb));
    if (cur.distanceTo(s) > 1e-4) path.add(new THREE.LineCurve3(cur, s));
    path.add(new THREE.QuadraticBezierCurve3(s, p.clone(), e)); cur = e;
  }
  const last = P[P.length - 1]; if (cur.distanceTo(last) > 1e-4) path.add(new THREE.LineCurve3(cur, last));
  if (!path.curves.length) path.add(new THREE.LineCurve3(P[0].clone(), P[0].clone().add(V(0, 0.01, 0))));
  return path;
}
function mergeGeos(geos) {
  let n = 0, ni = 0; for (const g of geos) { n += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = new Uint32Array(ni); let o = 0, oi = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); const I = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()]; for (let i = 0; i < I.length; i++) idx[oi + i] = I[i] + o; o += g.attributes.position.count; oi += I.length; g.dispose(); }
  const m = new THREE.BufferGeometry(); m.setAttribute("position", new THREE.BufferAttribute(pos, 3)); m.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); m.setIndex(new THREE.BufferAttribute(idx, 1)); return m;
}

export function buildTubes(scene, sim, plan, { desks, stations, clockMouth, cfg = {}, people }) {
  const root = new THREE.Group(); scene.add(root);
  const H = V(plan.hubXZ.x, Y2, plan.hubXZ.z);
  const groupById = new Map(plan.groups.map((g) => [g.id, g]));
  const junction = (g) => (g.kind === "hub" ? H.clone() : V(g.x, Y1, g.z - g.d / 2 - 0.3));
  const keyOf = (s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`;

  // ---- static tubes ----
  const segs = []; const rings = [];
  const tube = (pts, r) => { const c = roundedPath(pts.map((p) => p.clone())); segs.push(new THREE.TubeGeometry(c, Math.max(8, Math.ceil(c.getLength() * 3)), r, 8, false)); const L = c.getLength(); for (let d = 0.3; d < L; d += 1.6) rings.push([c.getPointAt(d / L), c.getTangentAt(d / L), r]); };
  const deskUp = (d, g) => { const M = d.mouth; if (g.kind === "hub") return [M, V(M.x, Y2 - 0.5, M.z), H]; const J = junction(g); return [M, V(M.x, Y1, M.z), V(J.x, Y1, M.z), J]; }; // a comb: drop, row header, spine
  const seatGroup = new Map();
  for (const g of plan.groups) {
    const rows = new Map(); // mouth z -> [min x, max x]
    for (let k = 0; k < g.slots; k++) { const s = plan.seats.get(`${g.id}#${k}`); const d = s && desks.desks.get(keyOf(s)); if (!d) continue; seatGroup.set(d.key, g);
      if (g.kind === "hub") { tube(deskUp(d, g), 0.09); continue; }
      const M = d.mouth; tube([M, V(M.x, Y1, M.z)], 0.085); const zk = M.z.toFixed(2); const r = rows.get(zk) || [M.x, M.x]; rows.set(zk, [Math.min(r[0], M.x), Math.max(r[1], M.x)]); }
    if (g.kind === "hub") continue;
    const J = junction(g); let zMax = J.z;
    for (const [zk, [x0, x1]] of rows) { const z = Number(zk); const a = Math.min(x0, J.x) - 0.09, b = Math.max(x1, J.x) + 0.09; if (b - a > 0.2) tube([V(a, Y1, z), V(b, Y1, z)], 0.1); zMax = Math.max(zMax, z); }
    if (zMax - J.z > 0.1) tube([V(J.x, Y1, zMax + 0.1), V(J.x, Y1, J.z)], 0.12);
    tube([J, V(J.x, Y2, J.z), H], 0.15);
  }
  const stUp = (st) => [st.mouth, V(st.mouth.x, Y2, st.mouth.z), H];
  for (const st of stations.list) tube(stUp(st), 0.12);
  const clockUp = [clockMouth, V(clockMouth.x, Y2, clockMouth.z + 0.3), H]; tube(clockUp, 0.1);
  const glass = new THREE.MeshPhongMaterial({ color: "#d9f2ff", transparent: true, opacity: 0.34, shininess: 90, specular: "#ffffff", depthWrite: false });
  const tubesMesh = new THREE.Mesh(mergeGeos(segs), glass); tubesMesh.renderOrder = 2; root.add(tubesMesh);
  const ringGeo = new THREE.TorusGeometry(1, 0.15, 6, 14); const ringsMesh = new THREE.InstancedMesh(ringGeo, mat("#c9a14a"), rings.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), zA = V(0, 0, 1), yA = V(0, 1, 0);
  rings.forEach(([p, tg, r], i) => { q.setFromUnitVectors(zA, tg); sc.setScalar(r + 0.015); m4.compose(p, q, sc); ringsMesh.setMatrixAt(i, m4); }); root.add(ringsMesh);
  // junction boxes and the manifold
  const brass = mat("#c9a14a");
  for (const g of plan.groups) if (g.kind !== "hub") { const J = junction(g); const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.5), brass); b.position.copy(J); root.add(b); }
  const hub = new THREE.Group(); hub.position.copy(H); root.add(hub);
  hub.add(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.5, 16), brass));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.6, 0.25, 16), mat("#a5803a")); cap.position.y = 0.37; hub.add(cap);
  const wheel = new THREE.Group(); wheel.position.y = -0.33; hub.add(wheel); for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.08), mat("#6b4a1f")); sp.rotation.y = (i * Math.PI) / 6; wheel.add(sp); }
  const hubLampM = new THREE.MeshLambertMaterial({ color: "#ffefb0", emissive: "#ffcf6a", emissiveIntensity: 0.2 }); const hubLamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), hubLampM); hubLamp.position.y = -0.45; hub.add(hubLamp);

  // ---- endpoints at a time ----
  const timerKind = (id) => sim.actor(id)?.external && /timer|clock|delay/i.test(`${sim.actor(id).kind} ${id}`);
  function endpoint(id, t) {
    const a = sim.actor(id); if (!a) return null;
    if (a.external) { if (timerKind(id)) return { up: clockUp, mouth: clockMouth, kind: "clock" }; const st = stations.byId.get(id); return st ? { up: stUp(st), mouth: st.mouth, kind: "station" } : { up: [H.clone().add(V(0, -0.3, 0)), H], mouth: H, kind: "none" }; }
    const L = sim.lifetimes(id); let i = L.findIndex(([b, e]) => t >= b - 1e-6 && t < e); let gone = false;
    if (i < 0) { gone = true; i = -1; for (let j = 0; j < L.length; j++) if (L[j][0] <= t) i = j; if (i < 0) i = 0; }
    let seat = plan.seatOfLife(id, i); if (!seat) return { up: [H.clone().add(V(0, -0.3, 0)), H], mouth: H, kind: "none", gone: true };
    if (seat.visitor && seat.parentSeat) seat = seat.parentSeat;
    const d = desks.desks.get(keyOf(seat));
    if (!d) return { up: [H.clone().add(V(0, -0.3, 0)), H], mouth: H, kind: "none", gone };
    const gg = seatGroup.get(d.key);
    return { up: deskUp(d, gg || { kind: "hub" }), mouth: d.mouth, timer: d.timer, kind: "desk", gone, group: gg?.id, key: d.key };
  }

  // ---- flights ----
  const famColor = new Map(); const colorOf = (f) => { if (!famColor.has(f)) famColor.set(f, new THREE.Color(cfg.capsules?.[f] || (f === "error" ? "#ff4b4b" : hueColor(f, 0.7, 0.55)))); return famColor.get(f); };
  const logish = (m, to) => /^log/.test(m.name) || /log|archive|journal/i.test(String(sim.actor(to)?.kind || ""));
  // a self-send that comes due when a desk timer was set for it pops out of that timer
  const dues = new Set(); for (const e of sim.eventsBetween(-1, sim.duration + 1)) if (e.type === "timer" && e.action === "set") dues.add(`${e.actor}@${Math.round(e.due ?? e.t + (e.delay || 0))}`);
  const fromTimer = (m) => m.from === m.to && dues.has(`${m.to}@${Math.round(m.t)}`);
  const flights = [];
  for (const m of sim.messagesBetween(-1, sim.duration + 1)) {
    const [s0, s1] = sim.flight(m);
    for (const to of sim.recipients(m)) {
      const fam = family(m.name);
      flights.push({ m, to, s0, s1, fam, color: colorOf(fam), dim: logish(m, to), dead: !sim.actor(to)?.external && !sim.alive(to, m.at), route: null });
    }
  }
  flights.sort((a, b) => a.s0 - b.s0);
  const maxFlight = flights.reduce((x, f) => Math.max(x, f.s1 - f.s0), 1.2) + 3.5;
  function routeOf(f) {
    if (f.route) return f.route;
    const A = endpoint(f.m.from, f.m.at), B = endpoint(f.to, f.m.at);
    let pts;
    if (!A || !B) pts = [H, H.clone().add(V(0, -1, 0))];
    else if ((timerKind(f.m.from) || fromTimer(f.m)) && B.kind === "desk" && B.timer) { const T = B.timer.getWorldPosition(new THREE.Vector3()).add(V(0, 0.2, 0)); pts = [T, T.clone().add(V(0, 0.5, 0)), B.mouth.clone().add(V(0, 0.3, 0)), B.mouth.clone().add(V(0, -0.36, 0))]; }
    else if (f.m.from === f.to && A.kind === "desk") { const M = A.mouth; pts = [M, V(M.x, M.y + 1.1, M.z), V(M.x + 0.6, M.y + 1.3, M.z), V(M.x + 0.6, M.y + 0.4, M.z), M.clone().add(V(0, 0.05, 0))]; }
    else if (A.kind === "desk" && B.kind === "desk" && A.group && A.group === B.group && A.group !== "hub") pts = [...A.up, ...B.up.slice(0, -1).reverse()];
    else { const a = A.up, b = B.up; pts = [...a, ...b.slice(0, -1).reverse()]; }
    f.route = roundedPath(pts.map((p) => p.clone())); f.dropAt = B ? B.mouth.clone() : H.clone();
    return f.route;
  }

  // ---- capsules: one instanced mesh ----
  const MAX = 600;
  const capGeo = new THREE.CapsuleGeometry(1, 2.2, 3, 8);
  const capMat = new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#222222" });
  const caps = new THREE.InstancedMesh(capGeo, capMat, MAX); caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage); caps.count = 0; caps.frustumCulled = false; root.add(caps);
  caps.setColorAt(0, new THREE.Color()); caps.instanceColor.setUsage(THREE.DynamicDrawUsage);
  const active = []; const tmpC = new THREE.Color();
  // resting: the last capsule each desk/station received lies in its basket
  const restKey = (f) => { const e = endpoint(f.to, f.m.at); return e ? (e.key || f.to) : f.to; };
  let lo = 0;
  function update(s, highlight) {
    active.length = 0; let n = 0, traffic = 0;
    const place = (f, p, tg, scale, resting) => { if (n >= MAX) return; const big = highlight && highlight.has(f.m.id) ? 1.6 : 1; const r = (f.dim ? 0.042 : 0.085) * scale * big; q.setFromUnitVectors(yA, tg || V(1, 0, 0)); sc.set(r, r * (f.dim ? 0.8 : 1), r); m4.compose(p, q, sc); caps.setMatrixAt(n, m4); tmpC.copy(f.color); if (f.dim) tmpC.lerp(new THREE.Color("#9aa0aa"), 0.7); caps.setColorAt(n, tmpC); active.push({ f, msg: f.m, pos: p.clone(), resting, index: n }); n++; };
    // flights in the air (a window of the sorted list)
    while (lo > 0 && flights[lo - 1].s0 > s - maxFlight) lo--; while (lo < flights.length && flights[lo].s0 < s - maxFlight) lo++;
    const lastAt = new Map();
    for (let i = 0; i < flights.length; i++) {
      const f = flights[i]; if (f.s0 > s) break;
      if (!f.dim && f.s1 <= s) lastAt.set(restKey(f), f);
      if (i < lo) continue;
      if (s <= f.s1) { const r = routeOf(f); const k = f.s1 > f.s0 ? clamp01((s - f.s0) / (f.s1 - f.s0)) : 1; const u = ease(k) * 0.96 + k * 0.04; const p = r.getPointAt(Math.min(1, u)); if (p.distanceTo(H) < 1.2) traffic++; place(f, p, r.getTangentAt(Math.min(0.999, u)), 1, false); }
      else if (f.dead && s < f.s1 + 2.2) { routeOf(f); const k = clamp01((s - f.s1) / 0.7); const p = f.dropAt.clone(); p.y = Math.max(0.09, p.y - 0.4 - k * k * (p.y - 0.09)); place(f, p, null, 1 - clamp01((s - f.s1 - 1.6) / 0.6), false); }
    }
    for (const [k, f] of lastAt) { if (f.dead || s - f.s1 > 25) continue; const e = endpoint(f.to, f.m.at); if (!e || e.kind === "none" || e.kind === "clock") continue; if (e.kind === "desk") { const occ = people.occupantOf(e.key, s); if (!occ || occ.id !== f.to) continue; } const p = e.mouth.clone().add(V(0, -0.36, 0)); place(f, p, null, 1, true); }
    caps.count = n; caps.instanceMatrix.needsUpdate = true; caps.instanceColor.needsUpdate = true; caps.boundingSphere = null; caps.boundingBox = null;
    wheel.rotation.y = s * (traffic ? 6 : 0.4); hubLampM.emissiveIntensity = traffic ? 1.6 : 0.2;
    return active;
  }
  return { root, update, active, caps, flights, endpoint, routeOf, H };
}

// the slip of paper inside a capsule: event name, who to whom, the summary
export function makeSlip() {
  const tex = canvasTex(512, 320, () => {});
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.94), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  m.renderOrder = 5; m.visible = false;
  m.userData.draw = (msg, names, color) => {
    const g = tex.userData.ctx; g.clearRect(0, 0, 512, 320);
    g.fillStyle = "#fbf5e2"; g.beginPath(); g.moveTo(8, 14); g.lineTo(504, 6); g.lineTo(500, 306); g.lineTo(12, 314); g.closePath(); g.fill();
    g.strokeStyle = color || "#888"; g.lineWidth = 10; g.beginPath(); g.moveTo(12, 18); g.lineTo(500, 10); g.stroke();
    g.fillStyle = "#2b2418"; let fs = 40; g.font = `bold ${fs}px 'DejaVu Sans Mono', monospace`; while (g.measureText(msg.name).width > 470 && fs > 18) { fs -= 2; g.font = `bold ${fs}px 'DejaVu Sans Mono', monospace`; } g.fillText(msg.name, 28, 70);
    g.font = "24px Georgia, serif"; g.fillStyle = "#6b5a3a"; g.fillText(`${names(msg.from)}  →  ${names(msg.to)}`.slice(0, 44), 28, 108);
    g.font = "22px 'DejaVu Sans Mono', monospace"; g.fillStyle = "#2b2418";
    const text = summaryText(msg.summary); let line = "", y = 150;
    for (const ch of text) { if (g.measureText(line + ch).width > 456) { const cut = line.lastIndexOf(" "); const keep = cut > 20 ? line.slice(0, cut) : line; g.fillText(keep, 28, y); y += 30; line = (cut > 20 ? line.slice(cut + 1) : "") + ch; if (y > 290) { line = ""; break; } } else line += ch; }
    if (y <= 290 && line) g.fillText(line, 28, y);
    tex.needsUpdate = true;
  };
  return m;
}
function summaryText(s) {
  if (s === undefined || s === null || s === "") return "(no data)";
  if (typeof s !== "string") return flat(s);
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
