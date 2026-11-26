# tracer: record any @tinyactors/scxmljs system as an Office trace

`tracer.ts` turns a run of any system of statecharts into `data/<system>/trace.json` in the shape of
`../SCHEMA.md` (v1–v3). It has no code for any one system: a driver (`drivers/<system>.ts`) boots
the real system the way its tests or page do, feeds it a script on a `VirtualClock`, and calls
`finish()`. `check.ts` validates traces. `SYSTEMS.md` lists what was recorded and what to look for.

```sh
bun prototypes/office/tracer/drivers/pi-durable.ts      # one system (see the header of each driver)
for d in llm-chat-dynamic pi-durable pi-durable-tour fulfillment github-issues singles samples many; do
  bun prototypes/office/tracer/drivers/$d.ts; done       # everything (~2 min; the runs are deterministic)
bun prototypes/office/tracer/check.ts                   # every data/*/trace.json, or name files
```

## API

```ts
import { createTracer } from "./tracer.ts";
const tracer = createTracer({ system: "orders", scenario: "six-orders", clock });
const engine = tracer.wrapEngine(createSession, (source, options) => ({ id: "order-1" })); // observes what it makes
tracer.captureAll();                       // or: observe every session started anywhere (patches SCXMLSession.prototype.start)
tracer.observe(session);                   // or: one session made elsewhere, before start()
tracer.external("shop", { label: "the web shop", kind: "user" });   // name an endpoint before it appears
tracer.as("shop", () => session.send("order.placed", order));     // attribute application input to an endpoint
tracer.caption("SO-1: the card is declined three times.");
const trace = tracer.finish();             // sorts, derives wiring and stories; stop recording
```

Options of `createTracer` (all but `system` and `clock` optional):

