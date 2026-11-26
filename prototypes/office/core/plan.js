// core/plan.js: the floor plan for ANY system, from the run alone (pure; no three.js).
//
// Who sits where:
//   - the HUB (the actor that talks to the most distinct partners, when one clearly does) gets the
//     exchange in the middle, where every tube trunk meets;
//   - every other actor belongs to a BAY: one per chart (identical kinds grouped); a bay is a block
//     of cubicles in rows that grows to the most of that chart alive at once;
//   - an INVOKED child (its parent sent it "invoke ...", or the trace marks it invoked) sits in a
//     visitor's chair across its parent's desk; a parent with more than 6 at once gets a bay of
//     its children placed next to its own;
//   - bays are placed greedily around the hub, heavier talkers nearer;
//   - externals become stations on the walls by kind: user input at reception by the door, timers
//     as the wall clock, logs/archives, services/models/invokers/unknown as machines along the
//     north wall ordered by where their partners sit; an external that talks to one actor only
//     stands beside that actor's desk.
// Slots are given out over time: an actor takes the free slot of its bay it had before, else the
// lowest free one; a slot is busy from arrival until the leaver has walked out.
// Everything in metres; y up; north = -z; desks face south (+z), toward the visitor.

export const DESK_W = 3.2, DESK_D = 3.6, VISITOR_D = 1.7, WALK = 3.0, LEAVE = 3.4;
const MAX_SIDE = 6, MAX_COLS = 6;

