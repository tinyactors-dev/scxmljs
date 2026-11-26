# HEAD: a person's statechart, built as machines (any chart)

`head.js` exports `createHead({ THREE, sim, actorId, options? })` as `../CONTRACT.md` says. It imports
nothing, adds no lights (`MeshStandardMaterial`: WORLD's lights light it) and writes text only on
small engraved plates. Nothing in it knows a system: everything comes from the chart and the run.

Pages and tools (not used by WORLD):

- `test.html?system=<name>&actor=<id>[&t=ms][&detail=d]`: one head. Orbit with the mouse, the wheel
  sets detail, a click on a machine or a station focuses it, Esc goes home, Space pauses. It has a
  system picker and an actor picker. `system` is a folder of `../data/`, or `fixture:<name>` for
  `head/fixtures/<name>/trace.json`.
- `gallery.html?system=<name>[&detail=0.5][&play]`: one head per distinct chart of the system (its
  busiest actor, at a busy moment), in a grid. This is the regression sheet.
- `shoot.mjs <out.png> <page?query> [setView JSON] ...`: Playwright stills of either page.
- `fixtures/make.mjs` writes `fixtures/shapes/trace.json`, a hand-made system covering the shapes the
  recorded examples lack. `bench.js` holds what the two pages share.

## The grammar

| Chart | Mechanism |
|---|---|
| parallel state | a **bench**: one machine per region. At the top, three to six regions become two tiers (the biggest machine in front); more regions, or nested benches with four or more, wrap into rows. An atomic or final region is a small machine with one pad. |
| compound state | a **machine**: a painted housing on a plinth. **Closed**: a solid box whose header beam carries the nameplate and **one round lamp per part** (two rows of lamps past 14 parts); the lit lamp is the running part. **Opening** (detail): glass walls, the lid fades, the beam slides down to the plinth, the parts appear. An inactive machine is painted darker; a dead actor's machines go dark. |
| atomic state | a **station**: a pad with an engraved plate. Up to six parts stand in one row; more parts wrap into a **serpentine** of rows (left to right, then right to left), so the main flow reads as one snake and pads never overlap. |
| the active state | **the marble**, one per running machine, on the occupied pad, whose lamp glows (yellow; red on an exceptional part; green on a final). |
| final state | a **drain**: a dark pad with a brass ring round a hole. |
| history state | a pad on the back shelf with a brass **notch** and a plate **H** (shallow) or **H\*** (deep). While its machine is inactive, a **ghost marble** waits on the part it will come back to (deep history: also in every machine inside). When the machine is re-entered at a part other than its initial one, the marble drops onto the notch first and rolls to that part. |
| initial state | a small brass **spout** leaning over its pad; a machine that starts drops its marble in from above. |
| transition between parts | a **track** from pad to pad: brass with sleepers = **main line**, thin red = **exceptional** (rule below). A main and an exceptional transition between the same two parts are two tracks; each keeps to its right, so A→B and B→A are separate; a cone near the end shows the direction. Tracks never taken so far are dim; the last one taken glows for about 2 s. |
| transition out of a compound from any child | drawn **once**, from the compound's pad at the level where it leaves (not from every child). |
| transition the machine itself takes to one of its parts | a **chute** from the machine's hopper down to that pad. |
| self-transition / re-entry | a **loop** standing over the pad. |
| targetless transition (reacts in place) | a small **bell** on a bracket beside the pad. When it fires, the bell rings and the marble hops in place. |
| multiple targets | one track for each part they land in, at the level where the transition is drawn. |
| delayed `<send>` (a `timer` event) | a small **clock** on a stalk beside the station that set it, while the timer runs: its hand and an amber wedge sweep from set to due. It disappears when the timer fires or is cancelled. |
| a hub with many tracks (more than 10) | a **bus**: one raised brass rail over the hub's partners, in their snake order, with a drop over each. A marble between the hub and a partner rides the bus (up, along, down) instead of 64 separate arcs (support-desk's `routing` › `classifying`). |
| `<invoke>` | a green **speaking tube** rising from the pad and leaving over the housing, ending in a **horn**. It glows while its state is active and an invoked child of this actor lives. `outlets()` gives WORLD each horn's world position, so it can lead a line to the child at the next desk. |
| an event arriving | a **mail capsule** drops into the machine's **hopper** (the brass funnel at its back-left corner), then the marble travels. Eventless transitions have no capsule. Mail that moves nothing rings the bell or hops the marble of the deepest active state that has a transition for it, or makes the hopper ring. |
| variables | up to four **gauges** on the roof of the machine that reads each one most: a **glass tube of balls** for an array or object (one ball per item or key), a **dial** for a number, a **lever and lamp** for a boolean, a **lamp** for anything else. Copper **pipes** run to the other machines that read or write the variable; a light runs up the writer's pipe when the trace writes it. Chosen from variables that guards read (if the chart records `readBy`) and that change in the run, ranked by changes + 1.5 × readers. A chart with no datamodel, or nothing that changes, has no gauges and no pipes. |

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
- Within a machine the order is: the initial part, then breadth first along normal tracks, then
  chute targets, then the rest in document order. Exceptional and history parts go to the shelf.
- A nested machine stands behind its own pad at half scale (`NEST`). Nested parts take its depth, so
  the parent grows to hold them.
- The whole head is scaled and centred to 9.4 units of the 10 × 10 × 10 box.

## Big charts: built lazily, opened along the active path

A head builds almost nothing up front. Measuring the whole chart (sizes, places of every station,
the marble's moves) costs no meshes. Meshes are built in three steps:
- **Lite housing**, when the parent first opens: plinth, walls with their top, the beam with its
  nameplate and one instanced lamp strip (about 5 meshes).
- **Full housing**, when the machine starts to open itself: floor, frame, lid, hopper.
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

**Moves of one trace event start together**, after every machine they touch has finished its
previous move, so a parent never leaves a part before the machines inside it have finished. Each
move starts `CAP_LEAD` (0.26 s) after its message arrives (`sim.flight`); a move travels 0.38 s and
a drop takes 0.28 s.

**Bursts**: when the queue lags its trace by more than 0.35 s, moves get shorter. Beyond 1.6 s they
fast-forward: 0.03 s each, and the marble is drawn as a stretched streak (a blur). Forty transitions
in one instant play in about three seconds.

**Lifetimes**: these come from `sim.lifetimes(id)` (several lives, as with pi-durable's kill and
resume), else from `bornAt`/`diedAt`:
- Dead: the housings go dark over 1.2 s.
- Reborn: the next transition or config drops the marble in at the checkpointed part.

Missing `cause`, snapshots or datamodel are fine.

## API (CONTRACT.md, plus)

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
- Pad bases and lamps are two `InstancedMesh`es per machine; sleepers and gauge balls are
  instanced too.
- A 24-part machine is about 130 meshes. The largest example heads (llm-chat clients) are about 290
  meshes.
- `update` takes 0.01–0.12 ms in Node (300 calls over the run).

## What still breaks or is weak

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
