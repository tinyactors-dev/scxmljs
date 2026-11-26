# The flight recorder

Every session of the Office keeps a log of what happened: the visitor's inputs, what the app did
about them, what was on screen and how it felt (frame times). It is always on, costs well under a
tenth of a millisecond a frame, keeps about ten minutes and more, and is never sent anywhere: the
visitor saves it as a file and sends it themselves. Agents without a GPU replay it frame by frame
and analyse it.

| Piece | What |
|---|---|
| `engine/log.js` | the stream, its rings and events, export, the crash copy, the error hooks |
| `engine/view.js` | what is in frame: subjects on screen and their size, the selected one hidden or not, readable plates |
| `engine/recorder.js` | the orange FLIGHT RECORDER box on the wall above the door |
| `main.js` (`// log:` lines) | the hooks: session, frames, input gestures, picks, actions (`perform`), modes, world, view |
| `world/camera.js` (`// log:` lines) | flights, arrivals, interruptions, collision pushes |
| `tools/logfile.mjs` | reads a log (`.json` or `.json.gz`) for the tools |
| `tools/replay.mjs` | watch it: frames, contact sheets, a video |
| `tools/analyse.mjs` | findings with timestamps and severities |
| `tools/explore.mjs` | simulated first-time visitors (personas) that make logs here |

## For the owner: capturing a log

Use the Office as you normally would; when something feels wrong, press the orange FLIGHT RECORDER
box on the wall above the door (or the `L` key), and your browser saves `office-log-<time>.json.gz`
(it saves a file and sends nothing). Send us that file. If the page tends to crash or hang, add
`&log=1` to the address before you start: a copy is then kept every 10 s, and the recorder pressed
after a reload saves the crashed session too (as `previous`).

## Replaying and analysing

```sh
node tools/analyse.mjs office-log-....json.gz [--out findings.json]
node tools/replay.mjs  office-log-....json.gz [--out dir] [--fps 10] [--from 12 --to 30] [--video]
node tools/explore.mjs --system single-microwave --persona clicker --seconds 60   # make one here
node tools/explore.mjs --live microwave --script tools/scripts/owner1.json --out out/owner1-after   # a visit, step by step
```

A script (`--script`) is a list of steps done with real input, in order: hold a key for some app
milliseconds, tap a control, a person, an event button or a machine in a machine room, its exit (`exit: true`) or an opened card's stamp (`cardClose: true`), wait, Escape. Its taps go
to the screen points the page reports for what each step names, so a script survives layout changes.
`tools/scripts/owner1.json` is the owner's first logged visit (2026-11-26), step for step.

`replay.mjs` opens the same URL with `?replay=1` at the log's viewport. The page then keeps no
clock or camera of its own: the tool steps it by the log's app time, sets the playhead and the
camera pose from the camera channel, and performs the visitor's actions (the `act` channel) at the
moments they happened, awaiting live presses. Each frame gets a strip below the 3D view (time, app
time, mode, last tap and what was near it, what is in view, flights, gestures, errors) and pointer
marks on the frame (cyan: hover trail, orange: pressed, green ring: a tap that did something, red: a
tap that did nothing or walked). Contact sheets (`sheet-N.png`, 12 frames each) are for reading
quickly; `--video` writes `replay.mp4`.

The replay is faithful to what the visitor SAW (camera, playhead, selections, live presses, board
touches); it does not reproduce frame timing or the board's own hover highlight. A system switch
(a directory plate) ends a replay.

## The log (schema `office-log/1`)

A JSON object: the session's fields at the top level, `rings` (high-rate channels as flat number
arrays with their `fields`), `events` (`[t, channel, type, data]`), `overhead`, and `previous` (the
crash copy, when there is one). `t` is milliseconds since the session's time origin.

**Session** (top level): `schema`, `build` (bump `BUILD` in `engine/log.js` on every change that
ships), `startedAt`, `epoch`, `url`, `params`, `system`, `live`, `viewport`, `dpr`, `pixelRatio`,
`ua`, `gl` (`renderer`, `vendor` from `WEBGL_debug_renderer_info`, `version`), `three` (revision),
`mode` (`live-page`, `film`, `replay`, `noloop`), `actors`, `loop`; `synthetic` when an explorer made
it. Events `session/start`, `ready` (ms to first frame), `resize`, `visibility`, `armed`, `export`.

