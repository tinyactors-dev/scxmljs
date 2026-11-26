# board/: the telemetry board

The board is a wall screen in the office. It shows the recorded run as a trace, drawn on one 2D
canvas that WORLD maps onto the wall. It is meant to be read from across the room, so it uses large
type, few words, and colour that carries the meaning. The design size is 1600 × 900; the board
scales to any `width`/`height`.

## What it shows

- **Behaviour chips** (top row): the seven `trace.stories`, numbered and coloured (SEND, TOOLS,
  QUEUE, STEER, STOP, OFFLINE, JOIN). A **band of numbered brackets** above the lanes shows when
  each one happened.
- **Header line**: one line of text. It shows the picked behaviour's question, the name of a picked
  message, or the change that a what-if makes. With nothing picked it is empty.
- **Lanes**: one row per participant in the room. The default order is
  `ada, bo, host, terminal, python, llm` (shown as MODEL): people's clients at the top, the host in
  the middle, the machines that do the work below. Time runs from left to right in the shared warped
  time (`sim.warp` of each event's `at`, so the hops within one instant are spread out the same way
  as in the room). The axis is labelled in virtual seconds.
  - **Spans** come from the active states. A solid span means the participant is doing something; a
    hatched span means it is waiting.
    - Host: ASKING THE MODEL (`requesting`, amber), WAITING FOR TOOLS (`tools`, teal hatched),
      BACKING OFF (`backoff`, red hatched), and a thin amber bar over the whole `turn`.
    - Model: THINKING (`connecting`, violet hatched), WRITING (`writing`/`calling`, violet).
    - Clients: RUNNING A TOOL (`working`, teal), OFFLINE (grey hatched), WAITING IN QUEUE (from
      the `queue` data value, yellow hatched), and a faint amber foot line while the client knows
      the host is busy.
    - Before a participant is born or after it leaves, its row is dark and hatched.
  - **Messages** are vertical arrows from the sender's row to the receiver's rows. A fan-out (one
    sender, one event name, one instant) is drawn as one line with an arrowhead on each target. Log
    traffic (`log.batch`, anything sent to `log`, `snapshot.send`) is drawn only as faint ticks at
    the foot of a row. A message to or from something without a row (the stage, the tools on a
    desk) is drawn as a short stub on its one row.
  - **Lamps** beside the names glow in the colour of what each participant is busy with at the
    playhead.
- **Playhead**: a white line with a time handle at the foot of the lanes. Time after it is dimmed.
- **What-if reels** (bottom row): AS RECORDED, MODEL FAILS, PYTHON DROPS, STOP EARLY, NO PYTHON.
  When a what-if is picked:
  - the view frames the run from just before the fork to its end;
  - a magenta dashed line marks the fork;
  - after the fork the lanes show the what-if take in magenta, using the same solid and hatched
    grammar. For model-fails this is the retry rhythm, with the waits growing longer;
  - the recorded run continues only as thin ghost strips at the top of each row, in its own colours,
    so you can see what would have happened;
  - a magenta bar marks where the what-if ends, and the hatching after it shows that nothing more
    happens.
  - The what-if world files are loaded lazily, from `baseUrl` + `worlds/<id>.json`.
- **Picked behaviour**:
  - the view frames its stretch of time;
  - only its rows, spans and messages stay lit, in the story's colour;
  - its steps are joined in order and numbered 1…n on the actors' rows.
- **Picked message**:
  - the view frames its cause chain;
  - the message itself is drawn in yellow;
  - what led to it is drawn in warm white, following the `via`/`cause` links back to the stage;
  - what it led to is drawn in cyan, up to six hops forward, without log traffic.

## Interface

```js
import { createBoard } from "./board/board.js";
const board = createBoard({ sim, width: 1600, height: 900,
  rows,        // optional: actor ids in the room's order (default ada, bo, host, terminal, python, llm)
  baseUrl,     // optional: the data/ directory, for worlds/<id>.json (default: ../../data/ from board.js)
  createSim,   // optional: core/sim.js's createSim, used to make a what-if's sim (else board imports ../core/sim.js)
  now,         // optional: () => ms, the clock used to detect a double tap and idle time (pass the film clock when recording)
});
```

- `canvas`, `dirty`: the board sets `dirty = true` whenever it redraws. WORLD sets
  `texture.needsUpdate` and then `board.dirty = false`. The board caches a static layer (lanes,
  marks, selection) and redraws only the playhead, the lamps and the dimming on `update(t)`. If the
  playhead has not moved by half a pixel, it draws nothing.
- `update(t)`: the playhead, in virtual ms. When a what-if is picked, `t` is that take's time.
  When the view is zoomed and the user has been idle for 2.5 s, the view follows the playhead.
