# The Office: one world, three builders

The owner's brief (verbatim, 2026-11-26), after rejecting four rounds of abstract visualizations:

> Okay, here's one more thing to try (with no labels/wall of text)
> Each actor and ioprocessor is a 3d object (think Minecraft style avatar)
> Selecting one shows me its state and its nested state machines again in 3D (compare to the
> semantic zoom of statecharts).
> Telemetry/traces can be a separate 2d surface to interact with in that world.
> Messages should travel along some lines, visibly.
> Maybe the first model is an office building, each actor sitting in a cubicle, messages being
> paper mail traveling through an old vacuum tube postal system.
> I hope that this way I could see Alice's and Bo's clients as little people working at a desk,
> and then when I go through the office, I can interact with their avatars to see nested
> statecharts (maybe anatomically incorrect "organs" / "machines" in their brains, or objects on
> their desk)
> You get the idea!

What we learned before this (read `../LESSONS.md`, then forget its feature lists): earlier
prototypes were films with captions, abstract spaces that had to be learned, label pile-ups and
side panels. This one is a PLACE you walk through and poke. Rules:

- **No floating labels, no side panels, no caption bar, no legend.** Text exists only as things
  in the world: a nameplate on a desk, a slip of paper inside a mail capsule, an engraved plate
  on a machine, the telemetry board. Small, and readable only when you are near it.
- **State is shown by what things DO**: posture, animation, lamps, positions of mechanisms,
  paper piling up. If you need a word to tell idle from busy, the design failed.
- **It is live and playable** (mouse, keyboard, touch), replaying the recorded run in a loop.
  A film is recorded from the same page, but the page is the deliverable.
- Blocky, friendly, low-poly (boxes; original design, no existing game's characters or textures).
  No external assets: geometry and canvas-drawn textures only. three.js 0.170 vendored locally.
- Data: `../data/trace.json` (+ `../data/worlds/*.json`), see `../SCHEMA.md`, `../data/README.md`.
  Never edit `../data/` or other prototype directories.

## Ownership (work only in your own files; integration is the world builder's job)

| Builder | Owns | Standalone test page |
|---|---|---|
| WORLD | `index.html`, `main.js`, `core/` (sim, input, camera), `world/` (building, avatars, desks, tubes, capsules), `record.mjs`, `out/` | `index.html` |
| HEAD | `head/` (what you see when you select someone: their nested state machines as machines) | `head/test.html` |
| BOARD | `board/` (the telemetry board: a 2D surface in the world) | `board/capture.mjs` (`board/old/test.html` is the earlier board's page) |

## Shared interfaces (ES modules; WORLD delivers `core/sim.js` FIRST, within ~10 minutes; until it
exists HEAD and BOARD write a 30-line stub of the same shape in their own directory)

```js
// core/sim.js: the recorded run as a pure function of time. No three.js in here.
export async function loadSim(traceUrl) -> Sim
Sim.trace                      // the raw trace JSON
Sim.duration                   // ms of virtual time
Sim.actors                     // [{id, chart, label, role, bornAt, diedAt?}] + externals as [{id, label, kind, external:true}]
Sim.chartOf(actorId)           // trace.charts[...] (root StateNode, datamodel, purpose) or null for externals
Sim.activeAt(actorId, t)       // string[] of active state ids (all ancestors included); [] if not alive
Sim.valuesAt(actorId, t)       // {var: value} from the latest snapshot at or before t
Sim.messagesBetween(t0, t1)    // message events with t in [t0, t1): {id, t, from, to, name, summary, cause, via}
Sim.transitionsBetween(t0, t1) // transition events: {id, t, actor, event, from[], to[], cause}
Sim.stories                    // trace.stories
Sim.warp(t) / Sim.unwarp(s)    // virtual ms <-> playback seconds (idle gaps compressed, bursts stretched); shared by everyone

// What HEAD exports (head/head.js). WORLD calls it; HEAD never touches the world's scene.
export function createHead({ THREE, sim, actorId }) -> {
  group,                       // THREE.Group, local units: fits inside a 10 x 10 x 10 box centred on origin, y up
  update(t, dt),               // t = virtual ms; animate to the state at t (called every frame while open)
  setDetail(d),                // 0..1 from the camera: 0 = seen from outside, 1 = right inside (semantic zoom)
  pick(raycaster) -> {kind:'state'|'transition'|'variable', id, object}|null,
  focus(stateId|null),         // zoom target inside the head; null = whole head
  dispose()
}

// What BOARD exports (board/board.js). It draws on a canvas; WORLD puts the canvas on a wall.
export function createBoard({ sim, width, height }) -> {
  canvas,                      // HTMLCanvasElement (WORLD wraps it in a CanvasTexture and sets needsUpdate when `dirty`)
  dirty,                       // boolean, set true by the board when it redrew
  update(t),                   // playhead at virtual ms t
  pointer(type, u, v),         // 'move'|'down'|'up'|'leave' at board coordinates u,v in 0..1 (WORLD raycasts the wall)
  on(event, fn),               // 'seek' -> {t}; 'select' -> {actorIds, messageIds, storyId?}; 'world' -> {worldId|null}
  highlight({actorId?, messageId?})  // WORLD tells the board what the visitor selected in the room
}
```

Time: one clock. `t` is always virtual ms of the trace; playback speed and looping belong to WORLD.
Film mode: everything must be a pure function of (t, scripted camera, scripted pointer) so
`record.mjs` can step it frame by frame.