**Rings**

| Ring | Fields | When |
|---|---|---|
| `frame` | `t, dt, work` (ms; `work` = the previous frame's step + render) | every frame, 131072 rows (36 min at 60 Hz) |
| `camera` | `t, px, py, pz, tx, ty, tz, fov, playS, jump` | every 66 ms and on every jump (> 0.75 m in one frame), 16384 rows |
| `pointer` | `t, x, y, buttons, type (0 mouse, 1 touch, 2 pen), id` | moves at <= 30 Hz with a button down, <= 10 Hz hovering; every down and up |

**Events by channel**

| Channel | Types and data |
|---|---|
| `frame` | `long {dt, work, tags, sev}` for dt > 32 ms, with what the previous frame did (`flight:*`, `act:*`, `rebuild`, `head-built`, `board`, `shader`, `view`, `log-save`, `first-frame`); `sec {fps, p50, p95, max, calls, tris, work}` each second |
| `input` | `down/up {x, y, type, id}`, `cancel`, `wheel {x, y, dy, dx, mode}`, `key {key, down}`, `gesture {kind: tap, hold, drag, orbit, zoom, pan, pinch, board-tap, board-drag, ...}` (what the app made of it) |
| `pick` | `tap {x, y, hit: [kind, id] or null, act, near: [[kind, id, px, %screen]...]}` (`near`: subjects whose screen outline is within 40 px; 0 = inside it); `hover {x, y, hit, cursor}` on every change of target or cursor |
| `act` | one per action (`perform` in main.js), replayable: `select {id}`, `enter` (into the selected person's machine room), `exit` (its exit control), `focus {state, point}`, `back`, `slip {id}` (open a capsule's card), `closeCard {how: x, floor}` (its stamp; a tap on the floor, a wall or nothing), `walk {point}`, `press {id}`, `headSend`, `advance`, `now`, `pause`, `speed {i}`, `seek {s}`, `home`, `deselect`, `board {type, u, v, extra}`, `ticker {u, v}` (a tap on the printer's tape), `system {id}`, `export`; `src` input or replay |
| `camera` | `walk {keys, head}` (`head`: in a machine room; twice a second at most while walking), `fly {kind, dur, from, to, tgt, via}` (`kind: reveal`: turned to show what a press caused; `enter` / `leave`: the iris into and out of a machine room: `from`/`to` are office points and the camera jumps between the two places in its middle), `arrive {kind}`, `interrupt {kind, k, by}`, `push {n, box, person, axis, d, by}` (out of furniture), `limit {which}` (orbit limits while dragging) |
| `mode` | `change {from, to, cause}`: `overview`, `person:<id>`, `station:<id>`, `entering:<id>` (the iris closing on the person), `head:<id>` (in their machine room), `machine:<id>` (a machine of it in focus), `leaving:<id>`, plus ` +slip`, ` +paused`, and in live mode ` +rest`, ` +playing`, ` +past` |
| `world` | `press {id, ok, why, queued, stepping, pending}` (also `head:<event>` for a dim button in a machine room, refused with its reason) (a refusal's reason as the control shows it; `queued`: pressed while the last press still played), `consequence {id, actors, seen, control, flew}` 2 s after a press (the people it changed and which were on screen and unhidden; in a machine room `{head: true, machines, seen}`), `ticker {key, actors, text}` (a printed line selected), `head {id, how: built or refreshed}`, `tick {playS, t, rate}` each second, `people {arrive, leave}`, `room {id, in}` (the visitor arrives in a machine room, or leaves it: the swap in the iris's middle), `card {id, open, how}` (a capsule's card opened, or closed: `x` its stamp, `floor`, `esc`, `enter`, `home`), `detail {id, d}` (a head's detail as it changes), `rebuild {ms, events, actors}` (live) |
| `view` | `frame` twice a second: `in [[kind, id, x0, y0, x1, y1, %screen]...]` (largest first; kinds include `model`, a desk model), `n {kind: count}`, `sel {id, on, pct, occ}`, `plates`, `readable` (glyph >= 9 px), `bestGlyph`, `pickable`; `card [x0, y0, x1, y1]` while a capsule's card is open; in a machine room the subjects are its parts (`machine`, the first 120) and the `exit` control, plus `room` (whose) and `head {focus, inside, clipped, shown}` (the machine the camera is inside of, if any; plates of what is in focus cut by the frame's edge) |
| `error` | `error`, `rejection`, `resource`, `console {level, msg}`, `fetch {url, status or msg}`, `webgl-lost`, `webgl-restored` |

## The analyser's findings

Severity 3 confuses or blocks, 2 annoys, 1 worth a look, 0 information. Feel findings are skipped
for software-rendered sessions; thresholds about the app's own pacing use app time (the sum of the
capped frame steps), thresholds about the visitor's pace use wall time. The thresholds are `TH` in
`tools/analyse.mjs`; they were set on the explorer runs of 2026-11-26 (FINDINGS.md) and are to be
checked against the owner's first real log.

