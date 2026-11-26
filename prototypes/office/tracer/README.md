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
bun prototypes/office/tracer/diff.ts --git fulfillment  # HEAD's trace against the new one: same actors, transitions, messages?
```

## API

```ts
import { createTracer } from "./tracer.ts";
const tracer = createTracer({ system: "orders", scenario: "six-orders", clock });
const engine = tracer.wrapEngine(createSession, (source, options) => ({ id: "order-1" })); // observes what it makes
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

- **Spawn/end.** A session is an actor from `observe` (or `wrapEngine`) to its `done` event; invoked SCXML children come from the parent's `child` event. `end.reason` is `done`
  (a top-level final state), `cancelled` (its invoking state was left, or `cancel()`) or `disposed`
  (the application disposed it: a client leaving, a process killed; `DoneEvent.disposed`). Actors still running at
  `finish()` have no `end`.
- **Charts** come from the compiled model (`session.model`), not from parsing text: state tree with
  kinds, initial, history type, transitions (event, cond, targets, `internal`), executable content,
  invokes, `<data>` declarations with `readBy`/`writtenBy` (a textual scan), docs from the comment
  before a state (else the first comment in it, else a short inference). Charts are deduplicated by
  structure, so clients with different names share one chart. The root is `__root__`; generated ids
  (`__state1`) are the engine's. `purpose` is the comment that introduces the chart in its source
  text (`model.source`, the text given to `wrapEngine`, or `identify`).
- **Transitions** are every microstep, including targetless ones (`targetless: true`, empty
  `from`/`to`), with `event`, `eventType` (`external`/`internal`/`platform`), `source` (the state
  whose transition fired) and `cause`: the message whose delivery the step processed (exact: the
  step's `MicrostepEvent.eventId` is the id of the `enqueue` event the message was recorded at),
  else the actor's previous step (raised, internal, platform and eventless steps), else its spawn.
- **Config** after each macrostep when it changed, and the last configuration before an `end`.
- **Messages**, from `<send>` (the `send` event, with the processor it resolved to), and every
  event reaching a session (its `enqueue` events): I/O deliveries (`EnqueueEvent.processor`),
  custom invokers' `sendToParent`/`done` and children's `done.invoke.<id>` (`event.invokeid`),
  application `session.send()` (none of those), and invokes (`invoke`; `cancel` when a custom
  invocation leaves `session.invocations`). A `<send>` between observed sessions is recorded by the
  sender and claimed by the recipient's `enqueue` (same name, same data object). A `<send>` through a processor becomes a message to the session that
  received the same event (same name, same data object) at once (`channel: <alias>`), several for
  a broadcast, or else a message to the processor's external. What a session sends during a step
  points at the step (`cause` and `via` = the transition). Replies from externals point at the
  request they answer (`inferred: true`). Delayed sends carry `delay` and `timer` (the `timer`
  event that set them) and are caused by the step that set them.
- **Timers**: `timer` events (`action: "set"` with `delay`/`due`, `"cancel"`) from the session's
  `sendscheduled` and `sendcancelled` events; the firing (the `send` event with the same message
  object) appears as the delayed message.
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

## Public API it relies on

The tracer reads no private field and patches nothing: no instance or prototype method, no clock,
no processor, invoker or loader. It started out doing all of that; each need became a public API of
the library (CHANGELOG, "Observation"):

| what it needs | how it gets it |
|---|---|
| whether a step is running (to hold a step's sends until its transition) | `session.processing` |
| every inbound event, from every source | the `enqueue` event (`processor`, `event.origin`/`origintype`/`invokeid`, `dropped`) |
| the options a session was made with | `session.options` (read-only) |
| the processor a `<send type>` resolved to | `SendEvent.processor` |
| delayed sends when set and cancelled | `sendscheduled` / `sendcancelled` (the `send` carries the same `message`) |
| which delivery a step processed | `MicrostepEvent.eventId` = `EnqueueEvent.id` |
| an end by `dispose()` (also before `start()`) | `DoneEvent.disposed`; `done` comes for a session that never started |
| the last configuration before an end | the last `macrostep` comes before `done` |
| the comment that introduces a chart | `model.source` |
| `<send>`s inside executable content | `getElementsByTagNameNS`, or walking `children` (any DOM) |

Sessions a system creates inside its own code are observed where they are made: a driver uses the
system's factory (`wrapEngine`) or assembles the system from its public parts and calls
`observe(session)` before `start()` (github-issues does that with the playground's gatekeeper).
