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
| 1 | `modes` | The app's own modes as a statechart run by scxmljs itself: overview → person → head → machine focus → reading a slip → board time travel; live vs replay. Events in: pick, escape, arrive. Actions out: camera goals, what is pickable, what is lit. | `sel.stage` flags and the click/back/key code in `main.js` |
| 2 | `pick` | A registry: anything clickable registers `{object, kind, id, hover(), click(), cursor}`; one raycast path for world, head and board; hover and cursor state. | the hand-kept `cands` list, the head's and live controls' separate picking |
| 3 | `camera` | A director: goals ("frame this person and their desk", "inside this head", "this machine", "home"), eased moves, collision against registered boxes, minimum distance from any surface, no motion without a goal or input. | `flyTo`, `walkTo`, `enterHead`, `homeView`, per-film camera paths |
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
