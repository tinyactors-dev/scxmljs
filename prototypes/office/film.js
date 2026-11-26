// film.js: a scripted visit to ANY system (record mode), planned from the run and the floor plan:
//   arrive at the overview -> click the floor by the busiest bay and watch people come and go ->
//   follow a capsule from a desk through the trunks, click it and read its slip -> click someone
//   into their head and one machine deeper, back out -> touch the board just before the run's
//   biggest moment (a process kill, else the busiest stretch) -> pull back and watch it happen.
// A pure function of film time F, stepped frame by frame in order; every click goes through the
// page's own api.click at the drawn cursor. office.json "film" may pin {bay, actor, message, seek}.
const FPS = 30;

export function makeFilm({ THREE, api, sim, plan, step, render, setAmb, camera, controls, cfg = {} }) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const hand = document.getElementById("hand"), press = document.getElementById("handPress");
  const W = () => innerWidth, H = () => innerHeight;
  const LOOP = sim.playDuration;
  const pin = cfg.film || {};
  const project = (p) => { if (!p) return null; const q = p.clone().project(camera); return { x: (q.x + 1) / 2 * W(), y: (1 - q.y) / 2 * H() }; };
  const capsulePos = (id) => { const a = api.getActive().find((x) => x.msg.id === id && !x.resting); return a ? a.pos.clone() : null; };
  const board = api.board();
  const boardPoint = (u, v) => V(plan.board.x + 0.11, 2.45 + (0.5 - v) * plan.board.h, plan.board.z - (u - 0.5) * plan.board.w);
  const people = sim.actors.filter((a) => !a.external);
  const WALK = 3.0;

  // ---------------------------------------------------------------- choose the cast and the moments
  // the bay with the most comings and goings
  const lives = (g) => g.members.reduce((n, id) => n + sim.lifetimes(id).length, 0);
  const bays = plan.groups.filter((g) => g.kind !== "hub");
  const bay = (pin.bay && plan.groups.find((g) => g.id === pin.bay)) || bays.sort((a, b) => lives(b) - lives(a) || b.members.length - a.members.length)[0] || plan.groups[0];
  const bayView = () => { const z1 = bay.z + bay.d / 2; return { pos: V(bay.x + 1.5, Math.max(3.4, bay.w * 0.33 + 2), z1 + Math.max(5.5, bay.w * 0.55)), tgt: V(bay.x, 0.9, bay.z + 0.4) }; };
  // playback rates by film time: [F0, rate]; the follow / reading / head windows are fitted below
  const T = { arrive: 0, walk: 6.6, follow: 21, read: 24.2, readEnd: 28.0, head: 31.5, headIn: 36.0, deep: 39.0, out1: 43.0, out2: 44.6, out3: 46.0, board: 46.6, touch: 52.0, pull: 53.5, end: 84 };
  // the capsule to follow: from a seated actor, early enough, going far (to a station or the hub)
  const P9 = 3.0 + T.walk * 1.0 + 1.5;
  const msgs = api.tubes.flights.filter((f) => !f.dim && sim.actor(f.m.from) && !sim.actor(f.m.from).external && f.m.from !== f.to && f.s1 - f.s0 > 0.3);
  const seatedAt = (id, s) => { const L = sim.lifetimes(id); return L.some(([b, e]) => (b <= 0 || sim.warp(b) + WALK < s) && (e === Infinity || sim.warp(e) > s + 0.5)); };
  const far = (f) => (sim.actor(f.to)?.external ? (api.stations.byId.get(f.to)?.attachedTo ? 1 : 3) : 0) + (plan.groupOf(f.to) !== plan.groupOf(f.m.from) ? 1 : 0) + (bay.members.includes(f.m.from) ? 1 : 0);
  let follow = (pin.message && msgs.find((f) => f.m.id === pin.message)) || null;
  if (!follow) { const cands = msgs.filter((f) => f.s0 >= P9 + 6 && f.s0 <= P9 + 30 && seatedAt(f.m.from, f.s0)); cands.sort((a, b) => far(b) - far(a) || a.s0 - b.s0); follow = cands[0] || msgs.find((f) => f.s0 > P9) || msgs[0]; }
  const FOLLOW_AT = T.follow, CLICK_AT = T.read - 0.15;
  // rate between the walk and the follow so the capsule leaves when we start following
  const rateWatch = follow ? Math.max(0.35, Math.min(3, (follow.s0 - 0.1 - P9) / (FOLLOW_AT - (T.walk + 1.5)))) : 1;
  const rateFollow = follow ? Math.max(0.12, ((follow.s0 + follow.s1) / 2 - (follow.s0 - 0.1)) / (CLICK_AT - FOLLOW_AT)) : 0.3;
  // after the slip: let the capsule arrive, then play on toward the head scene
  const afterRead = follow ? follow.s0 + (follow.s1 - follow.s0) / 2 : P9 + 12;
  // the person whose head we visit: seated and busy then, with the deepest chart
  const depth = (id) => { const ch = sim.chartOf(id); let d = 0; const walk = (n, k) => { d = Math.max(d, k); (n.children || []).forEach((c) => walk(c, k + 1)); }; if (ch) walk(ch.root, 0); return d; };
  const rateHead = 0.6;
  const headS0 = afterRead + 0.4 * (T.head - T.readEnd) + 0.5;
  let subject = pin.actor;
  if (!subject) {
    const s0 = headS0, s1 = headS0 + (T.out3 - T.head) * rateHead;
    const busy = (id) => sim.transitionsBetween(sim.unwarp(s0), sim.unwarp(s1)).filter((x) => x.actor === id).length;
    const ok = people.filter((a) => seatedAt(a.id, s0) && seatedAt(a.id, s1));
    ok.sort((a, b) => (busy(b.id) + depth(b.id) * 2) - (busy(a.id) + depth(a.id) * 2));
    subject = ok[0]?.id || people[0]?.id;
  }
  // the moment the board takes us to: just before a blackout, else the most arrivals and departures
  let seekS = pin.seek != null ? sim.warp(pin.seek) : null;
  if (seekS == null && plan.blackouts.length) seekS = Math.max(0, plan.blackouts[0][0] - 4);
  if (seekS == null) { let best = 0, bestN = -1; for (let s = 0; s < LOOP - 20; s += 2) { let n = 0; for (const a of people) for (const [b, e] of sim.lifetimes(a.id)) { if (b > 0 && sim.warp(b) >= s && sim.warp(b) < s + 18) n++; if (e !== Infinity && sim.warp(e) >= s && sim.warp(e) < s + 18) n++; } if (n > bestN) { bestN = n; best = s; } } seekS = best; }
  seekS = Math.min(seekS, LOOP - 32);
  const rates = [[0, 1.0], [T.walk + 1.5, rateWatch], [FOLLOW_AT, rateFollow], [T.read, 0], [T.readEnd, 0.4], [T.head, rateHead], [T.board, 0.5], [T.touch, 1.0], [T.end, 0]];
  const PLAY0 = 3.0;

  // ---------------------------------------------------------------- the script
  const actions = [], moves = [], clicks = [], cursorOn = [];
  const at = (F, fn) => actions.push([F, fn]);
  const move = (F0, F1, target) => moves.push([F0, F1, target]);
  const show = (F0, F1) => cursorOn.push([F0, F1]);
  const log = [];
  const click = (F) => { clicks.push(F); at(F, () => { const c = cursorAt(F); const r = api.click(c.x, c.y); log.push(`click @${F.toFixed(2)} (${c.x.toFixed(0)},${c.y.toFixed(0)}) -> ${r ? r.kind + (r.id ? " " + r.id : "") + (r.hit ? " " + r.hit.id : "") : "nothing"}`); console.log(log[log.length - 1]); }); };
  let followIds = null;
  const home = api.homeView();
  at(0, () => { camera.position.copy(home.pos.clone().sub(home.tgt).multiplyScalar(1.7).add(home.tgt).add(V(0, 6, 0))); controls.target.copy(home.tgt); api.flyTo(home.pos, home.tgt, 5.5); });
  // walk over to the bay: click the floor in front of it
  show(4.6, T.walk + 1.4);
  move(4.6, T.walk - 0.1, () => project(V(bay.x, 0, bay.z + bay.d / 2 + 1.6)));
  click(T.walk);
  at(T.walk + 0.05, () => { const v = bayView(); api.flyTo(v.pos, v.tgt, 2.0); });
  // follow the capsule, open it, read it
  if (follow) {
    at(FOLLOW_AT, () => { followIds = [follow.m.id]; });
    show(FOLLOW_AT + 0.8, CLICK_AT + 0.8);
    move(FOLLOW_AT + 1.0, CLICK_AT - 0.1, () => project(capsulePos(follow.m.id)) || cursorAt(FOLLOW_AT + 1));
    click(CLICK_AT);
    at(T.readEnd - 0.2, () => api.back());
  }
  // into the subject's head
  at(T.head - 2.2, () => { followIds = null; const c = api.people.headCenter(subject, api.getPlay()) || V(bay.x, 1.4, bay.z); api.flyTo(c.clone().add(V(1.6, 1.4, 4.4)), c.clone().add(V(0, -0.2, 0)), 2.0); });
  show(T.head, T.out3 + 0.3);
  move(T.head + 0.1, T.head + 1.1, () => project(api.people.headCenter(subject, api.getPlay())));
  click(T.head + 1.3);
  move(T.head + 1.6, T.headIn - 0.3, () => project(api.people.headCenter(subject, api.getPlay())?.add(V(0, 0.06, 0))));
  click(T.headIn);
  let headPick = null;
  const headTarget = () => { if (!headPick) { let best = null; for (let gy = 0.3; gy <= 0.75; gy += 0.05) for (let gx = 0.22; gx <= 0.78; gx += 0.04) { const r = api.pickAt(gx * W(), gy * H()); if (r && r.kind === "head" && r.hit.kind === "state") { const sc = Math.hypot(gx - 0.5, gy - 0.52); if (!best || sc < best.sc) best = { sc, x: gx * W(), y: gy * H(), id: r.hit.id }; } } headPick = best || { x: W() / 2, y: H() / 2 }; console.log("head target", JSON.stringify(headPick)); } return headPick; };
  move(T.headIn + 1.7, T.deep - 0.25, headTarget);
  click(T.deep);
  move(T.out1 - 0.8, T.out1 - 0.1, () => ({ x: W() * 0.86, y: H() * 0.88 }));
  at(T.out1, () => api.back()); at(T.out2, () => api.back()); at(T.out3, () => api.back());
  // the board: touch the moment
  at(T.board, () => { board && board.resetView && board.resetView(); api.flyTo(V(plan.board.x + Math.max(6.5, plan.board.w * 0.95), 2.45, plan.board.z), V(plan.board.x, 2.3, plan.board.z), 2.4); });
  const seekT = sim.unwarp(seekS);
  const touchPoint = () => { const r = board && board.locate ? board.locate({ t: seekT, actorId: subject }) || board.locate({ t: seekT }) : null; return r && r.u >= 0 && r.u <= 1 ? boardPoint(r.u, r.v) : boardPoint(0.5, 0.6); };
  show(T.board + 2.6, T.touch + 1.2);
  move(T.board + 2.8, T.touch - 0.3, () => project(touchPoint()));
  click(T.touch);
  at(T.touch + 0.1, () => { if (Math.abs(api.getPlay() - seekS) > 3) { api.setPlay(seekS); } });
  at(T.pull, () => api.flyTo(home.pos, home.tgt, 3.5));
  at(T.end - 11, () => api.flyTo(home.pos.clone().sub(home.tgt).multiplyScalar(1.45).add(home.tgt), home.tgt, 10));

  // ---------------------------------------------------------------- the machinery
  actions.sort((a, b) => a[0] - b[0]);
  let F = -1, playS = PLAY0, ai = 0, cursor = { x: W() * 0.6, y: H() * 0.6 }, lastCam = null;
  const rateAt = (f) => { let r = 0; for (const [f0, v] of rates) if (f >= f0) r = v; return r; };
  function cursorAt(f) {
    let cur = cursor;
    for (const mv of moves) { const [f0, f1, tg] = mv; if (f < f0) continue; if (!mv.start) mv.start = { ...cur }; const k = f >= f1 ? 1 : ease((f - f0) / (f1 - f0)); let to = f >= f1 && mv.end ? mv.end : tg(); if (!to) to = mv.start; if (f >= f1) mv.end = to; cur = { x: mv.start.x + (to.x - mv.start.x) * k, y: mv.start.y + (to.y - mv.start.y) * k }; }
    return cur;
  }
  function ease(x) { return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }
  function frame(f) {
    camera.updateMatrixWorld(); api.scene.updateMatrixWorld();
    while (ai < actions.length && actions[ai][0] <= f + 1e-9) { const before = api.getPlay(); actions[ai++][1](); const after = api.getPlay(); if (after !== before) playS = after; }
    playS = Math.min(LOOP - 0.05, playS + rateAt(f) / FPS);
    api.setPlay(playS); api.setDisplayPaused(rateAt(f) === 0);
    step(1 / FPS);
    const changed = api.getPlay(); if (Math.abs(changed - playS) > 1e-6) playS = changed;
    if (followIds) {
      const p = capsulePos(followIds[0]);
      if (p) { const want = p.clone().add(V(2.0, 1.0, 3.3)); if (!lastCam) lastCam = { pos: camera.position.clone(), tgt: controls.target.clone() }; lastCam.pos.lerp(want, 0.1); lastCam.tgt.lerp(p, 0.2); }
      if (lastCam) { camera.position.copy(lastCam.pos); controls.target.copy(lastCam.tgt); }
    } else lastCam = null;
    camera.lookAt(controls.target); camera.updateMatrixWorld();
    cursor = cursorAt(f);
  }
  function drawCursor(f) {
    const on = cursorOn.some(([a, b]) => f >= a && f <= b); hand.style.display = on ? "block" : "none"; if (!on) return;
    hand.style.transform = `translate(${cursor.x - 9}px, ${cursor.y - 3}px)`;
    let r = 0; for (const c of clicks) { const d = f - c; if (d >= -0.05 && d < 0.45) r = 4 + d * 50; }
    press.setAttribute("r", String(r)); press.style.opacity = r ? String(Math.max(0, 1 - (r - 4) / 22)) : "0";
  }
  function setTime(sec) {
    if (sec < F - 1e-6) { F = -1; playS = PLAY0; ai = 0; followIds = null; lastCam = null; cursor = { x: W() * 0.6, y: H() * 0.6 }; headPick = null; for (const m of moves) { delete m.start; delete m.end; } api.reset(); setAmb(0); }
    api.setPaused(true);
    if (F < 0) { F = 0; frame(0); }
    while (F + 1 / FPS <= sec + 1e-6) { F += 1 / FPS; frame(F); }
    drawCursor(F); render();
  }
  const script = { bay: bay.id, follow: follow && { id: follow.m.id, name: follow.m.name, from: follow.m.from, to: follow.to, s0: follow.s0, s1: follow.s1 }, subject, seekS, rateWatch, rateFollow, log };
  console.log("film", JSON.stringify(script));
  return { duration: T.end, setTime, script };
}
