# Consolidation: a tiny engine under the Office

Owner (2026-11-26): "Do we have working abstractions for all of these things in place (like a
tiny game engine), or is everything special cased and we're spending all of our thinking effort
on catering to special cases?" Answer: the data side is abstracted (`core/sim.js`,
`core/situation.js`, `core/plan.js`, `core/desk.js`, the `createHead`/`createBoard` contracts);
the rendering and interaction side is not. Decision: finish the quality round and the live mode,
then consolidate before adding anything else.

This is the plan for that pass. It adds no features. Success is: the same world, the same
behaviour, on eight small pieces, with `main.js` reduced to wiring; every later fix lands in one
place instead of in each builder's copy.

## The pieces (`engine/`, each a small module with a check)

| # | Piece | What it owns | Replaces |
|---|---|---|---|
| 1 | `modes` | The app's own modes as a statechart run by scxmljs itself: overview → person → machine room → machine focus → reading a card → board time travel; live vs replay. Events in: pick, escape, arrive. Actions out: camera goals, what is pickable, what is lit. | `sel.stage` flags and the click/back/key code in `main.js` |
| 2 | `pick` | A registry: anything clickable registers `{object, kind, id, hover(), click(), cursor}`; one raycast path for world, head and board; hover and cursor state. | the hand-kept `cands` list, the head's and live controls' separate picking |
| 3 | `camera` | A director: goals ("frame this person and their desk", "this person's machine room", "this machine", "home"), eased moves, collision against registered boxes, minimum distance from any surface, no motion without a goal or input. | `flyTo`, `walkTo`, `roomEntryView`, `homeView`, per-film camera paths |
| 4 | `rig` | Jointed figures: fixed limb lengths, joint limits, two-bone reach, look-at; poses declared as goals (sit, type, reach socket X, look at Y), one-shot reactions on a track; intersection check as a test. | joint-angle tables in `world/avatar.js`, pose blending in `world/people.js` |
| 5 | `sockets` | Named attachment points on props and people (desk.tray, desk.tubeMouth, desk.timer, head.crown, station.panel); things attach to sockets, never to coordinates; tubes are routed socket to socket. | hand-placed offsets in desks, tubes, stations, live controls |
| 6 | `plates` | One text-on-objects kit: canvas textures with mipmaps, a minimum legible size per viewing distance, fit/wrap rules, a screen-space overlap check for tests. | each builder's own label drawing (world, head, directory, live controls) |
| 7 | `clock` | One interface, two implementations: replay (warped, looping, seekable) and live (virtual time that advances only on demand, growing trace). `sim` reads from it; nobody else keeps time. | `playS`/`paused`/speed in `main.js`, the live driver's own cursor, film stepping |
| 8 | `harness` | The visual regression tools as one thing: close-up contact sheets per pose/prop/head/system, limb-intersection and plate-overlap checks, "nothing moves when paused", every system loads clean. Runs in CI's light mode. | the scattered `shots.mjs`, `tools/inspect`, `head/shoot`, `board/shots` |

## Rules for the pass

- Behaviour-preserving: before touching a piece, the harness records its current output; after,
  it must match or be a deliberate, listed improvement.
- One piece at a time, in dependency order: harness → clock → pick → modes → camera → sockets →
  plates → rig. Commit after each.
- `head/head.js` and `board/board.js` are split along their own seams (layout, run, render,
  pick) and moved onto `pick`, `plates`, `camera` goals and `clock`; their contracts stay.
- No new per-system code. Anything a system needs beyond the trace stays in its `office.json`
  or its live definition.
- The modes statechart is a real `.scxml` file in the repo, and the Office can show its own
  modes as a person in the room: the prototype explains itself with itself.
- Done means `main.js` is wiring only (target: under 120 lines, no dense one-liners), and each
  engine module has a header saying what it owns and what it must never know about.

## Started: the flight recorder (2026-11-26)

The first real piece of `harness` is in `engine/`: `log.js` (one event stream per session),
`view.js` (what is in frame, readable plates) and `recorder.js` (the box by the door), with
`tools/replay.mjs`, `tools/analyse.mjs` and `tools/explore.mjs` (LOGGING.md). Built for the pieces
that come next: `perform(action)` in main.js is the one place where a visitor's intent becomes
behaviour (the seed of `modes`: its actions are the statechart's events, and the log's `act` channel
replays them); the camera rig reports flights, arrivals, interruptions and pushes through one `log`
callback (`camera` adopts it as is); the recorder keeps the app's clock (`appNow`) beside the wall
clock (`clock` replaces both); `?replay=1` takes time and pose from outside, which is the `clock`
and `camera` interface a director will need anyway.

## The machine room (2026-11-26)

Owner: "when we're inside someones head, it can just be kind of a separate scene to enter and leave and doesn't
need to be physically located in the person's head." A person's machines now stand in a scene of their own
(`world/machineroom.js`); `main.js` draws either the office or that room (`render`), and swaps the camera's pose
between them in the middle of an iris (`engine/overlay.js`, `enterHead` / `leaveHead` / `stepTrans`), giving back
exactly the office view the visitor left. What went with the walk-in head: the hinged lid and the hollow in the
avatar, `skinHidden` (hiding the selected person's body), the head's own attic room and the skull box, the head
scaled to 0.042 and anchored to a moving person, the near-plane and field-of-view easing for a camera inside a
head, and the walk limits under the dome. The overlay is also where the opened capsule's card is drawn: always on
top, always on screen, closed by its stamp, a tap on the floor or Escape. Both belong to the future `plates` and
`modes` pieces; the swap is the first place where `camera` needs a goal in another scene.

