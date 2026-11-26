# The Office: world notes (generic)

Any system of statecharts in, an office out. `index.html?system=<name>` loads
`data/<name>/trace.json` and, when `data/index.json` marks it, `data/<name>/office.json`.
`node core/make-index.mjs` rewrites `data/index.json` from the `data/` folders. Inside the room,
the DIRECTORY by the door has a brass plate per system; clicking one switches systems.

Checks (node, no browser):
- `node core/check-situation.mjs [system...]`: per actor, the situation over the loop as a strip
  (`·` idle, `W` working, `w` waiting, `!` exception, `D` done, blank = absent). It also loads each
  trace stripped down to the REQUIRED fields only.
- `node core/check-plan.mjs [system...]`: the floor plan as an ASCII map, and fails if two lives
  share a seat at the same time or two groups overlap.

Films: `node record.mjs --system <name>` writes `out/<name>.mp4` and `-small.mp4`.
Stills of the live page: `node tools/shoot.mjs <system> <dir> '<json>'`; every system at once (overview,
eye level, after a click, after leaving a head): `node tools/sweep.mjs <dir>`.
`--test 12,40` writes stills. `SYSTEM=<name> node shots.mjs '[...]'` takes stills of the live page.

## The parts

| File | What it decides |
|---|---|
| `core/sim.js` | The run as a function of time, from the REQUIRED trace fields only. Adds `depth`/`at` inside an instant, lifetimes (several per id), `flight`, `recipients` (broadcasts), `situationAt`/`situations` and `append` (live use later). |
| `core/situation.js` | `idle / working / waiting / exception / done / absent` per actor, from the chart and the run (below). |
| `core/plan.js` | Floor plan: hub, bays, visitors, stations, seats over time, room, door, board, clock, blackouts. |
| `core/desk.js` | Which variables sit on a chart's desk, and their types. |
| `world/building.js` | Room, door, windows, wall clock (play control), board frame, directory. |
| `world/stations.js` | Externals by kind. |
| `world/desks.js` | A desk per seat; the hub's exchange; visitor stools; datamodel objects. |
| `world/people.js` | Avatars pooled per seat, walking in and out, poses from situations, one-shot reactions, the swivel chair. |
| `world/avatar.js` | The rig (joint hierarchy, two-bone IK, a limited roll-free neck, the hinged lid) and the poses. |
| `world/layout.js` | Where things are on a desk, in the seat frame: shared by the desk, the poses and the pose check. |
| `world/camera.js` | Camera flights along paths, collision against furniture, walls and people, the conversational framing. |
| `world/tubes.js` | The comb manifold, routes, instanced capsules, the slip. |
| `film.js` | A visit planned from the run. |

## Generic rules

**Floor plan.**
- The hub is the actor that talks to the most distinct partners, not counting its invoked
  children. To count, it must have at least 3 partners, 1.4 times the next actor's count, and be
  alive for more than half the run. It sits at the EXCHANGE in the middle, under the manifold.
- Every other actor sits in a bay per chart (identical kinds grouped). A bay is rows of up to 6
  cubicles and is sized to the most of that chart alive at once.
- Bays are placed greedily around the hub: heavier talkers nearer, the south half (nearer the
  visitor) preferred.
- An invoked child (`invokeid`, `invoked by` in its role, or an `invoke ...` message from its
  parent) sits on a visitor's stool across its parent's desk. A parent with more than 6 children
  at once gets a bay of children next to its own.
- Seats are given out over time. A new life takes the seat its identity (`identity`, else `id`)
  had before, else the lowest free one. A seat stays busy until the leaver has walked out, so 60
  short-lived workers keep reusing a small bay.
- A mass end is three or more ends in one instant, and half of everyone alive. It is a blackout:
  the lights go out, those people vanish, and the reborn walk back in.

**Externals by kind.** From `kind` first, then words in the id or label:

| Kind | Becomes |
|---|---|
| user | the hatch by the door ("people at the keyboards") |
| timer | the wall clock; a delayed send pops out of the receiver's desk timer |
| log / storage | an archive whose pile grows |
| model | an oracle cabinet |
| service / processor / app | a machine |
| tool | a small machine |
| bus | nothing (the tubes are the bus) |
| anything else | a grey cabinet |