| option | what it does |
|---|---|
| `identify(session, {name, sessionId, data, parent, invokeid, src})` | returns `{id, label, role, chart, source, identity, purpose}` for an actor. Default: label from `<scxml name="kind · label">` (the convention llm-chat and pi-durable use), id from the label, chart key from the name before ` · ` |
| `app` | the endpoint `session.send()` from application code comes from (default `app`) |
| `appCause`, `appCauseWindowMs` | `"same-tick"`: an application send or spawn is caused (inferred) by the newest message into an external within the window, e.g. a harness process acting on a commit |
| `resolveOrigin(alias, origin, {to, name})` | who delivered an inbound event that no observed `<send>` explains (default: the origin when it is a short name, else the processor) |
| `externalFor(alias)` | the endpoint an I/O processor stands for (pi-durable: the wire's far end is the process) |
| `onEvent(e)`, `onEndpoint(kind, value)` | incremental consumption: every event as it is recorded, every actor/external as it appears |
| `deliveryWindowMs` | how late a delivery may come and still complete a `<send>` (default 0: the same instant) |

`tracer.events`, `actors`, `externals`, `charts` are live while recording; `tracer.flush()` emits
sends still waiting for a recipient (a live view calls it when the clock moves).

## How it records (generic, per session)

- **Spawn/end.** A session is an actor from `observe` (or its `start()` under `captureAll`) to its
  `done` event; invoked SCXML children come from the parent's `child` event. `end.reason` is `done`
  (a top-level final state), `cancelled` (its invoking state was left, or `cancel()`) or `disposed`
  (the application disposed it: a client leaving, a process killed). Actors still running at
  `finish()` have no `end`.
- **Charts** come from the compiled model (`session.model`), not from parsing text: state tree with
  kinds, initial, history type, transitions (event, cond, targets, `internal`), executable content,
  invokes, `<data>` declarations with `readBy`/`writtenBy` (a textual scan), docs from the comment
  before a state (else the first comment in it, else a short inference). Charts are deduplicated by
  structure, so clients with different names share one chart. The root is `__root__`; generated ids
  (`__state1`) are the engine's. `purpose` is the comment that introduces the chart in its source
  text (known through `wrapEngine`, a patched `loader`, or `identify`).
- **Transitions** are every microstep, including targetless ones (`targetless: true`, empty
  `from`/`to`), with `event`, `eventType` (`external`/`internal`/`platform`), `source` (the state
  whose transition fired) and `cause`: the message whose delivery the step processed (matched in
  the actor's inbox, which mirrors the engine's FIFO external queue), else the actor's previous
  step (raised, internal, platform and eventless steps), else its spawn.
- **Config** after each macrostep when it changed, and the last configuration before an `end`.
- **Messages**, from `<send>` (the `send` event), I/O deliveries (each session's
  `IOSession.deliver`, patched in place), custom invokers (`sendToParent`/`done`, patched),
  application `session.send()` (patched on the instance) and invokes (`invoke`, `cancel`,
  `done.invoke.<id>`). A `<send>` through a processor becomes a message to the session that
  received the same event (same name, same data object) at once (`channel: <alias>`), several for
  a broadcast, or else a message to the processor's external. What a session sends during a step
  points at the step (`cause` and `via` = the transition). Replies from externals point at the
  request they answer (`inferred: true`). Delayed sends carry `delay` and `timer` (the `timer`
  event that set them) and are caused by the step that set them.
- **Timers**: `timer` events (`action: "set"` with `delay`/`due`, `"cancel"`) from the session's
  clock, which the tracer wraps per session; the firing appears as the delayed message.
- **Data**: `snapshot` (every `<data>`, values truncated: strings ≤ 200, arrays ≤ 20, depth ≤ 3,
  and made shallower until each value fits 700 characters) at the first stable point and whenever
  anything changed; a `data` event per changed variable after the first snapshot.
- **error** events (`kind`, `message`) when a session raises `error.*`.
- **wiring** (`finish`): every static `<send>`/`<invoke>`, resolved to the charts and externals the
  run showed it reaching (else the parent, the chart itself, or the processor), plus inbound wires
  from externals seen in the run; `count` = messages seen.
- **stories** (`finish`, `derived: true`): one episode per outside stimulus (a message from an
  external with no cause), its causal closure grouped into ≤ 9 steps with machine-made text; the 12
  largest. No hand-written stories, no worlds.

Ordering: events are emitted as they happen with two exceptions: what a session sends during a step
is held until the step's transition is recorded (same `t`, so it can point at it), and a `<send>`
to a processor that nobody received at once is emitted when the clock moves on (its `t` is the send's;
`finish()` sorts). Ids are `e<n>` in emission order, so after sorting a few ids are out of order.

## Extra fields (beyond SCHEMA.md; all optional)

`trace.version: 3`, `trace.recorder`; chart `name`, `depth`, `states`; node `history`; actor
`identity`, `incarnation`, `invokeid`, `sessionId`; external `unused`; `end.reason`;
`spawn.parent`; transition `source`, `eventType`, `targetless`, `inferred`; message `channel`,
`delay`, `timer`, `sendid`, `sentAt`, `dropped`, `internal`, `invoke`, `target`, `inferred`;
event types `timer` and `error`.

**A process that dies and restarts** (pi-durable): its actors end at the same instant with
`reason: "disposed"`, and the new process's actors spawn as new actors whose `identity` repeats
the old one's (`task t17`, `harness`) with `incarnation` 2, 3…; their ids get `~2`, `~3`. A world
can seat an incarnation where its predecessor sat.

## What the tracer reads that is not public API (requests for the library)

1. `session.busy` (private): whether a step is running, to hold its sends and to tell a delayed
   send set during a step from other timers. Request: a `macrostepstart`/`step` event, or a public
   `session.processing`.
2. `session.ioSessions` (private Map): every processor handle, to patch `deliver`. Request: an
   inbound event (`deliver`/`enqueue` on the session, with origin, origintype, invokeid), which
   would also cover invokers' `sendToParent`/`done` and `#_parent`/`#_scxml_` deliveries.
3. `session.opts` (private): the `data`, `invokers` and `loader` it was made with. Request:
   `session.options` (read-only).
4. `session.processors` (private): the processor a `<send type>` resolved to. Request: the
   processor (or its alias) on `SendEvent`.
5. `session.clock` replaced on the instance, to see `<send delay>` being scheduled and cancelled
   (`SendEvent` fires only when a delayed send is dispatched). Request: a `send` event at
   scheduling time with `delay` and the send's id, and a `cancel` event.
6. Event identity is lost between enqueue and `MicrostepEvent.event` (it is a copy), so the
   tracer mirrors each session's external queue to know which delivery a step processed. Request:
   a stable event id on `SCXMLEvent` (or the queued object itself) so a step's trigger is exact.
7. `dispose()` of a session that never started emits no `done`. The tracer patches `dispose`.
8. A `MacrostepEvent` fires after a session's `done` (the final macrostep), with an empty
   configuration; the tracer drops it. (It also caused a config-after-end in the one-off
   llm-chat trace: `check.ts` flags `e488` in `data/llm-chat/trace.json`.)
9. happy-dom's `DOMParser` drops comments before the root element, so a chart's introduction is
   only found from its text. Request: keep the source text (or the leading comment) on `Model`.
