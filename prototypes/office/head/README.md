# HEAD: a person's statechart, built as machines

`head.js` exports `createHead({ THREE, sim, actorId, options? })` exactly as `../CONTRACT.md` says.
It imports nothing (WORLD passes `THREE`), adds no lights (WORLD's lights do; it uses
`MeshStandardMaterial`), draws no text except small engraved plates on the machines.
`test.html` is the standalone bench (orbit with the mouse, **wheel = detail**, click a machine or
station = focus, Esc = home, Space = pause, actor picker, time scrubber in playback seconds).
`shots.mjs` (+ `shots.json`) writes stills to `out/`; `film.mjs` writes `out/head.mp4`.

## The grammar (learn it once, it is the same for every chart)

| Chart | Mechanism |
|---|---|
| parallel state | a **bench**: one machine per region, side by side (the host's model, conversation, inbox, roster). A top bench with many regions becomes two tiers: the biggest machine in front, the rest on a raised step behind. |
| compound state | a **machine**: a painted housing on a dark plinth. **Closed** it is a solid box whose front header beam carries its nameplate and **one round lamp per part**: the lit lamp is the part that runs. **Opening** (detail): walls and lid turn to glass, the header beam slides down to the plinth, and the parts appear inside. A machine whose state is not active is painted darker. |
| atomic state | a **station**: a round pad on the machine's floor, with a small engraved plate in front. |
| the active state | **the marble** (a pale blue-white ball): exactly one per running machine, sitting on the occupied pad, whose lamp glows yellow (red for an exceptional state). |
| final state | a **drain**: a dark pad with a ring round a hole. |
| history state | a pad with a brass **notch** beside it (none occur in this run). |
| initial state | a small brass **spout** leaning over its pad: when the machine starts, the marble drops in from above onto that pad. |
| transition between parts | a **track** from pad to pad: **brass with sleepers = main line**, **thin red = exceptional** (an event like interrupt, error, timeout, leave, retry; a guard reading an error; or an end in an exceptional state such as backoff, offline, failed, rejected, left). Each track keeps to its right, so A→B and B→A are two tracks; a small cone near its end shows the direction. |
| transition the machine itself takes to one of its parts | a **chute** from the machine's hopper down to that pad (the host's `requesting` → thinking / writing / calling). |
| re-entering a part | a **loop** standing over its pad (conversation's `turn` loop, a client's `joining` retry). |
| exceptional parts | stand on a **dark shelf** behind the main row; tracks to them are red. |
| an event arriving | a **mail capsule** drops into the machine's **hopper** (the brass funnel on a post at its back-left corner) when the message arrives (`sim.flight(m)[1]`), then the marble travels the track. A message that moves nothing (a targetless transition, a guard that fails) still drops its capsule and **makes the marble hop in place** on the station that heard it (a client's `live` station gets one per `log.batch`), or makes the hopper ring. Eventless transitions have no capsule: the marble just rolls. |
| the possible vs the travelled | a track never taken so far is **dim**; once taken it is full brass/red; the last one taken **glows** for ~2 playback seconds. |
| datamodel | up to four **gauges** per head, on a rack on the roof of the machine that reads them most: a **glass tube of balls** = list or map (one ball per item/key; blue = map, orange = list), a **dial** with an odometer = number, a **lever + lamp** = boolean, a **lamp** = anything else (lit when set). Copper **pipes** run from the gauge to the other machines that read or write it; when the trace writes the value, a light runs up the writer's pipe into the gauge, which flashes, and then shows the new value. Variables chosen: those that guards read and that change in the run, ranked by changes + readers (host: steers, pending, clients, request; client: queue, running, granted...). |

Seen from afar (detail 0) a head is a few coloured boxes with lamps and hoppers: you read which
machine runs which part by the lit lamp, and mail dropping into hoppers. Closer, the boxes turn
to glass and the marbles and tracks inside appear; inside them, smaller closed machines with
their own lamps, which open in turn. The host has three levels:
conversation › turn › requesting › {connecting, thinking, writing, calling}.

## Layout rules (automatic from the chart, no hand placement)

- The `__root__` wrapper is skipped when it has a single compound/parallel child.
- In a machine, parts are ordered by meaning: the initial state first, then breadth-first along
  main (non-exceptional) tracks, then the targets of the machine's own chutes, then the rest;
  exceptional states go to the back shelf.
- A nested machine sits behind its own pad at half scale (`NEST = 0.5`); its pad is where the
  parent's marble rests while it runs.
- A nested bench of four or more regions is split into two rows (order kept); the top bench into
  tiers when it is much wider than deep.
- The whole is scaled and centred to fit 9.4 units of the 10 × 10 × 10 box.

## Time

`update(t, dt)` uses only `t` (virtual ms), through `sim.warp` (playback seconds), and the current
detail/focus. Per machine the marble's moves come from `sim.transitionsBetween` (which parts of
the machine a transition exits and enters), in trace order, each starting `CAP_LEAD` (0.32 s)
after its triggering message arrives, travelling for `TRAVEL` (0.46 s), never overlapping the
previous move of the same machine. So in film mode every frame is reproducible. `dt` is ignored.

## Knobs for WORLD

- `setDetail(d)`: 0 = all closed, 1 = everything open. Level L of `head.levels` opens over
  `d ∈ [(L-1)/levels, L/levels]`.
- `focus(id)`: a state id (machine or station) or null. While focused, the machines on the path
  to it open over the whole detail range so that `d = 1` opens the focused one; others follow the
  plain mapping. Returns and exposes `focusBounds` = `{center, radius, box, object}` in **world**
  coordinates (a getter, recomputed when read). Fly the camera to `center` at about `2.3 × radius`;
  the test page lerps the target from the head's centre to `center` as detail rises
  (`camGoal` in `test.html`).
- `pick(raycaster)` → `{kind: 'state'|'transition'|'variable', id, object, point}`. Transitions
  are named `<machine>:<from>-><to>` (`*` = the machine's own chute). Open machines let the ray
  through their glass.
- Extras: `boundsOf(id)`, `pathTo(id)` (machine ids from the top), `states()`,
  `movesOf(machineId)` (`[{start, end, from, to, ev}]` in playback seconds), `levels`, `detail`,
  `focusId`.
- `options.maxGauges` (default 4).
- Cost: host ≈ 280 meshes, a client ≈ 330; sleepers are one `InstancedMesh` per machine, tube
  balls are instanced; `update` takes about 0.1 ms. Textures: one small canvas per plate text.
- Externals (no chart) get a sealed crate.