An external that talks to one actor only (90 % of its traffic) stands beside that actor's desk.
Unused externals are not built.

**Situation** (`core/situation.js`). In priority order:
1. absent: not alive.
2. done: a top-level final state, or the last 0.6 s before an end with reason "done".
3. exception: the active leaf is exceptional, or an error event just arrived. A leaf is
   exceptional when its name matches fail/error/offline/backoff/reject/timeout/...,
   or when it is reachable only by events like error/timeout/cancel. An exceptional leaf in one
   parallel region shows for 2.5 s only.
4. working: it changed state within the last 0.7 playback seconds.
5. waiting: it sent a request and the answer has not come yet. The answer is the partner's next
   message back for an external, or a message whose cause chain reaches the request for an actor.
   Requests to user, timer and log endpoints never wait.
6. working: it started an invoke of an external that has not answered done or error.
7. idle: none of the above.

**Situation → pose.**

| Situation | Pose |
|---|---|
| idle | leaning back, hands resting in the lap |
| working | typing (eyes on the screen, which shows the state they are in), or cranking the machine beside the desk when the work is with it |
| waiting on an external | on the phone (the receiver leaves the desk) |
| waiting on an actor | turned to the in-basket under the tube's hatch, then checking the wristwatch |
| exception | leaning back, hands thrown up beside the head (face visible); the desk's red alarm lamp lights |
| done | standing (the chair slides aside) and waving, then walking out |

Reactions play ONCE per event (events closer than 3 s share one) on top of the pose: a reach into the
in-basket when a capsule arrives, typing when the people at the keyboards hand something in, a shrug
at a refusal. Poses are hand targets for two-bone IK on fixed limb lengths (`world/avatar.js`); the
furniture they reach for is `world/layout.js`. `node tools/inspect.mjs` renders one person in every
pose from 8 angles at 1 m and 3 m (`out/inspect/`) and fails when a limb passes through the body or
the furniture: run it after touching a pose, the rig or the desk.

**Desk = datamodel.** Up to 4 variables per chart. Score = changes in the run + 2 x states that
read it. Each becomes an object by type, with an engraved name plate:

| Type | Object |
|---|---|
| number | flip counter |
| boolean | lamp with a switch |
| string | card with the text |
| array | tray with one sheet per item |
| object | pigeonholes with one card per key |

The desk lamp is on while someone sits there. A charted actor with no datamodel gets a plain desk.

**Mail.**
- Each desk mouth drops to a row header. Headers join a spine to the bay's junction box, and a
  trunk runs from the junction to the manifold. Stations have trunks of their own.
- Capsule colour is a stable hue per event family (the name up to its first dot), red for errors,
  a grey bead for log traffic.
- A broadcast is one capsule per receiver.
- A self-send loops over the desk.
- A delayed send comes out of the desk timer.
- Mail for someone who has left falls out of their empty desk's mouth onto the floor.
- Every capsule spends at least 0.7 s in the tube, so it can be seen and clicked.

**What office.json can say** (llm-chat has one):

| Key | What it overrides |
|---|---|
| `names` | display names |
| `characters` | an avatar look per actor id |
| `plan.stations` | externals kept as stations, never attached |
| `plan.kinds` | external kind overrides |
| `plan.hub` | the hub (`false` for none) |
| `poses` | state → pose per chart |
| `desk` | the variables per chart |
| `capsules` | colours per family |
| `film` | pins for the visit: bay, actor, message, seek |

## Performance

- Static furniture is one vertex-coloured mesh per group.
- Tubes are one merged mesh, and the rings an InstancedMesh.
- Capsules are one InstancedMesh: up to 600, recoloured per frame.
- Avatars are pooled per seat and restyled only when the occupant changes; invisible ones cost
  nothing.
- Counters and cards redraw their canvas only when their value changes.
- `many` (61 actors, 22 at once) renders without trouble in the software renderer.

## Known gaps

- The room is often larger than its contents (the station row on the north wall, the minimum
  size). The home view frames the room, not the people.
- Waiting between actors needs cause links. Without them, actor-to-actor requests never show as
  waiting.
- The exception heuristic is partly name-based (English words).
- Visitors share their parent's tube mouth.
- Package downloads and other idle invoked children just sit.
- Board "world" events still do not change the room: the room always plays the trace it loaded.
