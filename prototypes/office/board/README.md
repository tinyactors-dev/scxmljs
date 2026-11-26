# board/: the wall board

The board answers one question about the system, big enough to read from across the room:
**who just sent mail to whom, and what state is each of them in now.** It is a sequence diagram whose
participants are the people and stations in the room.

```
  |            |              |
  |  ●───TURN ON──────▶ [COOKING · CLOSED]      a row: one piece of mail, in the capsule's colour,
  |            |   [COOKING · CLOSED]↻ TIME     and the state the receiver went into
NOW ─────────────────────────────────────────   the newest row arrives here, the others rise
  |            |   [ COOKING · CLOSED ]         the plate: the state each is in now
  |   [▣▣]     |        [face]                  the foot: the station, or the person's face
  |   YOU      |      MICROWAVE                 ▼ pointing down at them in the room
```

## A window onto the diagram

The diagram is laid out at a fixed, legible size: every column is as wide as its full name and its states need
(names 32 px, plates 42, chips 34, mail names 30, in the 1600 x 900 design space), and nothing is truncated or
thrown away. The board is a window onto it, like a small browser: what does not fit scrolls.

- **Scroll** with the wheel or a trackpad's two fingers (up: back through history; sideways: across the columns;
  over the faces, or when the history fits, the wheel goes sideways), or drag the history. Scrollbars appear only when
  there is more than fits, and their thumbs drag. The camera never moves while the pointer is on the board.
- **It follows now, like a chat window**: pinned to the NOW line at the bottom, and sideways to the newest arrow (both
  ends when they fit), until you scroll up. Then "▼ NOW" appears; touch it to follow again. Scrolling back to the
  bottom follows again too.
- **Sticky**: the NOW line, and the foot of every column (state plate, face, name) stay on screen; the foot scrolls
  sideways with its column.
- **Scrolling only looks; the scrubber moves time.** In a recorded run the scrubber is a media bar across the top
  (the run's mail as coloured ticks, a knob at the playhead). The two are never the same gesture: the bar is the only
  thing on the board that changes time, besides touching a row (which goes to that row's moment).
- **Touch the board anywhere that is not a row, a face, a plate or a control** (its margin, empty history): the
  camera goes to stand squarely in front of it, filling the screen like a browser window. Escape goes back to where
  you were.
- Selecting a person in the room scrolls their column into view; opening a capsule scrolls its row's columns into view.
- Hovering a row puts the room's hover ring on its receiver (one ring: the room has one).

## What each part answers

## What it no longer shows (and why)

The board was a telemetry trace viewer (`old/`, kept for reference; delete it when nobody misses it): a Gantt chart of
situation spans, behaviour chips and episode brackets, swarm lanes, mass-death bars, axis breaks, what-if reels, a
millisecond axis. From the room none of it could be read, and none of it was tied to the people: rows were labelled
with ids, the time axis was the only clue to now, a recorded run drew its whole future, and episodes and chips
needed the README to be understood. Rates and counts answered no question a newcomer has.

## Interface

```js
const board = createBoard({ sim, width, height,
  room,       // optional () => ({ people, stations, playS }): columns are the room's desks and stations
  live,       // a live run: no scrubber, nothing after now
  capsules }); // office.json's capsule colours by family
```

`canvas`, `dirty`, `update(t)`, `pointer(type, u, v, extra)` (`down`, `move`, `up`, `leave`, `wheel` with
`{dx, dy}`; v = 0 at the top), `on(event, fn)`, `highlight({actorId?, messageId?})`, `scroll(dx, dy)`, `follow()`,
`locate({actorId})` → `{u, v}` (film.js), `columns`, `rows`, `state` (`{pinned, scrollX, viewTop, contentH,
contentW, viewW, viewH}`).

| Event | Payload | When |
|---|---|---|
| `seek` | `{t}` | A row touched (just before its mail left), the scrubber dragged |
| `select` | `{actorIds, messageIds, storyId: null}` | A row, a face or a plate touched |
| `hover` | `{actorIds, messageIds}` | The pointer moves onto or off a row, a face or a plate (receiver first) |
| `focus` | `{}` | The board's empty part touched: main.js flies the camera in front of it (Escape: back) |

## Files

- `board.js`: the board.
- `capture.mjs <tag> [live:<id> | system:<id> ...]`: stills of the start view, the board close up and the board's
  canvas, at rest and after a few presses (live) or at three moments and one mid-flight (recorded), into
  `out/board/<tag>/`.
- `capture-scroll.mjs [target...]`: the board as a window: start view, the camera in front of it, scrolled sideways
  and up into history, time running while scrolled up, "jump to now", the scrubber dragged, Escape; into
  `out/board/scroll/`.
- `capture-touch.mjs`: the links to the room in order-api (a person selected in the room lights their column; a
  row tapped through `perform` lights its people and mail) into `out/board/after/touch-*.png`.
- `old/`: the previous trace board, its test page, stills script and fixtures.