| Type | Finding |
|---|---|
| `feel.summary`, `feel.long`, `feel.flight-stutter`, `feel.rebuild` | fps distribution; long frames grouped by cause (and whether our work or something outside it); stutter in flights; slow live rebuilds |
| `camera.jump` | the pose jumped without a flight |
| `camera.interrupted`, `camera.fought` | a flight stopped by input; input during a flight that kept flying |
| `camera.ends-inside`, `camera.sel-offscreen`, `-occluded`, `-tiny` | where a flight left the camera |
| `camera.orbit-pushed`, `camera.limits`, `camera.zoom-bounce` | dragging into furniture; orbit limits hit again and again; zooming in and out |
| `camera.nothing`, `view.no-plates`, `view.readable-share` | looking at nothing pickable; nothing readable |
| `view.card-offscreen`, `view.card-closed` | an opened card reached past the screen; how each card was closed (information) |
| `tap.dead`, `tap.near-miss`, `tap.other`, `tap.repeat`, `tap.rage`, `tap.scenery`, `tap.head-miss` | taps that did nothing, missed something close, hit the wrong thing, repeated, clustered, landed on desks, or hit nothing inside a head |
| `hover.cursor-only`, `hover.touch`, `input.hold` | feedback before a tap |
| `comp.first-success`, `comp.head-bounce`, `comp.regret`, `comp.lost`, `comp.modes` | comprehension proxies |
| `live.consequence-offscreen` | a press whose consequence was off screen: the people it changed not in view (or hidden) 2 s later, or in a machine room no machine whose marble moved; older logs: the driven person (`in:<actor>:...`) missing from the view 1 to 2.5 s after |
| `live.refused`, `live.queued` | a refused press with no reason shown (older builds) or with one (info); a press made while the last still played |
| `selection.lost-walking` | a walking key deselected the selected person, or left their mode for the overview |
| `head.camera-inside`, `head.plate-clipped`, `head.too-near` | in a machine room: the camera inside a machine; plates of the focused machine cut by the frame's edge; older logs: a plate over a tenth of the screen tall while a machine is in focus |
| `head.rebuilt-on-press` | a press in a machine room built the head again (its marbles jumped back) |
| `error.*` | every error the page reported |

## Adding a channel

1. Pick the source: the place where the thing is decided, not a place that observes it.
2. Add one line there, `log.ev("<channel>", "<type>", {small, plain, values})` with a `// log:`
   comment; for something sampled every frame, add a ring in `engine/log.js` (fields, capacity,
   rounding digits) and a method that writes it.
3. Document it in the table above, read it in `tools/logfile.mjs` if it is a ring, and teach
   `tools/analyse.mjs` and the replay strip what it means.
4. Keep the recorder's cost per frame under 0.3 ms: `window.officeLog.overhead()` gives the cost per
   frame, per view sample (twice a second) and both amortised at 60 Hz (`msPerFrameAt60`).

## For scripts

`window.officeLog`: `export()` (the log object), `bytes()` (a gzip Blob), `download()`, `appNow()`
(the app's clock in ms), `lastView` (the latest view sample), `overhead()`, `ev(channel, type, data)`.