- `pointer(type, u, v, extra?)`: `u, v` in 0..1 board coordinates. `type` is one of:
  - `'down'`, `'move'`, `'up'`, `'leave'`, as in the contract;
  - **`'wheel'`** (an extra): `extra` is a `deltaY` number or `{dy, dx}`. `dy` zooms around `u` and
    `dx` pans.
- `on(event, fn)`: returns an unsubscribe function.
- `highlight({actorId?, messageId?})`: the room's selection. A row lights up; a message shows its
  cause chain and the view frames it. It emits nothing. `highlight({})` clears it.

### Gestures

| Gesture | Result |
|---|---|
| Tap a behaviour chip or bracket | Frames the behaviour. Emits `select` and `seek` to its start. Tap it again to unpick it. |
| Tap a message mark | Shows its cause chain. Emits `select` and `seek` to the message. Tap it again to unpick it. |
| Tap a span | Emits `seek` to the span's start and `select` for its actor. |
| Tap a row's name | Lights the row. Emits `select` for that actor. |
| Tap an empty lane, or the axis | Emits `seek`. |
| Drag the playhead handle, or drag anywhere in the lanes | Scrubs: emits a `seek` on every move. |
| Drag along the axis strip | Pans. |
| Tap a reel | Emits `world` and overlays that take. Tap AS RECORDED to clear it. |
| Wheel, or a pinch (call `zoom`) | Zooms around the pointer. |
| Double tap in the lanes | Home: the full view, nothing picked. |

### Events

| Event | Payload | When |
|---|---|---|
| `seek` | `{t}` (virtual ms) | A tap on a lane, the axis or a span; a scrub; picking a behaviour (its start) or a message (its time) |
| `select` | `{actorIds, messageIds, storyId}` | Picking a behaviour: its actors, including externals such as `stage`, `llm` and `tools.*`, and its message ids |
| | `{actorIds, messageIds, chainIds, storyId: null}` | Picking a message: the bundle's ids. `chainIds` (an extra) lists every event in the drawn chain |
| | `{actorIds: [id], messageIds: [], storyId: null}` | Tapping a span or a row's name |
| | `{actorIds: [], messageIds: [], storyId: null}` | Unpicking, or a double tap home |
| `world` | `{worldId \| null}` | Tapping a reel. It is emitted at the tap, before the file loads; the overlay appears when the file has loaded |

### Extras

- `zoom(factor, u)`, `pan(dxDesignPx)`, `resetView()`.
- `selectStory(id|null)`, `selectWorld(id|null)` (returns a promise), `selectMessage(id)`. These
  emit events, as taps do.
- `loadWorld(id)`: a promise that preloads a world file. Use it for film mode, so that a pick takes
  effect in the same frame.
- `warp(t)` / `unwarp(s)` / `duration`: the board's current time axis. This is `sim.warp` for the
  recorded run, and the what-if's own warp when one is picked. It continues linearly past a take's
  end.
- `locate({messageId | storyId | worldId | t[, actorId] | actorId})` returns `{u, v}`: where
  something is drawn. Use it for scripted pointers.
- `state`: `{t, storyId, worldId, messageId, view}`.
- `rows`, `dispose()`.

## What WORLD must forward

- Every frame: `board.update(t)`. Upload the texture when `board.dirty`, then set
  `board.dirty = false`.
- Raycast hits on the screen: `down`, `move`, `up` and `leave` as `(u, v)`, with `v` = 0 at the top.
  Also forward the wheel over the screen as `pointer('wheel', u, v, {dy: e.deltaY, dx: e.deltaX})`.
  For a pinch over the screen, call `board.zoom(distanceRatio, uMid)`.
- On `seek`, jump the room to `t`. On `select`, light the actors and messages it names. On `world`,
  play that take, then drive `update` with that take's `t`.
- When the visitor picks a person or a capsule in the room, call `highlight({actorId, messageId})`.

## Files

- `board.js`: the board. Its only import is a dynamic `../core/sim.js`, used for what-ifs when
  `createSim` is not passed.
- `test.html`: the board shown flat at full size, and beside it the same board at one-third size on
  a wall tilted with a CSS 3D transform. The trace plays in a loop, the emitted events are logged,
  mouse, touch, pen, wheel and pinch all work, and Space pauses. `?film=1` is the scripted mode,
  with `window.frame(i)`.
- `shots.mjs`: `node board/shots.mjs` writes the stills in `out/`; `node board/shots.mjs --film`
  writes `out/board.mp4`. Serve from `prototypes/viz3d/` (`shots.mjs` runs its own server).
