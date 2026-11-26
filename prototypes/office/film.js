// film.js: the scripted visit (record mode). A pure function of film time F, stepped frame by frame
// in order: playback rate segments, camera moves, a drawn cursor that clicks through the SAME
// functions the live page uses (api.click raycasts what is under the cursor).
const FPS = 30;

export function makeFilm({ THREE, api, sim, L, step, render, setPlayS, getPlayS, setAmb, camera, controls }) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const hand = document.getElementById("hand"), press = document.getElementById("handPress");
  const W = () => innerWidth, H = () => innerHeight;
  const project = (p) => { const q = p.clone().project(camera); return { x: (q.x + 1) / 2 * W(), y: (1 - q.y) / 2 * H() }; };
  const capsulePos = (id, flying = false) => { const a = api.getActive().find((x) => x.msg.id === id && (!flying || !x.resting)); return a ? a.pos.clone() : null; };
  const headPos = (id) => api.people.headCenter(id);
  const boardPoint = (u, v) => V(L.BOARD.center[0] + 0.08, L.BOARD.center[1] + (0.5 - v) * L.BOARD.h, L.BOARD.center[2] - (u - 0.5) * L.BOARD.w);
  const board = api.board();
  const boardSpan = (q) => { const r = board && board.locate(q); if (!boardSpan.logged) { boardSpan.logged = 1; console.log("board locate", JSON.stringify(r), JSON.stringify(board.state)); } return r ? boardPoint(r.u, r.v) : boardPoint(0.5, 0.5); };

  // ---------------------------------------------------------------- the script
  // rate segments: [F0, rate] (playback seconds per film second) from F0 on
  const rates = [[0, 1], [8.5, 0.75], [16.4, 0.85], [21.0, 0.22], [22.45, 0], [26.6, 0.22], [27.6, 0.3], [29.2, 0.8], [46, 0.6], [51.5, 0.45], [60, 0.85], [86, 0]];
  const PLAY0 = 3.0;
  const actions = []; // [F, fn]
  const at = (F, fn) => actions.push([F, fn]);
  const moves = []; const clicks = [];
  const move = (F0, F1, target) => moves.push([F0, F1, target]);
  const click = (F) => { clicks.push(F); at(F, () => { const c = cursorAt(F); const r = api.click(c.x, c.y); console.log(`click @${F.toFixed(2)} (${c.x.toFixed(0)},${c.y.toFixed(0)}) -> ${r ? r.kind + (r.id ? " " + r.id : "") + (r.hit ? " " + r.hit.id : "") : "nothing"}`); }); };
  let follow = null; // {ids, offset, until}
  const followFor = (F0, F1, ids, offset) => { at(F0, () => { follow = { ids, offset, until: F1 }; }); };
  const cursorOn = [];
  const showCursor = (F0, F1) => cursorOn.push([F0, F1]);

  // A. arrive: the overview with mail flying (Ada sends; the host goes busy)
  at(0, () => { camera.position.set(25, 23, 33); controls.target.set(-1, 0, 0); api.flyTo(V(...L.HOME.pos), V(...L.HOME.target), 6.0); });
  // B. walk to Ada and Bo: click the floor in front of their desks
  showCursor(5.0, 8.4);
  move(5.0, 6.5, () => project(V(-6.0, 0, 10.2)));
  click(6.8);
  at(6.85, () => api.flyTo(V(-5.8, 3.6, 13.4), V(-6.0, 0.85, 7.2), 1.8));
  // C. at Ada and Bo: Bo types while the host is busy; his message waits in his tray; his steer is refused
  // D. to the terminal: the host's tool call arrives, the machine runs; follow the result to the exchange and on to the model
  at(16.4, () => api.flyTo(V(5.6, 2.4, 12.3), V(3.6, 1.15, 7.2), 2.2));
  followFor(21.0, 30.5, ["e242", "e252"], V(2.0, 0.9, 3.2));
  showCursor(21.6, 24.0);
  move(21.8, 22.65, () => { const p = capsulePos("e242"); return p ? project(p) : cursorAt(21.8); });
  click(22.75);                                    // open the capsule: read its slip
  at(26.4, () => api.back());                      // fold the slip away
  // E. into Ada's head
  at(30.5, () => { follow = null; api.flyTo(V(-8.0, 2.5, 11.6), V(-9.0, 1.3, 7.1), 2.0); });
  showCursor(31.8, 46.4);
  move(31.9, 32.8, () => project(headPos("ada")));
  click(33.0);                                     // select Ada: the camera comes to her face, the lid lifts
  move(33.4, 35.1, () => project(headPos("ada").clone().add(V(0, 0.06, 0))));
  click(35.4);                                     // a second click: in we go
  move(37.2, 38.9, () => headTarget());
  click(39.2);                                     // a machine inside: deeper
  move(42.2, 42.9, () => ({ x: W() * 0.86, y: H() * 0.88 }));
  at(43.0, () => api.back());                      // Escape: out of the machine
  at(44.6, () => api.back());                      // Escape: out of the head
  at(46.0, () => api.back());                      // Escape: away from the desk
  // F. the telemetry board: touch a span, the room jumps to that moment
  at(46.5, () => { board && board.resetView(); api.flyTo(V(-8.9, 2.45, -2.6), V(-15.8, 2.3, -2.6), 2.4); });
  showCursor(49.0, 53.0);
  move(49.2, 51.2, () => project(boardSpan({ t: 6720, actorId: "python" })));
  click(51.5);
  // G. pull back out: the room at that moment, both machines running; then the whole floor
  at(53.0, () => api.flyTo(V(4.5, 5.4, 16.5), V(6.2, 0.9, 6.9), 2.4));
  at(63.0, () => api.flyTo(V(...L.HOME.pos), V(...L.HOME.target), 4.0));
  at(70.0, () => api.clearSpot());
  at(74.0, () => api.flyTo(V(20, 19, 30), V(-1, 0, 0), 11.0));
  const DURATION = 86;

  // what the cursor targets inside the head: a machine of Ada's (the outbox, else any state)
  let headPick = null;
  function headTarget() {
    if (!headPick) {
      // scan the screen for a state machine under the pointer, nearest the centre
      let best = null;
      for (let gy = 0.3; gy <= 0.75; gy += 0.05) for (let gx = 0.25; gx <= 0.75; gx += 0.05) {
        const r = api.pickAt(gx * W(), gy * H());
        if (r && r.kind === "head" && r.hit.kind === "state") { const score = (r.hit.id === "outbox" ? -1 : 0) + Math.hypot(gx - 0.5, gy - 0.52); if (!best || score < best.score) best = { score, x: gx * W(), y: gy * H(), id: r.hit.id }; }
      }
      headPick = best || { x: W() / 2, y: H() / 2 };
      console.log("head target", JSON.stringify(headPick));
    }
    return headPick;
  }

  // ---------------------------------------------------------------- the machinery
  actions.sort((a, b) => a[0] - b[0]);
  let F = -1, playS = PLAY0, ai = 0, cursor = { x: W() * 0.6, y: H() * 0.6 }, lastCam = null;
  const rateAt = (f) => { let r = 0; for (const [f0, v] of rates) if (f >= f0) r = v; return r; };
  function cursorAt(f) {
    let cur = cursor;
    for (const [f0, f1, tg] of moves) {
      if (f < f0) continue;
      const start = tg.start || (tg.start = { ...cur });
      const k = f >= f1 ? 1 : ease((f - f0) / (f1 - f0));
      const to = f >= f1 && tg.end ? tg.end : tg();
      if (f >= f1) tg.end = to;
      cur = { x: start.x + (to.x - start.x) * k, y: start.y + (to.y - start.y) * k };
    }
    return cur;
  }
  function ease(x) { return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }
  function frame(f) {
    camera.updateMatrixWorld(); scene_update();
    while (ai < actions.length && actions[ai][0] <= f + 1e-9) { const a = actions[ai++]; if (a[2] === undefined) { const before = getPlayS(); a[1](); const after = getPlayS(); if (after !== before) playS = after; } }
    playS += rateAt(f) / FPS;
    setPlayS(playS);
    api.setDisplayPaused(rateAt(f) === 0);
    step(1 / FPS);
    const changed = getPlayS(); if (Math.abs(changed - playS) > 1e-6) playS = changed; // a board seek
    if (follow && f <= follow.until) {
      let p = null; for (const id of follow.ids) { p = capsulePos(id, true); if (p) break; } if (!p) for (const id of [...follow.ids].reverse()) { p = capsulePos(id); if (p) break; }
      if (p) { const want = p.clone().add(follow.offset); if (!lastCam) lastCam = { pos: camera.position.clone(), tgt: controls.target.clone() }; lastCam.pos.lerp(want, 0.12); lastCam.tgt.lerp(p, 0.2); camera.position.copy(lastCam.pos); controls.target.copy(lastCam.tgt); camera.lookAt(controls.target); }
      else if (lastCam) { camera.position.copy(lastCam.pos); controls.target.copy(lastCam.tgt); camera.lookAt(controls.target); }
    } else { lastCam = null; camera.lookAt(controls.target); }
    camera.updateMatrixWorld();
    cursor = cursorAt(f);
  }
  function scene_update() { api.scene && api.scene.updateMatrixWorld(); }
  function drawCursor(f) {
    const on = cursorOn.some(([a, b]) => f >= a && f <= b);
    hand.style.display = on ? "block" : "none";
    if (!on) return;
    hand.style.transform = `translate(${cursor.x - 9}px, ${cursor.y - 3}px)`;
    let r = 0; for (const c of clicks) { const d = f - c; if (d >= -0.05 && d < 0.45) r = 4 + d * 50; }
    press.setAttribute("r", String(r)); press.style.opacity = r ? String(Math.max(0, 1 - (r - 4) / 22)) : "0";
  }
  function setTime(sec) {
    if (sec < F - 1e-6) { // replay from the start
      F = -1; playS = PLAY0; ai = 0; follow = null; lastCam = null; cursor = { x: W() * 0.6, y: H() * 0.6 }; headPick = null; for (const m of moves) { delete m[2].start; delete m[2].end; } api.reset(); setAmb(0);
    }
    api.setPaused(true);
    if (F < 0) { F = 0; frame(0); }
    while (F + 1 / FPS <= sec + 1e-6) { F += 1 / FPS; frame(F); }
    drawCursor(F); render();
  }
  return { duration: DURATION, setTime };
}