export function makePlan(sim, cfg = {}) {
  const people = sim.actors.filter((a) => !a.external);
  const exts = sim.actors.filter((a) => a.external);
  const msgs = sim.messagesBetween(-1, sim.duration + 1);
  const W = sim.warp;
  const pairW = new Map(); const key = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
  const partners = new Map();
  for (const m of msgs) { for (const to of sim.recipients(m)) { if (!to || to === m.from) continue; pairW.set(key(m.from, to), (pairW.get(key(m.from, to)) || 0) + 1); (partners.get(m.from) || partners.set(m.from, new Set()).get(m.from)).add(to); (partners.get(to) || partners.set(to, new Set()).get(to)).add(m.from); } }
  const w = (a, b) => pairW.get(key(a, b)) || 0;

  // ---- invoked children ----
  const invokedBy = new Map();
  for (const a of people) {
    if (!a.parent || !sim.actor(a.parent) || a.parent === a.id) continue;
    const viaInvoke = a.invoked || a.invokeid || /invoked by/i.test(a.role || "") || msgs.some((m) => m.from === a.parent && m.to === a.id && /^invoke\b/.test(m.name));
    if (viaInvoke) invokedBy.set(a.id, a.parent);
  }

  // ---- the hub ----
  let hub = cfg.hub ?? null;
  if (hub === null) {
    const ranked = people.map((a) => ({ id: a.id, n: [...(partners.get(a.id) || [])].filter((p) => invokedBy.get(p) !== a.id).length, life: sim.lifetimes(a.id).reduce((s, [b, e]) => s + (Math.min(e, sim.duration) - b), 0) })).sort((x, y) => y.n - x.n);
    if (ranked.length >= 3 && ranked[0].n >= 3 && ranked[0].n >= 1.4 * (ranked[1]?.n || 0) && ranked[0].life > sim.duration * 0.5) hub = ranked[0].id;
  }
  if (hub === false) hub = null;

  // ---- mass ends (a process kill): everyone alive ends at one instant; they vanish, no walk out ----
  const ends = []; for (const a of people) sim.lifetimes(a.id).forEach(([b, e], i) => { if (e !== Infinity) ends.push({ id: a.id, i, s: W(e), t: e }); });
  ends.sort((x, y) => x.s - y.s);
  const killed = new Set(), blackouts = [];
  for (let i = 0; i < ends.length;) { let j = i; while (j < ends.length && ends[j].s - ends[i].s < 0.25) j++; const n = j - i; const aliveThen = people.filter((a) => sim.alive(a.id, ends[i].t - 1e-6)).length; if (n >= 3 && n >= 0.5 * aliveThen) { blackouts.push([ends[i].s, ends[i].s + 1.6]); for (let k = i; k < j; k++) killed.add(`${ends[k].id}#${ends[k].i}`); } i = j; }
  // an end "disposed" (the session was thrown away, not finished) vanishes too
  const endEv = new Map(); for (const e of sim.eventsBetween(-1, sim.duration + 1)) if (e.type === "end") endEv.set(`${e.actor}@${e.at}`, e);
  const reasonOf = (id, i) => { const L = sim.lifetimes(id)[i]; const e = L && endEv.get(`${id}@${L[1]}`); return e ? e.reason || "" : ""; };
  const vanishes = (id, i) => killed.has(`${id}#${i}`) || reasonOf(id, i) === "disposed";
  // ---- occupancy windows (playback seconds) ----
  const windows = (id) => sim.lifetimes(id).map(([b, e], i) => [b <= 0 ? -1 : W(b), e === Infinity ? Infinity : W(e) + (vanishes(id, i) ? 0.5 : LEAVE), b, e]);

  // ---- groups ----
  const groups = new Map(); // id -> {id, kind, chart, members, parent?}
  const groupOf = new Map();
  const addTo = (gid, init, actor) => { if (!groups.has(gid)) groups.set(gid, { id: gid, members: [], ...init }); groups.get(gid).members.push(actor); groupOf.set(actor, gid); };
  if (hub) addTo("hub", { kind: "hub", chart: sim.actor(hub).chart }, hub);
  // children per parent: side seats, or a bay of their own when there are many at once
  const kidsOf = new Map(); for (const [c, p] of invokedBy) (kidsOf.get(p) || kidsOf.set(p, []).get(p)).push(c);
  const sideParents = new Set();
  for (const [p, kids] of kidsOf) {
    const peak = peakConcurrent(kids.flatMap((k) => windows(k)));
    if (peak <= MAX_SIDE) { sideParents.add(p); for (const k of kids) groupOf.set(k, "side:" + p); }
    else for (const k of kids) addTo("kids:" + p, { kind: "bay", chart: sim.actor(k).chart, parent: p }, k);
  }
  for (const a of people) if (!groupOf.has(a.id)) addTo("bay:" + (cfg.groupBy?.[a.id] || a.chart || "?"), { kind: "bay", chart: a.chart }, a.id);

  // ---- slots over time ----
  const slotOf = new Map(); // `${actor}#${lifeIndex}` -> slot index (in its group, or side seat index of the parent)
  const assign = (members, poolKey) => {
    const lives = []; for (const id of members) windows(id).forEach((win, i) => lives.push({ id, i, win }));
    lives.sort((x, y) => x.win[0] - y.win[0] || (x.id < y.id ? -1 : 1));
    const busyUntil = []; const prev = new Map(); let peak = 0; const ident = (id) => sim.actor(id)?.identity || id;
    for (const L of lives) {
      const free = (k) => (busyUntil[k] ?? -Infinity) <= L.win[0];
      let k = prev.has(ident(L.id)) && free(prev.get(ident(L.id))) ? prev.get(ident(L.id)) : -1;
      if (k < 0) { k = 0; while (!free(k)) k++; }
      busyUntil[k] = L.win[1]; prev.set(ident(L.id), k); slotOf.set(`${L.id}#${L.i}`, k); peak = Math.max(peak, k + 1);
    }
    return peak;
  };
  for (const g of groups.values()) { g.slots = assign(g.members, g.id); if (g.kind === "hub") { g.slots = 1; for (const k of slotOf.keys()) if (k.startsWith(hub + "#")) slotOf.set(k, 0); } }
  const sideSlots = new Map(); for (const p of sideParents) sideSlots.set(p, assign(kidsOf.get(p), "side:" + p));

  // externals: attached to one actor's desk, or a station on a wall
  const stations = []; const attached = new Map(); // ext id -> actor id
  const small = cfg.small ?? (people.length <= 2 && !hub);
  for (const x of exts) {
    const ps = [...(partners.get(x.id) || [])].filter((p) => !sim.actor(p)?.external);
    const tot = ps.reduce((s, p) => s + w(x.id, p), 0);
    const top = ps.sort((a, b) => w(x.id, b) - w(x.id, a))[0];
    const kind = classifyExternal(x, cfg);
    if (kind === "bus") continue; // the tubes are the bus
    // a small system (one or two people) is a cosy office: every external it uses but the clock stands
    // at arm's length beside the desk it talks to (the person using it as a control panel, a service
    // as a machine), not on a far wall
    if (small && kind !== "timer" && top && tot > 0 && cfg.attach !== false && !(cfg.stations || []).includes(x.id) && groupOf.get(top) && !String(groupOf.get(top)).startsWith("side:") && ![...attached.values()].includes(top)) { attached.set(x.id, top); continue; }
    if (kind !== "user" && kind !== "timer" && kind !== "log" && top && tot > 0 && w(x.id, top) / tot > 0.9 && top !== hub && !(cfg.stations || []).includes(x.id) && groupOf.get(top) && !String(groupOf.get(top)).startsWith("side:") && cfg.attach !== false) { attached.set(x.id, top); continue; }
    if (!tot && !(cfg.showIdleExternals)) continue; // never used in this run
    stations.push({ id: x.id, kind, label: cfg.names?.[x.id] || x.label || x.id, weight: tot });
  }
  const hasMachine = new Set([...attached.values()]);

  // ---- group footprints ----
  for (const g of groups.values()) {
    if (g.kind === "hub") { g.w = 7.4; g.d = 7.0; continue; }
    const cols = Math.min(MAX_COLS, Math.max(1, g.slots <= MAX_COLS ? g.slots : Math.ceil(Math.sqrt(g.slots * 1.6))));
    const rows = Math.ceil(g.slots / cols);
    const kids = g.members.some((m) => sideParents.has(m));
    const mach = g.members.some((m) => hasMachine.has(m));
    g.cols = cols; g.rows = rows; g.cellW = DESK_W + (mach ? 1.1 : 0); g.cellD = DESK_D + (kids ? VISITOR_D : 0);
    g.w = cols * g.cellW; g.d = rows * g.cellD;
  }

  // ---- placement: hub at the origin, the rest greedily around it ----
  const gw = (g1, g2) => { let s = 0; for (const a of g1.members) for (const b of g2.members) s += w(a, b); if (g1.id === "kids:" + g2.members[0] || g2.id === "kids:" + g1.members[0]) s += 1e6; for (const a of g1.members) if (g2.parent === a) s += 1e6; for (const b of g2.members) if (g1.parent === b) s += 1e6; return s; };
  const order = [...groups.values()].sort((a, b) => (a.kind === "hub" ? -1 : b.kind === "hub" ? 1 : 0) || sumW(b) - sumW(a) || (a.id < b.id ? -1 : 1));
  function sumW(g) { let s = 0; for (const a of g.members) for (const [k, v] of pairW) if (k.split("|").includes(a)) s += v; return s; }
  const placed = [];
  const AISLE = 2.2;
  const overlaps = (x, z, g) => placed.some((p) => Math.abs(x - p.x) * 2 < g.w + p.w + 2 * AISLE && Math.abs(z - p.z) * 2 < g.d + p.d + 2 * AISLE);
  for (const g of order) {
    if (!placed.length) { g.x = 0; g.z = g.kind === "hub" ? 0 : 0; placed.push(g); continue; }
    let best = null;
    for (let r = 0; r < 60 && (!best || r < best.r + 6); r++) {
      const n = Math.max(8, r * 8);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2; const x = Math.round(Math.cos(a) * r * 2) / 2, z = Math.round(Math.sin(a) * r * 1.5) / 2;
        if (overlaps(x, z, g)) continue;
        let score = Math.hypot(x, z * 1.2) * 0.6 + (z < -2 ? 3 : 0); // prefer the south half (nearer the visitor), north is for stations
        for (const p of placed) { const ww = gw(g, p); if (ww) score += Math.min(4, Math.log1p(ww)) * Math.hypot(x - p.x, z - p.z) * 0.35; }
        if (!best || score < best.score) best = { x, z, score, r };
      }
    }
    g.x = best.x; g.z = best.z; placed.push(g);
  }

  // ---- seats ----
  const seats = new Map(); // `${gid}#${k}` -> {x, z, facing, desk:{x,z}}
  for (const g of groups.values()) {
    if (g.kind === "hub") { seats.set(`${g.id}#0`, { x: g.x, z: g.z - 0.2, facing: 0, hub: true }); continue; }
    for (let k = 0; k < g.slots; k++) {
      const c = k % g.cols, r = Math.floor(k / g.cols);
      const x = g.x - g.w / 2 + (c + 0.5) * g.cellW - (g.cellW - DESK_W) / 2;
      const z = g.z - g.d / 2 + r * g.cellD + 1.05;
      seats.set(`${g.id}#${k}`, { x, z, facing: 0, machineX: g.cellW > DESK_W ? x + 1.05 : null });
    }
  }
  const seatOfLife = (id, i) => {
    const gid = groupOf.get(id); if (!gid) return null;
    const k = slotOf.get(`${id}#${i}`) ?? 0;
    if (gid.startsWith("side:")) {
      const p = gid.slice(5); const life = sim.lifetimes(id)[i]; const pLife = parentLifeAt(p, life ? life[0] : 0);
      const ps = seatOfLife(p, pLife); if (!ps) return null;
      const row = Math.floor(k / 3), col = k % 3;
      if (ps.hub) { const a = Math.PI * (0.25 + 0.5 * (k / Math.max(1, sideSlots.get(p) - 1))); return { x: ps.x + Math.cos(a) * 4.2, z: ps.z + Math.sin(a) * 4.2 - 0.6, facing: Math.atan2(-Math.cos(a), -Math.sin(a)), visitor: true, parentSeat: ps, side: k }; }
      return { x: ps.x - 0.75 + col * 0.75, z: ps.z + 2.05 + row * 0.75, facing: Math.PI, visitor: true, parentSeat: ps, side: k };
    }
    return seats.get(`${gid}#${k}`);
  };
  const parentLifeAt = (p, t) => { const L = sim.lifetimes(p); for (let i = 0; i < L.length; i++) if (t >= L[i][0] - 1e-6 && t < L[i][1]) return i; return Math.max(0, L.length - 1); };

  // machines beside their owner's desk
  const machines = []; const usedSpots = new Set();
  for (const [x, owner] of attached) {
    const L = sim.lifetimes(owner); const s = seatOfLife(owner, 0);
    const spot = s ? `${((s.machineX ?? s.x + 1.05)).toFixed(1)},${s.z.toFixed(1)}` : null;
    if (s && usedSpots.has(spot)) { stations.push({ id: x, kind: classifyExternal(sim.actor(x), cfg), label: cfg.names?.[x] || sim.actor(x).label || x, weight: 1 }); continue; }
    if (s) usedSpots.add(spot);
    if (s) machines.push({ id: x, owner, kind: classifyExternal(sim.actor(x), cfg), label: cfg.names?.[x] || sim.actor(x).label || x, x: (s.machineX ?? s.x + 1.05), z: s.z - 0.05, facing: 0, lives: L.length });
  }

  // ---- room ----
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const g of groups.values()) { minX = Math.min(minX, g.x - g.w / 2); maxX = Math.max(maxX, g.x + g.w / 2); minZ = Math.min(minZ, g.z - g.d / 2); maxZ = Math.max(maxZ, g.z + g.d / 2 + (g.kind === "hub" && sideParents.has(hub) ? 2.5 : 0)); }
  if (!Number.isFinite(minX)) { minX = -4; maxX = 4; minZ = -3; maxZ = 3; }
  // stations along the north wall (machines, archives), reception on the west wall, the clock on the north wall
  const north = stations.filter((s) => s.kind !== "user" && s.kind !== "timer");
  const centroidX = (id) => { let sx = 0, sw = 0; for (const [k, v] of pairW) { const [a, b] = k.split("|"); const o = a === id ? b : b === id ? a : null; if (!o) continue; const g = groups.get(groupOf.get(o)); if (g) { sx += g.x * v; sw += v; } } return sw ? sx / sw : 0; };
  north.sort((a, b) => centroidX(a.id) - centroidX(b.id));
  const STW = 4.2;
  let room = small ? { x0: minX - 3.4, x1: maxX + 2.4, z0: minZ - 3.4 - (north.length ? 1.6 : 0), z1: maxZ + 2.6 } : { x0: minX - 6.5, x1: maxX + 4.5, z0: minZ - 5.6, z1: maxZ + 3.0 };
  const MIN_W = small ? 9.5 : 18, MIN_D = small ? 8.5 : 13.5;
  const needW = north.length * STW + 4;
  if (room.x1 - room.x0 < needW) { const extra = (needW - (room.x1 - room.x0)) / 2; room.x0 -= extra; room.x1 += extra; }
  if (room.x1 - room.x0 < MIN_W) { const extra = (MIN_W - (room.x1 - room.x0)) / 2; room.x0 -= extra; room.x1 += extra; }
  if (room.z1 - room.z0 < MIN_D) { const extra = MIN_D - (room.z1 - room.z0); room.z0 -= extra * 0.5; room.z1 += extra * 0.5; }
  const span = room.x1 - room.x0 - 4; const step = north.length ? Math.min(STW + 1.5, span / north.length) : 0;
  north.forEach((s, i) => { s.x = room.x0 + 2 + step * (i + 0.5); s.z = room.z0 + 2.2; s.facing = 0; s.wall = "north"; });
  // keep each north station roughly above its partners when there is room
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < north.length; i++) { const want = Math.max(room.x0 + 2.2, Math.min(room.x1 - 2.2, centroidX(north[i].id))); const lo = i ? north[i - 1].x + STW : room.x0 + 2.2; const hi = i < north.length - 1 ? north[i + 1].x - STW : room.x1 - 2.2; if (lo <= hi) north[i].x = Math.max(lo, Math.min(hi, want)); }
  const door = { x: room.x0, z: room.z1 - (small ? 2.2 : 3.2) };
  const users = stations.filter((s) => s.kind === "user"); users.forEach((s, i) => { s.x = room.x0 + 1.3; s.z = door.z - 2.8 - i * 3.0; s.facing = Math.PI / 2; s.wall = "west"; });
  const clocks = stations.filter((s) => s.kind === "timer"); clocks.forEach((s, i) => { s.x = room.x1 - 3.5 - i * 3; s.z = room.z0 + 0.2; s.wall = "north"; s.clock = true; });
  const clock = clocks.length ? { x: clocks[0].x, z: clocks[0].z } : { x: room.x1 - 3.5, z: room.z0 + 0.2 };
  const westFree0 = room.z0 + 1.2, westFree1 = (users.length ? users[users.length - 1].z - 1.8 : door.z - 1.6);
  const bw = Math.max(3, Math.min(7.2, (westFree1 - westFree0) * 0.95));
  const board = { x: room.x0 + 0.15, z: (westFree0 + westFree1) / 2, w: bw, h: bw * 900 / 1600 };
  const directory = { x: room.x0 + 0.15, z: Math.min(room.z1 - 1.0, door.z + (small ? 1.5 : 1.9)) };
  const hubXZ = groups.get("hub") ? { x: groups.get("hub").x, z: groups.get("hub").z } : { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };

  return {
    hub, groups: [...groups.values()], groupOf: (id) => groupOf.get(id) || null, invokedBy, sideParents, sideSlots,
    seatOf: (id, t) => { const L = sim.lifetimes(id); let i = L.findIndex(([b, e]) => t >= b - 1e-6 && t < e); if (i < 0) { // between lives or after: the last life that began before t
        i = -1; for (let j = 0; j < L.length; j++) if (L[j][0] <= t) i = j; if (i < 0) i = 0; }
      return { ...seatOfLife(id, i), life: i, slot: slotOf.get(`${id}#${i}`) ?? 0, group: groupOf.get(id) }; },
    seatOfLife, slotOf: (id, i) => slotOf.get(`${id}#${i}`), seats,
    stations, machines, attached, room, small, door, board, hubXZ, clock, directory, killed, blackouts, reasonOf, vanishes,
    weight: w, partners: (id) => [...(partners.get(id) || [])],
  };
}

