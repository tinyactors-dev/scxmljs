# The Office: world notes

The recorded llm-chat run (`../data/trace.json`) as an office floor you walk through. Serve
`prototypes/viz3d/` statically and open `office/index.html` (three.js 0.170 vendored in `vendor/`,
no network). `node record.mjs` films the scripted visit into `out/office.mp4` and
`out/office-small.mp4`; `node record.mjs --test 12,40` writes stills of film seconds;
`node shots.mjs '[{"name":"x","s":20,"pos":[..],"tgt":[..],"js":"..."}]'` takes stills of the
live page. `node core/check-sim.mjs` prints active leaves and capsules in flight at a few times.

## Files

| File | What |
|---|---|
| `core/sim.js` | the run as a pure function of time (CONTRACT.md), plus `at`/`depth` per event, `flight(m)`, `alive`, `event`, `eventsBetween`, `playDuration` |
| `world/layout.js` | where everything is |
| `world/kit.js` | boxes, materials, canvas textures (faces, plates, counters) |
| `world/avatar.js` | the blocky person and the pose vocabulary |
| `world/poses.js` | the state -> pose tables (below) |
| `world/people.js` | who stands/sits where, walking in and out, reactions |
| `world/office.js` | building, desks and stations; their update reads the datamodel |
| `world/tubes.js` | pneumatic tubes, capsules, the slip |
| `main.js` | scene, clock, camera, picking, selection, HEAD and BOARD mounting |
| `film.js`, `record.mjs` | the scripted visit and the recorder |

## Time

