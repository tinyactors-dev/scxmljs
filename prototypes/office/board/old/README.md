# board/: the telemetry board, for any system

The board is the one 2D surface in the office: a wall screen that shows the recorded run as a trace.
It is drawn on a canvas at a design size of 1600 × 900 and scaled to `width`/`height`. It is meant
to be read from across the room: large type, few words, and colour that carries the meaning.
**Nothing in `board.js` knows a system by name.** Rows, span names, colours, behaviours and reels
all come from the trace.

## What it shows

### Rows (chosen automatically)

- **Long-lived actors** get one row each.
  - Rows are grouped by chart kind; charts built from the same `source` file count as one kind.
  - The group with the most traffic per member (the hub) sits in the middle.
  - An actor that comes back under a new id gets one row with gaps, and its label shows `×N`. This
    applies when the new id has the same chart kind and the same `identity` or label, and the two
    lifetimes do not overlap (for example `harness` → `harness~2`, or `python` → `python~2`).
- **Swarms.** Short-lived actors of one kind collapse into one swarm lane, labelled
  `KIND ×N` with `≤k at once`. A group becomes a swarm when it has more than 12 members, or when
  at least 4 members exist and at least 60 % of them live less than 35 % of the run (3 members are
  enough when there are more than 10 individual rows). Members that live at least 60 % of the run
  keep their own rows.
  - **Collapsed**, the lane is a stacked occupancy band: how many members are alive, and how many
    of them are working, waiting, in an exception or idle at each moment. A green tick on top marks
    each spawn. A tick at the foot marks each end, red when the member ended failing.
  - **Expanded** (touch the lane's name), members are packed into tracks by lifetime. Each track
    shows one member at a time, with its spans, birth notch and end cap.
- **Invoked children** sit in a slim sub-row (`↳ KIND ×n`) directly under their parent. A child
  counts as invoked when the parent's chart has an `<invoke>` whose `src` is the child chart's
  `source`, or whose id ends the child's id. The sub-row uses packed tracks; with more than 3
  tracks it becomes a collapsed swarm.
- **Externals** that both send (2 or more messages) and receive (1 or more) get a slim row, at most
  4. The row shows a busy span from each request until the last answer to that requester.
- **One actor** (a single chart): the board becomes that actor's state timeline. It has one lane
  per parallel region, or one lane for the whole chart, and shows every state, including idle.
- **Quiet lanes** get half the height. A lane is quiet when it is busy less than 2 % of its life
  and has fewer than 3 messages per actor.
- An actor with no transitions and no messages gets no row.

### Spans

- **Source.** When the sim has `situations(id)`, the spans are WORLD's situation classifier. When it
  does not, the board derives them itself from the active states, the chart (finals, exceptional
  names and events, invokes) and how each state was left in the run:
  - left by someone else's message → idle;
  - left by itself → working;
  - left by a timer or a delayed self-send → waiting;
  - entered after sending a request, then left by the answer → waiting.

  The same derivation corrects one case of the classifier. When the classifier says `idle` but
  every active leaf is a working or waiting state (a job busy in `running`, a reminder in `sleep`),
  the span takes that state's kind.
- **Colour = situation kind**, one palette for every system:

  | Kind | Look |
  |---|---|
  | working | solid teal |
  | waiting | hatched amber |
  | exception | red |
  | done | hatched grey |

  Idle is drawn only in the single-actor timeline.
- **Names** come from the most specific active state, made readable (`payment-failed` →
  PAYMENT FAILED). For working and waiting, the board uses the leaf the latest transition entered.
  It shortens a name to its last word, its first word, or `ABC…` to fit.

### Marks

- **Messages**:
  - between two rows: a vertical arrow, with fan-outs bundled into one mark;
  - to or from an external's slim row: two short stubs, not a line across every row. A behaviour
    or a hover draws the full line;
  - to something without a row: a stub on the actor's own row;
  - chatter (a name with 20 or more messages, at least 12 % of all traffic, that almost never makes
    its receiver change state, such as a log): faint ticks.
- **Births and ends.** A green notch marks a birth. A cap marks an end: red for an exception or a
  failed final state, grey for done, pink for an end with no final state.
- **Mass death.** A full-height red bar tagged `✕ n` marks one. It is detected when 3 or more actors
  end within a short window, they are at least half of those alive, and most of them did not reach
  a final state.
- **Rebirth.** A green bar tagged `↻ n` marks one: the same names (`identity` or label) spawning
  again after the death.
- **Axis breaks.** A zigzag across the lanes with `+4 min` on the axis marks a quiet gap of
  20 s or more, or a gap that is 20 % of a short run.
- **The axis** labels ticks as `350ms`, `12.5s` or `4m10`, at a step that adapts to the zoom.

### Tracer conventions honoured

- **Reborn actors**: new ids with `identity` + `incarnation`. Same kind and same `identity` with
  lives that do not overlap → one row with a gap (`×N`); a rebirth counts the incarnation ≥ 2 spawns
  of the dead identities.
- **`end.reason`**: `done` = a grey bar; `cancelled` = an amber bar with a slash; `disposed` = a red
  ✕ (in a swarm's foot: grey, amber, red ticks). When the trace has reasons, a mass death = 2 or more
  `disposed` ends at one instant (otherwise the older heuristic: many unfinished ends at once).
- **Timers**: a `timer` set by the actor itself is pending from the set until `due`, its `cancel`, or
  the actor's end; an idle stretch under it is WAITING (hatched) and the span ends at the due time.
- **Derived stories** (`derived: true`) are named after their first message and grouped like episodes.
- **Single actor**: a main lane (the deepest state outside any parallel state) when parallel states
  are not active ≥ 90 % of the life, plus one lane per region when they are active ≥ 25 %.
- **Invoked children**: same-kind children that come and go share packed tracks; distinct long-lived
  children each get their own `↳` sub-row (support-desk's 14 intakes, teams and monitors).
- **Lane names**: shrink, then drop a parenthetical (sub-rows, externals), then wrap to two lines,
  and only then cut. Sibling sub-rows share one type size.
- **Ordering**: within a kind, rows form a chain from the busiest, each next to the one it talks to
  most. Picking an episode inside a collapsed swarm opens it (and closes it again when unpicked).

### Behaviours (the chips)

- **With `trace.stories`**: as before, one chip per story, numbered steps, and the story's question
  in the header. If the story ids are generic (`episode-3`), a chip is named after the story's first
  message. With more than 7 stories, the chips group by that name (`UI SUBMIT ×5`).
- **Without stories: episodes.** Each uncaused stimulus (a message or spawn with no `cause`/`via`)
  plus its causal closure is one episode; the closure follows cause/via forward and skips chatter.
  The spawns at boot become one START episode. If less than 20 % of messages and transitions have
  links, the board splits the run into bursts of activity separated by quiet instead.
  - Episodes are grouped by kind of stimulus: sender and event name, for example `JOB SUBMIT ×62`.
  - Tapping a chip shows its next occurrence (`3/62`); a tap after the last one unpicks.
  - More than 7 kinds: 6 chips per page, plus `▸ MORE`.
  - With 7 or fewer episodes, there is one chip each.
  - The band of brackets above the lanes shows each episode where it happened; tap a bracket for
    exactly that episode.
  - A picked episode draws its causal tree in the episode's colour. The header reads
    `<stimulus> from <sender> · n steps`.

### What-if reels

The reels exist only when `trace.worlds` has entries. Without them the band is gone and the lanes
take its room. With them, the reels behave as before: the fork is a dashed magenta line, the what-if
take after it is magenta, the recorded run is ghost strips, and the end is marked.

## Interface (unchanged from the contract, plus extras)

```js
const board = createBoard({ sim, width, height,
  rows,       // optional: actor ids in the room's order (orders actors within their group)
  baseUrl,    // optional: where worlds/<id>.json live (default ../data/<trace.system>/ beside board/)
  createSim,  // optional: core/sim.js's createSim, for what-if worlds
  now });     // optional: () => ms, the clock for double taps (the film clock when recording)
```

- `canvas`, `dirty`, `update(t)`, `pointer(type, u, v, extra?)`, `on(event, fn)` and
  `highlight({actorId?, messageId?})` work as in the contract.
- `pointer('wheel', u, v, {dy, dx})`: `dy` zooms around the pointer and `dx` pans.
- `highlight({actorId})` lights the actor's row. If the actor is a member of a collapsed swarm, it
  lights the swarm lane; if the swarm is expanded, it outlines the member's track.

### Events

| Event | Payload | When |
|---|---|---|
| `seek` | `{t}` | A tap on a lane, the axis or a span; a scrub; picking a behaviour (its start), a message, or a time in a swarm |
| `select` | `{actorIds, messageIds, storyId}` | Picking a story |
| | `{actorIds, messageIds, storyId: null, episodeId}` | Picking a derived episode: every actor and message in its closure |
| | `{actorIds, messageIds, chainIds, storyId: null}` | Picking a message |
| | `{actorIds: [...alive], messageIds: [], storyId: null, laneId}` | **Touching a swarm lane's name**: expands or collapses it, and `actorIds` = the swarm's members alive at the playhead. **Touching inside a collapsed swarm** at time t: the members alive at t, and a `seek` to t |
| | `{actorIds: [id], ...}` | Touching a span, a row's name, or a member's track in an expanded swarm |
| | `{actorIds: [], messageIds: [], storyId: null}` | Unpicking, or a double tap home |
| `world` | `{worldId \| null}` | Tapping a reel (only when worlds exist) |

### Extras

- `zoom`, `pan`, `resetView`, `selectStory(id)`, `selectWorld(id)`, `selectMessage(id)`,
  `loadWorld(id)`, `warp`, `unwarp`, `duration`, `locate(...)`, `state`, `dispose`: as before.
- New:
  - `selectEpisode(i)`: the i-th behaviour, story or episode. `null` unpicks.
  - `expand(laneKey, on)`.
  - `lanes`: `[{key, type: actor|tracks|ext|region, label, actors, swarm, expanded}]`.
  - `rows`: the lane keys.
  - `behaviours`: `[{id, label, a0, a1, kind, story}]`.
  - `massEvents`: `{deaths: [{at, n, ids}], births: [{at, n}]}`.
  - `state.episodeId`, `state.expanded`.
  - `locate({episode})` and `locate({laneId, t?})`.

## What WORLD must forward

WORLD forwards the same things as before:
- `update(t)` every frame. Upload the texture when `dirty`, then set `dirty = false`.
- Raycast `down`, `move`, `up` and `leave` as `(u, v)`, with `v` = 0 at the top.
- The wheel, as `pointer('wheel', ...)`.
- A pinch, as `zoom(ratio, uMid)`.
- When the room selects someone, `highlight(...)`.

On a swarm `select`, WORLD gets the alive members. To show the swarm as a crowd, it can light all
of them.

## Files

- `board.js`: the board.
- `test.html?system=<name>`: reads `../data/<name>/trace.json`, or else `fixtures/<name>/trace.json`.
  `&stories=0` removes stories and worlds. It shows the board flat and at one-third size on a
  tilted wall, logs every event, and works with mouse, touch, wheel and pinch. `?film=1` is the
  scripted mode (the scripted visit exists for llm-chat only).
- `shots.mjs [system...]`: per-system stills in `out/<system>/`, from every system in `../data/`
  and `fixtures/`, plus llm-chat without stories. The stills are `1-overview`, `2-behaviour`,
  `3-swarm-expanded`, `4-mass-death` and `9-third-size-skewed`. `--film` writes the llm-chat clip.
- `fixtures/make.mjs`: hand-made traces for shapes the examples lack:
  - `checkout`: one actor with parallel regions, 2.4 s;
  - `job-queue`: a dispatcher, 72 short-lived jobs (21 alive at once), a process kill and a
    restart, 3.3 min;
  - `orders`: invoked payment children, 10-minute waits with reminders, and no cause/via links,
    so its episodes come from bursts.