export function classifyExternal(x, cfg = {}) {
  if (cfg.kinds?.[x.id]) return cfg.kinds[x.id];
  const kind = String(x.kind || "").toLowerCase(), words = `${x.id} ${x.label || ""}`.toLowerCase();
  if (/^bus$/.test(x.id) || /\bbus\b/.test(words) && /processor|network|bus/.test(kind)) return "bus";
  if (/\b(model|llm|oracle|claude|gpt)\b/.test(words)) return "model";
  const byKind = { user: "user", timer: "timer", clock: "timer", log: "log", storage: "log", database: "log", model: "model", tools: "tool", tool: "tool", service: "service", processor: "service", app: "service", network: "service", external: "service" };
  if (byKind[kind] === "service" && /\btools?\b|shell|python|exec/.test(words)) return "tool";
  if (byKind[kind]) return byKind[kind];
  if (/user|stage|person|human|keyboard|people|operator/.test(words)) return "user";
  if (/timer|clock|delay/.test(words)) return "timer";
  if (/\blog\b|archive|journal|ledger|storage|database/.test(words)) return "log";
  if (/tool|exec|runtime|shell/.test(words)) return "tool";
  if (/invoke|service|http|api|processor|app/.test(words)) return "service";
  return "unknown";
}

function peakConcurrent(wins) { const ev = []; for (const [a, b] of wins) { ev.push([a, 1]); ev.push([b, -1]); } ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]); let n = 0, m = 0; for (const [, d] of ev) { n += d; m = Math.max(m, n); } return m; }
