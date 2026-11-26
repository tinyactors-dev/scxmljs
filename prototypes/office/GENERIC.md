# Making the Office generic

Owner (2026-11-26): "This is great, you can ship this as an unlisted prototypes section and page.
Then make it generic: I should be able to put any system of statecharts in there and get a usable
3d world. I want your subagents to try this with all of the examples, as well as spawning/dying
actors (e.g. the Pi Durable example, adding/removing clients and executors, etc)."

Today the Office replays ONE recorded run (examples/llm-chat) and knows that system by name:
pose tables per chart, a floor plan with hand-picked seats, desk objects chosen per chart, board
span names like "ASKING THE MODEL", character choices per external. Generic means: hand it any
system's trace and it builds a usable world with no code written for that system.

## The input: a system trace (`data/<system>/trace.json`)

`SCHEMA.md` (v1 + v2 + v3 fields). REQUIRED for a world: `charts` (state trees with kinds,
transitions; datamodel if any), `actors`, `externals`, `events` of types spawn, end, config,
transition, message, and data/snapshot when the system has a datamodel. OPTIONAL, used when
present, never required: `purpose`/`doc` texts, `wiring`, `cause`/`via`, `stories`, `worlds`,
`caption`. The Office must degrade gracefully when optional parts are missing.

A per-system `data/<system>/office.json` MAY exist to override defaults (a character for an
actor, a pose for a state, which variables sit on the desk, display names). It is a convenience:
the world must be usable WITHOUT it. Anything llm-chat-specific that survives moves into
`data/llm-chat/office.json`.

Systems are chosen with `?system=<name>` (default llm-chat); `data/index.json` lists them.

## What "usable for any system" means (the acceptance test for every example)

1. It loads with no errors and nobody overlaps: any number of actors (1 to ~60), any number of
   externals, laid out automatically (who talks to whom most sits near; hubs in the middle).
2. Actors that spawn during the run arrive and get a place; actors that end leave and their
   place is visibly vacated and can be reused; hundreds of short-lived actors over a run must not
   exhaust the floor (e.g. Pi Durable tasks, per-request child machines, invoked children).
   Invoked child charts are visibly attached to their parent (an assistant at the next desk, a
   visitor's chair) and go when the invoke ends.
3. Without any per-system table you can tell, from posture and activity alone: who is idle, who
   is working, who is waiting for someone, who is in an error/exception state, who is done.
   Derive this from the chart and the run (kinds, finals, invokes pending, what a state waits
   for, main route vs exception heuristics already in head.js), not from state names of one system.
4. Mail flows in tubes for every message, between any pair, including actor ⇄ external, self
   sends (delayed sends = a timer on the desk), broadcasts; no tube spaghetti at 20+ actors
   (trunks via a hub/ceiling manifold).
5. The desk shows the datamodel generically by type (number, boolean, string, array, object),
   choosing the few variables that matter by how often they change and are read by guards.
6. Selecting anyone opens their head for ANY chart: flat charts, deep nesting (4+ levels),
   wide charts (20+ sibling states), parallel regions, history, finals, charts with no datamodel.
7. The board shows any system: rows chosen automatically, span names from state names/docs,
   behaviours only if `stories` exist (otherwise episodes derived from causality: each external
   stimulus and what it led to), what-if reels only if `worlds` exist.
8. Still no floating labels, panels, captions. Text only on things in the world.

## Getting traces: the tracer

`tracer/` is a reusable recorder for any @tinyactors/scxmljs system: wrap session creation and
I/O processors, run the system on a VirtualClock, emit `trace.json` in the schema, including the
static chart parse (states, transitions, actions, datamodel, wiring), configs, transitions with
their triggering event, messages between sessions and to/from I/O processors and invokers,
spawns/ends of invoked and created sessions, datamodel snapshots, and cause/via links read from
the engine where possible. It must not need per-system code beyond a small driver that boots the
system and feeds it input. (Later: the same tracer attached to a system running live in the
page; design the event stream so it can be consumed incrementally, but replay comes first.)

## Ownership (work only in what you own; say in your report if you had to touch anything else)

| Role | Owns |
|---|---|
| SHIP | `site/` integration, the build step that publishes `prototypes/office/` to `/prototypes/office/`, the unlisted `/prototypes/` index; `prototypes/office/index.html` head/meta only |
| WORLD | `prototypes/office/main.js`, `core/`, `world/`, `film.js`, `record.mjs`, `data/index.json`, `data/*/office.json` |
| INSIDE | `prototypes/office/head/`, `prototypes/office/board/` |
| TRACER | `prototypes/office/tracer/` and the drivers in `prototypes/office/tracer/drivers/` |
| EXAMPLES (later) | `prototypes/office/data/<system>/` and `prototypes/office/reports/<system>.md`; never the code: file problems in `reports/` for the owners |
