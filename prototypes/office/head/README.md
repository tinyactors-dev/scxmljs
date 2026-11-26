# HEAD: a person's statechart, built as machines (any chart)

`head.js` exports `createHead({ THREE, sim, actorId, options? })` as `../CONTRACT.md` says. It imports
nothing, adds no lights (`MeshStandardMaterial`: WORLD's lights light it) and writes text only on
engraved plates. Nothing in it knows a system: everything comes from the chart and the run.

Pages and tools (not used by WORLD):

- `inspect.html` + `inspect.mjs`: **the inspection harness**. It mounts a head the way `main.js` does
  (no tone mapping, the world's lights, fov 42, the entry camera of `enterHead`: direction (0, 0.3, 1),
  0.6 world units = 14.3 head units from the head's centre, and `detail = (1 - dist) / 0.7`) and shoots,
  per chart, the full entry frame (1440 x 900) and a contact sheet of 3 details (0.1 = just inside the
  skull, 0.57 = entry, 1) x 7 visitor angles (entry, left, right, above, low side, high left, behind).
  It measures every plate on screen: overlaps (from the front), the smallest text of open machines at
  detail 1 (fails under 9 px glyphs), and stillness (60 updates at a fixed t move nothing).
  `node head/inspect.mjs [--tag x] [--only system[:chart],...] [--all] [--mod ./out/before/head.js]`
  writes `out/inspect/<tag>/<system>--<chart>-{entry,sheet}.png` and `report.json`. Without `--all` it
  shoots the three reference heads: single-microwave (small), llm-chat `host` (medium), support-desk
  (big). `INTERACTIVE=1` mounts heads with their push-buttons.
- `perf.mjs [system] [actor]`: builds a head in Node (a stub canvas) and times `update` at detail 0,
  0.57 and 1, and while zooming; prints its affordances.
- `test.html?system=<name>&actor=<id>[&t=ms][&detail=d]`: one head to orbit (the wheel sets detail, a
  click focuses, Esc goes home, Space pauses). `gallery.html?system=<name>`: one head per chart.
  `shoot.mjs`: stills of either page. `fixtures/make.mjs`: a hand-made system of rare shapes.

## The grammar

One state, one thing. A state is either a pad (atomic) or a housing (compound), never both.

| Chart | Mechanism |
|---|---|
| parallel state | a **bench**: one machine per region, side by side (three to six regions: two tiers; more: rows). An atomic or final region is a small machine with one pad. |
| compound state | a **machine**: a housing on a plinth with a brass **door** in its front wall. **In its parent the housing stands in the row where a pad would be**: there is no pad for it. While the marble is inside, its door glows. **Closed**: a solid box; its beam carries its name and, in a dark window, the name of the part that runs. **Open** (detail): glass walls, the parts inside. A machine inside a machine **grows as it opens** (scale 0.5 closed, 0.86 open) and its parent makes room: the layout is re-run, so pads, tracks and housings move apart and the whole head is re-fitted to the view. An inactive machine is painted darker; a dead actor's machines go dark. |
| atomic state | a **station**: a pad with an engraved plate in front of it and its own lamp (lit = running; yellow, red on an exceptional part, green on a final). Up to six parts in a row; more wrap into a serpentine. |
| the active state | **the marble**, one per open machine, on the running pad. When the running part is a compound, the parent has no marble: it went in through that housing's door, and the housing's own marble shows where. |
| initial state | the **entry ramp**: a flat brass strip from the machine's door along the floor to the initial part, ending in an arrow. A marble that enters the machine comes in at the door and rolls along it. |
| final state | a **drain**: a dark pad with a brass ring round a hole. |
| history state | a pad on the back shelf with a brass **notch** and a plate **H** / **H\***; a **ghost marble** waits where it will come back to. |
| transition between parts | a **track**: an arch with an **arrowhead** near its end and its event engraved on a plate over its **crown** (eventless: the guard in brackets, or `auto`; both: `event / [guard]`). Brass = main line, thin red = exceptional (rule below). Tracks between the same two parts take **lanes**: the first (left to right, or front to back) a high arch set back, the second a low arch set forward, its plate between the two arches. Event plates that would cover another plate are lifted. Never-taken tracks are dim; the last one taken glows for about 2 s. |
| transition to or from a compound | ends at (starts from) its **door**. A transition out of one specific part inside it starts at that part's pad and climbs out over the housing. |
| transition the machine itself takes to one of its parts | a track from the machine's **door** to that part. |
| self-transition / re-entry | a **loop** standing over the pad, its event on top. |
| targetless transition | a **bell** beside the pad; it rings and the marble hops. |
| delayed `<send>` | a **clock on a post** beside the station that set it, its face to the viewer: twelve ticks and the delay (`1s`). While the timer runs the face lights and a red hand and an amber wedge sweep from set to due. |
| a hub with more than 10 tracks | a **bus**: one raised rail over the partners, a drop to each (no event plates). |
| `<invoke>` | a green **speaking tube** from the pad ending in a horn, lit while the child lives; `outlets()` gives its world position. |
| an event arriving | a **mail capsule** comes out of the **inlet** (a brass pipe down from the dome, top back of the head), flies to the **funnel** of the machine that takes it, drops in and is gone; then the marble moves. Only machines that take mail have a funnel (upright, on a short chute into the roof, at the back-left corner), and each region above them, which takes the mail while they are shut. A capsule for a machine that is shut, hidden or staged away goes to the nearest visible funnel above it. |
| variables | up to four **gauges** standing on the back top rail of the machine that reads each most, their plate below: a glass tube of balls (array, object), a round dial with its value in a window (number), a lever and lamp (boolean), a lamp (anything else). Copper pipes run to the other machines that read or write it. |

History of the grammar: until 2026-11-26 a compound was ALSO a pad in its parent (with the housing behind
it), the initial state was a brass cone leaning over its pad, every machine had a hopper on a pole,
the beam carried one round lamp per part, timers were clocks on stalks and the dial gauge was a box on
the roof with a copper pipe up to it. The owner's first visit (QUALITY.md, H1–H9) showed none of them
explained itself at the size the world mounts a head; they were replaced as above.

## The desk model (`{desk: true}`)

`createHead({THREE, sim, actorId, options: {desk: true}})` builds the same machines, marbles and motion as a
tabletop model that WORLD stands on the person's desk (`world/models.js`). It differs only in what a model at
arm's length needs: no room, inlet, capsules, gauges or push-buttons; no fitting to the entry camera (one
machine unit is one group unit, the content centred and standing on y = 0: WORLD scales the group to the desk);
narrower walls and gaps (`MARGIN` 0.18, a nested machine as large as its parent's parts), bigger, brighter
marbles, beam names on 84 % of the beam, and station plates lying flatter and as large as their place allows.
`setLevels(n)` closes every machine deeper than `n` (its window says what runs there); WORLD picks the
deepest level whose state names stay legible at the desk (`world/models.js`, `FONT_MIN`). `update(t, dt, s)`
takes the playhead second `s` when the caller has one (a live run's playhead goes past its last instant, where
`warp(t)` stops); the walk-in head is updated the same way.

Interactive heads (`{interactive: true, judge(event), whyNot(event)}`) now show every push-button: lit (bright
brass) when its event is an affordance of the configuration that `judge` accepts, dim (dark) otherwise;
`hoverButton(pick)` and `showWhy(event)` turn a dim button's plate into `whyNot(event)`.

## Exceptional: the structural rule

For each compound state, over the transitions among its parts (each transition drawn at the level
where it acts):

1. A transition is **error** when its event is `error` or `error.*`, or its guard tests an
   error or failure (`error`, `fail…`, `ok === false`, `!…ok`), or it is the unguarded fallback of
   a transition with the same event whose guard tests success (`done.invoke.x [ok]` / `done.invoke.x`).
2. A transition is **timeout** when its event is raised by a delayed `<send>` somewhere in the chart
   AND its source state has another, non-timer way out (a timer racing a reply). A timer that is a
   state's only way out (a back-off wait) is a normal transition.
3. The **main set** is what the initial part reaches through normal transitions (including the
   machine's own chutes). Parts outside it are **exceptional**. They stand on a dark shelf behind
   the main rows, and their lamps glow red.
4. A track is exceptional (red) when any transition it carries is error or timeout, or it touches an
   exceptional part.
5. Names are only a tie-breaker. A part no transition reaches goes to the shelf if its name looks
   like an exception (fail, error, offline, …). A back-edge (to a part earlier in the main order)
   whose event name looks like an abort (interrupt, cancel, abort, …) is drawn red.

What this gives: llm-chat's `backoff` (guarded on an error), a package's `failed` (the fallback of
`done.invoke.fetch [ok]`, and `error.execution`) and the fixture's `exception` (an `error.execution`
and a racing `delivery.timeout`) are exceptional. pi-durable's `aborting` is not, because the run
reaches it by a normal `task.abort`.

## Layout

- The `__root__` wrapper is skipped when it has a single compound or parallel child. A machine for
  `__root__` itself is named after the actor's chart.
- Within a machine the order is: the initial part (front row, leftmost: the door and its ramp are left
  of it), then breadth first along normal tracks, then the machine's own targets, then the rest in
  document order. Exceptional and history parts go to the shelf at the back.
- Layout is a function of each nested machine's current scale; it is re-run (and the meshes moved,
  tracks rebuilt) only when a scale changes, i.e. while the detail changes. A parent with more than 16
  parts, a machine with a bus, and every machine of a chart of more than 80 states keep their machines
  at the closed scale (big charts use the stage, below).

## Big charts: built lazily, opened along the active path

A head builds almost nothing up front. Measuring the whole chart (sizes, places of every station,
the marble's moves) costs no meshes. Meshes are built in three steps:
- **Lite housing**, when the parent first opens: plinth, walls with their top, the beam with its
  nameplate and one instanced lamp strip (about 5 meshes).
- **Full housing**, when the machine starts to open itself: floor, frame, lid (the door, the funnel and the
  beam's name and window are in the lite housing).
- **Inside**, when it opens: stations (instanced pads and lamps), tracks, buses, marble.

With more than 80 states, an unfocused head opens only machines on the **active path** (and level
1). Everything else stays closed, showing its lamps, until it is focused.

Measured on support-desk (333 states, depth 10, a 65-part machine), in Node, per frame, after a
warm-up:

| view | meshes | instanced | update |
|---|---|---|---|
| detail 0 | 47 | 2 | 0.05 ms |
| detail 1, unfocused (active path open) | 415 | 51 | 0.15 ms |
| `routing` staged (65 parts, its bus, 65 closed queues) | 923 | 123 | 0.30 ms |
| `tier3` (level 7) and `vendor-fix` (level 9) staged | ~1000 (all built so far) | ~138 | 0.04–0.14 ms |

Costs in Node: creating the head about 200 ms (most of it loading the trace); the first open of
`routing` about 30 ms. Meshes are kept once built.

## Lives, kills and restarts

A normal `end` winds the machine down: the marbles sink. An `end` with `reason: "disposed"` (a
killed process) freezes: the marbles stay where they stood, turn grey, and the housings go dark. A
reborn actor that comes back under a new id (`harness~2`, with `identity` and `incarnation`) gets a
**#2** plate beside its nameplate, and its first transition drops the marble in at the
checkpointed station.

## Deep charts: focus re-normalises

Unfocused, at most three levels open with detail: level L opens over
`d ∈ [(L-1)/n, L/n]`, where `n = min(levels, 3)`. Deeper machines stay closed and show their lamps.

`focus(id)` on a machine (or a station) at level 2 or deeper makes that machine the **stage**:
- The head is re-scaled so the stage fills the box, at the same size every time.
- Its ancestors' housings, tracks and pads, and every branch not on the path, are hidden.
- The stage opens with detail, and the machines inside it wait closed until you focus one of them.

So a six-level chart is read one level at a time, always at a readable size. The re-scale eases with
`dt` (exponential, about 0.6 s) and snaps when `dt` is 0. `focusBounds` always reports where the
target will be once it has settled, in world coordinates. A level-1 focus keeps the whole head (as
before). `stageId` says which machine is staged.

## Time

`update(t, dt)` uses `t` (virtual ms) through `sim.warp` (playback seconds). One pass over this
actor's spawn, transition, config and end events builds each machine's marble moves:
- A transition moves the marble of every machine whose parts it exits or enters.
- A config that disagrees with what the transitions said adds a move. This covers traces without
  transitions, and a restart at a checkpoint.
- An `end` sinks every marble (the machine winds down, about 0.9 s).

**Moves of one trace event run in order**, after every machine they touch has finished its previous
move: first the machines being left, innermost first (their marbles roll back to the door and are
gone), then the travels, then the machines being entered, outermost first (the parent's marble reaches
the compound's door and shrinks into it; the inner marble comes in at that housing's door and rolls
along its entry ramp). Each event starts `CAP_LEAD` (0.26 s) after its capsule drops into a funnel; the
capsule leaves the inlet `CAP_FLY` (0.55 s) before. A move travels 0.38 s, an entry 0.32 s.

**Stillness**: with `t` fixed, `update` changes nothing. The only easing (the stage re-scale) runs with
`dt` towards a fixed target and stops there; growth follows `detail`, not time. The harness checks it.

**Bursts**: when the queue lags its trace by more than 0.35 s, moves get shorter. Beyond 1.6 s they
fast-forward: 0.03 s each, and the marble is drawn as a stretched streak (a blur). Forty transitions
in one instant play in about three seconds.

**Lifetimes**: these come from `sim.lifetimes(id)` (several lives, as with pi-durable's kill and
resume), else from `bornAt`/`diedAt`:
- Dead: the housings go dark over 1.2 s.
- Reborn: the next transition or config drops the marble in at the checkpointed part.

Missing `cause`, snapshots or datamodel are fine.

## The room (for WORLD to mount)

`head.room` is a `THREE.Group` in the head's own units, **not** added to `group`: an attic under the
skull's dome. A lathe-shaped plaster dome over wood panelling with brass ribs like sutures, a plank
floor at y = -4.6, a green lamp hanging from the crown with a warm halo, and **two round windows at the
front, where the eyes are**, cut out of the wall: looking forward from inside (orbit round to the back)
you see the office through them. It is drawn from inside only (`BackSide`), so a camera outside it (the
world's entry camera is 14.3 head units from the centre, outside the 9.2-unit dome) sees in through the
cut-away near side, from any angle. The machines stand on a wooden **table** (part of `group`, fitted
to whatever is shown) whose legs reach that floor; the mail **inlet** pipe (also in `group`) reaches the
dome. `options.room === false` builds no room.

What WORLD changes in `main.js` (`headFor` and the frame loop):

```js
// headFor(id): drop the skull box (lines 121-122) and mount the room in its place
h.group.scale.setScalar(HEAD_SCALE); h.group.visible = false; scene.add(h.group);
if (h.room) { h.group.add(h.room); h.room.visible = false; h.skull = h.room; }   // replaces the BoxGeometry skull
// step(): unchanged: `h.skull.visible = sel.skinHidden` now shows the room while the skin is hidden
```

The room spans x and z of +-9.2 and y from -4.6 to 7.8 head units (+-0.39 x -0.19..0.33 world units at
HEAD_SCALE 0.042): bigger than the avatar's 0.46 head, so keep it hidden until the skin is (as the skull
was). The content itself may now reach x +-7.5 (it is fitted to the entry camera's frame, not to the
10-unit box: a two-machine head fills the view as a twelve-machine one does).

## Fitting to the view

The head knows where WORLD's camera is when it enters (`ENTRY` in head.js: direction (0, 0.3, 1),
distance 14.3, fov 42, assumed aspect 1.45). After every layout it chooses a scale and a height for the
content so its projected box fills 90 % of that frame's width or 72 % of its height (within x +-7.5,
z +-6.25, above the floor), vertically centred. A small chart gets big machines, not a big void.
Opening is paced by size: a chart of up to 12 states is fully open at the entry camera's detail (0.57),
a medium one opens level 1 there and the rest as the visitor comes closer, a big one (more than 80
states) as before. Plates of an open machine are at least 0.23 head units tall (scaled up when their
machine is small, as wide as their place allows; long names break onto two lines).

## Click-driven use: `affordances()` and `{interactive: true}`

`head.affordances()` → for the configuration of the last `update(t)`, every event that would make a
transition now, deepest state first (as SCXML selects):
`[{event, from, to, targets, cond, preempted, object, pick}]`. `from` is the state whose transition it
is, `to` its first target (`null` for a targetless one), `cond` its guard (the head does not evaluate
guards: the caller decides), `preempted` is true when a deeper (or earlier) unguarded transition of an
active state already takes that event. `object` is what to click: the push-button when there is one,
else the track it runs on, else the station (its bell). `pick` is what `pick(raycaster)` returns for it:
`{kind: 'event', id: '<from>:<event>', event, from, to, targets, object}`. Wildcards (`input.*`) and
`done.*` / `error.*` events are left out: a visitor cannot send them.

`createHead({..., options: {interactive: true}})` adds a small brass **push-button** plate engraved with
the event at the start of each track, one per event (up to three per track), shown only while that event
would move the actor. `pick()` on one returns the `kind: 'event'` result above. Without the option no
buttons are built and nothing else changes.

`head.plates()` → `[{text, kind, level, focal, mesh}]`: every engraved plate now shown (the harness
measures them).

## API (CONTRACT.md, plus)

- `room` (a Group, or null with `options.room === false`), `affordances()`, `plates()`, `options.interactive`:
  above.

- `focusBounds` (getter) `{center, radius, box, object}`, in world coordinates, as it will be once
  settled.
- `pick(raycaster)` → `{kind: 'state'|'transition'|'variable', id, object, point}`. Pads are
  instanced, and the id comes from the instance. Transitions are named `<machine>:<from>-><to>`,
  where `*` is the machine's own chute.
- `outlets()` → `[{stateId, invokes, childIds, active, position (world), visible}]`: the speaking
  tubes' horns.
- `stageId`, `levels`, `detail`, `focusId`, `states()`, `pathTo(id)`, `boundsOf(id)`,
  `movesOf(machineId)` (`[{start, end, from, to, ev, fast, death}]` in playback seconds),
  `stats()` (meshes, instanced meshes, machines, stations, levels).
- `options.maxGauges` (default 4).

**Cost**:
- Pad bases and lamps are two `InstancedMesh`es per machine; gauge balls are instanced; a housing's
  posts and rails are one geometry, a track and its arrowhead one, the entry ramp one.
- Measured with `perf.mjs` (Node, 2026-11-26): microwave 84 meshes, llm-chat host 190, support-desk
  368 at detail 1 unfocused (was 415). `update` with the detail still: 0.03-0.15 ms (microwave, host),
  up to 0.45 ms (support-desk). While the detail changes, a growing machine re-lays out in 20 steps over
  the zoom: 1-2 ms a frame on average on host, with single frames of several ms (tracks rebuilt).

## What still breaks or is weak

- Medium charts (llm-chat host and client, pi-durable tasks) still have a few event plates that cover
  one another at the entry camera (`report.json`: 1-7 per head), mostly between a nested machine's
  plates and its parent's, which the per-machine declutter does not see; and from oblique angles plates
  at different depths overlap as any 3D labels do.
- Long guards make long plates: `[task.state.status…]` is cut at 18 characters.
- A big chart (support-desk) is not legible at detail 1 without a focus: 63 plates of its open machines
  are under 9 px. It relies on the stage (focus), as before.
- A capsule is visible in flight from the inlet for 0.55 s before it drops; in a paused frame it is in
  the air, on its way (the inlet and the funnel are both visible).
- The room is seen from outside at detail ~0.1 (a dome on a table, the office around it); WORLD shows
  the skin until 0.95, so a visitor meets it only briefly.

- Wide machines with nested machines in a back row: the nested housings of the front rows can hide
  the pads of the rows behind them, seen from low angles.
- A wide machine's tracks between distant pads (skipping rows) arc high and cross. They stay
  followable when lit, but the dim web is busy.
- Speaking tubes are matched to children by invoke id or chart name, else to all of the actor's
  children.
- History routing through the notch is inferred: any re-entry at a non-initial part of a machine
  that has a history state goes through the notch, because the trace does not say whether the
  transition targeted the history.
- The structural rule calls exceptional only what the chart says: an abort reached by a normal
  event (pi-durable's `aborting`) is main line.