The bus has zero latency, so a whole causal chain (timer -> manager -> reception -> Ada -> host ->
model) happens at one trace millisecond. `sim.js` gives every event a `depth` (message hops before
it inside its instant, from `via`/`cause`, else "after whatever reached the sender in this
instant") and an effective time `at = t + depth * 0.04 ms`. `warp` gives each hop 0.72 playback
seconds and compresses idle gaps (about 0.052 * sqrt(gap ms) s, 0.22 to 2.8 s), so one loop of the
14.35 s run is 88.9 s. A capsule's flight is `sim.flight(m)`: from its sender's step to `at` for a
hop, one second before `at` for a reply with no link inside its instant (the model, a timer).

## Actor -> character

| Actor / endpoint | In the office |
|---|---|
| host | the operator at the octagonal EXCHANGE in the middle (headset), all tubes meet in the brass hub above |
| Ada, Bo, Terminal, Python (client) | people at cubicle desks in a row facing the visitor, each with a nameplate |
| tools.terminal, tools.python | a machine beside that desk (SHELL, PYTHON) with a gear window, crank, chimney and lamp |
| llm (the model) | THE MODEL: an oracle cabinet behind glass to the north: two tape reels, a field of lamps, a purple eye, a horn, a printout slot |
| log (chat log) | the archivist at the CHAT LOG desk (east): ledger, page pile, binders, filing cabinets |
| stage (the people at the keyboards) | the lit hatch PEOPLE AT THE KEYBOARDS behind RECEPTION with three silhouettes; the bell on the counter |
| director (scenario chart) | the floor manager with a tie and clipboard who walks in, stands at reception and leaves when the script is done |
| timers | the wall clock on the north wall: its bells ring when a delayed send fires |
| workspace + 6 packages | the storekeeper dozing on a stool in the WORKSPACE storeroom (north-west), six closed crates on shelves |
| bus | the tubes themselves |
| keycheck, downloads | not built: no traffic in this run |

## State -> pose (`world/poses.js`; first active state wins)

| Chart | Active state | Pose |
|---|---|---|
| client | `left` | gets up and walks out of the door |
| client | `offline` | asleep: head on the desk, eyes shut; lamp and screen dark |
| client | `joining` | waves (after walking in from the door) |
| client | `syncing` | elbows on the desk, watching |
| client | `working` | turned to the tool machine, cranking it |
| client | `sending` | turned to the tube mouth, reaching for it |
| client | `host-busy` | elbows on the desk, watching the stream on the screen |
| client | `host-idle` | leaning back, hands behind the head |
| host | `backoff` | checking the wristwatch |
| host | `connecting`, `thinking` | receiver at the ear, waiting (the MODEL cord is plugged) |
| host | `writing`, `calling` | receiver at the ear, writing |
| host | `tools` | turned round to the switchboard, plugging cords |
| host | `settling` | stamping |
| host | `idle` | leaning back |
| scenario | any step / `done` | standing with the clipboard / walks out |
| workspace | `open` | dozing on the stool |

Reactions layered on the pose (each caused by one message): typing for a second when the people at
the keyboards hand something in (`ui.*` from stage); a quick reach to the tube mouth when a capsule
arrives; a shrug for 1.8 s when an `input.rejected` arrives; the archivist writes when a log
capsule arrives. Spawned clients walk in from the door (3 s) and sit down.

## Variable -> desk object (only what the trace writes)

| Chart | Variable | Object |
|---|---|---|
| client | `queue` | yellow letters standing in the wire in-tray (Bo's waiting message) |
| client | `awaiting` | a slip clipped beside the tube mouth (sent, not answered yet) |
| client | `rejection` | a red note stuck to the monitor |
| client | `granted` | keys on hooks on the left partition: yellow input, red control, green tools |
| client | `running` | green cards in the pigeonholes at the right end of the desk |
| client | `seq` | the mechanical three-digit counter on the desk; the screen's lines |
| host | `turn` | the big flip counter on the exchange's front |
| host | `clients` | the roster pegs on the switchboard, lit in each client's colour |
| host | `pending` | a green patch cord from the plug to that client's jack, its lamp lit; green cards in the panel's pigeonholes |
| host | `steers` | yellow slips on the clipboard at the counter's west side |
| host | `incoming` | notes on the spike |
| host | `stoppedBy` | a red STOP flag with the name |
| package | state | crate lid (closed while `absent`, open while fetching, blue fill when ready) |

Also: the desk lamp is the client's `online` state; the MODEL cord and lamp are the host's
requesting states; the oracle runs between its request and its `done`; a tool machine runs between
`run` and `tool.done`.

## Message kind -> capsule

| Kind | Capsule |
|---|---|
| typed input (`ui.submit/steer/interrupt`, `input.*`, `restore`) | yellow |
| control (hello, welcome, snapshot, busy/idle, accepted, resync, bye) | blue |
| the model (`invoke llm`, `llm.*`, `done.invoke.llm`) | violet, slightly larger |
| tools (`tool.call`, `run`, `tool.done`, `tool.result`) | green |
| refusal (`input.rejected`) | red |
| timer (from `timers`) | orange |
| script notes (from the floor manager) | cream, small |
| package invoke | brown, small |
| log (`log.batch`, anything to the log) | small dim grey bead |

A broadcast is one capsule per receiver, so they leave the hub together and fan out. The last
non-log capsule an endpoint received lies in the wire basket under its mouth. Clicking a capsule
(flying or lying) unrolls its slip above it: event name, from -> to, the summary.

## Interaction

Drag to orbit, wheel/pinch to zoom, click the floor to walk there, WASD/arrows to walk, `h` home.
Click a person: the camera comes to their face and the lid (hair/hat) lifts; click again, or wheel
in, to go into the head (HEAD's machines in a warm skull room, `setDetail` from the camera
distance: 0 at 1.0 m, 1 at 0.3 m); click a machine to go deeper (`focus`). Escape steps back one
level each time (slip, machine, head, desk, home). Click a machine or the oracle or reception for a
close-up. The wall clock is the play control: click its face to pause (the pendulum stops), click
the lever below to change speed (1/2, 1, 2); space, `[`/`]`, `,`/`.` on the keyboard. The board
gets the pointer as u,v (move/down/up/wheel); its `seek` sets the clock, `select` puts yellow rings
under those people and enlarges those capsules, `world` is ignored (the room plays the base run).
Selecting a person or a capsule calls `board.highlight`.

## Integration

- `head/head.js` was present and worked first time; mounted at scale 0.042 in the selected
  person's head, rotated with them. Placeholder (a box with gears) only if the import fails.
- `board/board.js` was present and worked; its canvas is a `CanvasTexture` on the west wall,
  `now` is the ambient clock so film mode is deterministic; `locate()` is used by the film to find a
  span to touch. `resetView()` before the film touches it (a capsule highlight had framed it).

## What works

- The overview reads as a place: who sits where, the tubes meeting at the exchange, the model's
  room, the board on the wall. Capsules fly at the moment the trace says and the receiver reacts.
- Bo's queued letter, the red refusal note, the keys, the counters and the patch cords change at
  the moment the trace writes them. Walk-ins, the terminal walking out, Bo asleep while offline.
- The head flow (lid, dive, machine focus, Escape back out) and the board seek work in the live page
  and in the film through the same code (`api.click` raycasts under the drawn cursor).

## What does not (yet)

- Small things are small: from the overview the capsules are dots and the desk objects need a
  closer look; nothing reads poses from far away except posture.
- Tool machines read a little like loudspeakers; the gear behind the round window should be bigger.
- A capsule's flight inside a burst is about half a second of playback: following one needs the
  slower speed (the film slows time for it; the live page has the lever).
- Package downloads never happen in this run, so the storeroom never moves.
- Board 'world' (what-if runs) does not change the room; the room always plays the base run.
- The host's tube mouth sits above his counter; capsules for the host land in a basket in mid-air
  next to him.

## The film (`out/office.mp4`, 86 s, 1280x720, 30 fps; `out/office-small.mp4` crf 27, faststart)

Overview with mail flying (Ada sends, the host goes busy, Bo and Terminal walk in) -> the cursor
clicks the floor in front of Ada and Bo -> Bo types while the host is busy: his letter waits in his
tray, his steer comes back red and he shrugs -> the terminal's tool call, the machine cranks -> the
camera follows the tool result up the tube to the exchange; the cursor clicks it and its slip
unrolls (time stopped while it is read) -> on to the model -> click Ada, the lid lifts, click again
and in; click her `work` machine, deeper; Escape three times out -> the board: the cursor touches
Python's tool span and the room jumps to that moment (Python and Terminal cranking, a yellow ring
under Python) -> back to the overview: Bo falls asleep offline, the terminal walks out -> pull out.
All six scripted clicks hit their targets (logged by `record.mjs`). Weak moment: following the
model request starts with the camera very close to the host's face.

## Next

Bigger, slower capsules near the camera; sound (the bell, the tube's whoosh); the room playing a
what-if world when the board picks one (a second, ghosted copy of the people who diverge); a
"follow this capsule" click that slows time automatically.
