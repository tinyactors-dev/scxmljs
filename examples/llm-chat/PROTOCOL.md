# llm-chat protocols (working draft)

One tab runs one system. Everything below is in-process: there is no network except, in Claude
mode, the model's requests to `api.anthropic.com`. The protocols still behave like a network
(addresses, ordering, loss when a client is offline) because that is what the demo is about.

```
 control panel ──origin "host"──┐
 client panels ──origin "ui"──┐ │           ┌──────────── host.scxml ────────────┐
                              ▼ ▼           │ invokers: llm, key-check           │
 client.scxml ×N ◀══ bus ══▶ (routing) ◀══▶ │ processors: bus, log               │
   processors: bus, tool                    └───────┬────────────────────────────┘
   tool runtime: simulated | real (wasm)            │ log commands
                                                    ▼
 scenario.scxml ── stage ──▶ stage          chat log ── log.batch / snapshot ──▶ bus ──▶ clients
                  ◀── host.enter.<id> ──
```

Conventions:

- **Messages are SCXML events.** `<send type="…" event="name">` with `<param>`s becomes
  `{ name, data }`; the receiver gets `_event.name`, `_event.data`, `_event.origin`,
  `_event.origintype`.
- **Addresses** (`target` on the bus, `_event.origin` on arrival): `"host"` is the host chart (and,
  as an origin, the control panel, which has every permission); a client id such as `"ada"` or
  `"terminal"`; `"*"` is every client. A client's own panel delivers to it with origin `"ui"`.
- **"→"** below means "the receiver answers with". Nothing is answered unless listed.
- **Payload types** are TypeScript (`src/protocol.ts` is the source of truth; keep the two in step).

```ts
type ClientId = string;
type Role = "input" | "control" | "tools"; // everyone observes
interface ToolDef { name: string; description: string; input_schema: JSONSchema }
```

## 1. Bus: `urn:llm-chat:bus` (alias `bus`)

Carries messages between the host and the clients. Delivery is in order per sender, synchronous
in simulated time plus an optional per-link latency. While a client is **offline**, everything
to and from it is dropped silently (the host is not told; it finds out through timeouts or
`client.resync`).

### Client → host

| Message | Payload | → Response (to the sender unless noted) |
|---|---|---|
| `client.hello` | `{ name, kind, wants: Role[], tools: ToolDef[] }` | `welcome { clientId, granted: Role[], tools: string[], refused: string[], busy }`, then `snapshot` (from the log); everyone gets a `roster` log entry |
| `client.resync` | `{ fromSeq }` | `snapshot`, then `host.idle` or `host.busy` (it may have missed one). During `tools`, also every `tool.call` it still owes, again, and the tool timeout restarts (see *Delivery of tool calls*) |
| `client.bye` | `{}` | nothing to the sender; `roster` entry; its outstanding tool calls fail at once |
| `input.submit` | `{ inputId, text }` | while idle: `input.accepted { inputId, queued: false }`, and the message starts a turn. Otherwise `input.rejected { inputId, code, reason }`; `code: "busy"` means a turn is running (another client got there first) |
| `input.steer` | `{ inputId, text }` | needs `control`. While idle, as `input.submit`. During a turn, `input.accepted { inputId, queued: true, steer: true }`: held by the host for the next boundary, with the tool results, or as the next turn |
| `input.interrupt` | `{}` | nothing, or `input.rejected { code, reason }` (`role`: "needs the control role", `nothing`: "nothing to stop") |
| `tool.result` | `{ callId, isError, content: string }` | nothing. Late results (after a timeout, a stop, or from the wrong client) are ignored with a `notice` |

### Control panel → host (origin `"host"`)

| Message | Payload | Effect |
|---|---|---|
| `roles.set` | `{ clientId, roles: Role[] }` | the client gets `roles.changed { granted }`; `roster` entry |
| `mode.claude` / `mode.simulated` | `{}` | switches the model; only while idle |
| `key.set` | `{}` | the key is already in the vault (never in an event); the host verifies it (`key-check`) |
| `key.forget` | `{}` | locks the Claude model |
| `input.interrupt` | `{}` | as from a client with `control` |

### Delivery of tool calls

The bus drops everything while a client is offline, and the host isn't told. A tool call can be
lost on the way out (the provider was offline) or its result on the way back (it went offline
while running). Both are recovered when the provider comes back: it asks for a snapshot
(`client.resync`), and the host sends it every call it still owes, again, and restarts the tool
timeout. Clients make repeated calls safe: a call still running is ignored, and a call already
answered (the last 20 are kept) gets the same result again, without running the tool twice.
Until then the host's tool timeout (30 s of clock time) runs: each (re)start is a `timer` log
entry, which the panels draw as the running call's row filling up.

### Host → client

(Also from the client, while its real tools download: `tool.delayed { callId, reason }` → the host re-arms its tool timeout and logs a notice.)

| Message | Payload | Client does |
|---|---|---|
| `welcome` | see above | joins; waits for `snapshot` |
| `snapshot` | `{ seq, entries: LogEntry[] }` (§2) | rebuilds its view by replaying the entries; continues from `seq` |
| `log.batch` | `{ first, last, entries: LogEntry[] }` | applies it if `first ≤ seq + 1`; on a gap, `client.resync { fromSeq: seq }` |
| `roles.changed` | `{ granted: Role[] }` | updates what its panel allows |
| `input.accepted` / `input.rejected` | see above | `busy`: puts the message back at the head of its queue. Other refusals: the text goes back into the editor (`panel`), and the reason is shown |
| `host.busy` | `{}` (to everyone) | a turn started: new messages go into this client's queue |
| `host.idle` | `{ stoppedBy: ClientId \| null }` (to everyone) | the turn is over (no stream, no tools, no retry pending): the next queued message goes out. If this client stopped the turn, its queue goes back into its editor instead |
| `tool.call` | `{ callId, name, input }` | runs it (`tool` runtime) → `tool.result` |
| `tool.cancel` | `{ callId }` | cancels it; sends no result |

### Client panel → client (origin `"ui"`)

`ui.submit { text }`, `ui.steer { text }`, `ui.interrupt`, `ui.queue.remove { id }`, `ui.queue.edit { id }`,
`ui.leave`, `ui.offline`, `ui.online`.
The panel sets the bus link *and* tells the chart, so the chart's `link` region shows it.
Panel events never cross the bus, so they work while the client is offline.

The client forwards steer and stop even without the `control` role: the host is the authority
and answers `input.rejected` with the reason. The client's own idea of its roles only enables
or disables the panel's buttons.

### The queue lives in each client

The host never queues messages. Each client keeps its own queue (the `outbox` region of
client.scxml) and sends one message at a time, only while the host is idle; everything typed
while a turn runs, while a message is on its way, while offline, or before the client has
joined waits there. The person sees it above their editor and can delete a message
(`ui.queue.remove`) or edit it (`ui.queue.edit`: out of the queue and appended to the editor).
Several clients may send when the host goes idle: the first message wins, the others are
refused as `busy` and go back to the head of their queues.

### Client → its own panel: `urn:llm-chat:panel` (alias `panel`)

| Message | Payload | Panel does |
|---|---|---|
| `restore` | `{ text }` | appends the text to the editor (a blank line after what is typed; typed input is never replaced) |

The host's answers to the control panel (origin `"host"`, e.g. `input.rejected`) go to the
panel, never back into the host chart.

## 2. Log: `urn:llm-chat:log` (alias `log`), host only

The chat log is the only writer of the conversation. The host chart sends it commands; the `llm`
invoker writes streamed content straight into the current draft (the data plane never goes
through a chart). Every change becomes a numbered `LogEntry`, broadcast to all clients as
`log.batch`, coalesced about every 50 ms of simulated time.

### Commands (host chart → log)

| Command | Payload | Log does |
|---|---|---|
| `user.append` | `{ turn, entries: { inputId, author, text }[] }` | appends one user message, a text block per entry (`[Ada] …`); entry `user` |
| `assistant.commit` | `{ request, stop }` | moves the draft into the history unchanged (thinking blocks included); entry `assistant.commit` |
| `assistant.discard` | `{ request, reason }` | drops the draft from the history (clients keep showing it greyed out); entry `assistant.discard` |
| `tools.dispatched` | `{ request, calls: { id, name, input, provider }[] }` | entry `tools` (who runs what) |
| `tools.timer` | `{ request, ms }` | entry `timer`: the tool timeout was (re)started; it fires at the entry's `at` + `ms` |
| `tool.results` | `{ request, results: { callId, isError, content }[], steers: Input[] }` | appends one user message: a `tool_result` per call, in call order, then the steers as text; entry `tool.results` |
| `queue.changed` | `{ steers: Input[] }` | entry `steers` (the host holds steers only) |
| `roster.changed` | `{ clients: RosterEntry[] }` | entry `roster` |
| `notice` | `{ level: "info" \| "warning" \| "error", text }` | entry `notice` |
| `snapshot.send` | `{ to: ClientId }` | sends `snapshot` to that client over the bus |

A command the log can't carry out (a commit without a draft, say) throws: the host gets
`error.communication`, which shows in the explorer.

### Draft API (llm invoker → log, plain calls)

```ts
log.draft(request).start()                           // entry assistant.start
log.draft(request).apply(event: ModelStreamEvent)    // entries block.start / block.delta / block.stop / usage
```

### Entries and snapshots

```ts
type LogEntry = { seq: number; at: number /* simulated ms */ } & (
  | { kind: "user"; turn: number; entries: Input[] }
  | { kind: "assistant.start"; request: number; model: string }
  | { kind: "block.start"; request: number; index: number; block: "text" | "thinking" | "tool_use"; name?: string; id?: string }
  | { kind: "block.delta"; request: number; index: number; text?: string; json?: string }
  | { kind: "block.stop"; request: number; index: number }
  | { kind: "usage"; request: number; input: number; output: number; cacheRead: number }
  | { kind: "assistant.commit"; request: number; stop: string }
  | { kind: "assistant.discard"; request: number; reason: string }
  | { kind: "tools"; request: number; calls: { id: string; name: string; provider: ClientId | null }[] }
  | { kind: "tool.results"; request: number; results: { callId: string; isError: boolean; content: string }[]; steers: Input[] }
  | { kind: "steers"; steers: Input[] }
  | { kind: "roster"; clients: RosterEntry[] }
  | { kind: "notice"; level: string; text: string }
  | { kind: "state"; configuration: string[] } // the host's active states, from its macrosteps
);

// Every entry so far. Simple, and fine at demo sizes; a compacted snapshot (transcript,
// draft, steers, roster, configuration) can replace it without changing anything else.
interface Snapshot {
  seq: number;              // the last entry included
  entries: LogEntry[];
}
```

The API history (`MessageParam[]`) is never broadcast: it is the host's, and only the `llm`
invoker reads it. It is **append-only**: commits add the model's content unchanged, discarded
drafts never enter it, and a stop in `tools` still appends a `tool_result` for every `tool_use`.

## 3. Invoker `llm` (host)

```xml
<invoke type="llm" id="llm">
  <param name="request" expr="request"/>   <!-- number, the draft's key -->
  <param name="model" expr="…"/>           <!-- "simulated" | "claude" -->
  <param name="tools" expr="toolset"/>     <!-- ToolDef & { provider }[], frozen for the turn -->
</invoke>
```

| To the parent | Payload | When |
|---|---|---|
| `llm.block.start` | `{ index, kind: "thinking" \| "text" \| "tool_use", name? }` | a content block starts |
| `llm.block.stop` | `{ index, kind }` | it ends |
| `done.invoke.llm` | `{ ok: true, stop: StopReason, toolCalls: { id, name, input, invalid? }[] }` | the message ended |
| `done.invoke.llm` | `{ ok: false, error: { kind, status?, retryable, retryAfterMs?, message } }` | it failed; `kind`: `rate_limit`, `overloaded`, `server`, `network`, `stream` (retryable); `auth`, `invalid`, `refusal`, `truncated` (not) |

`cancel()` (the state was left: stop, or an error elsewhere) aborts the request. Tool inputs are
validated against the tool's schema before `done` (with eager input streaming the API doesn't,
and the SDK's tolerant parser can return truncated input): a failing call carries `invalid`, and
the host answers it with an error `tool_result` without sending it to a client.

Two outcomes are never committed, because the message may hold a cut-off `tool_use`: `refusal`,
and `max_tokens` with a tool call in it. Both come back as errors (`refusal`, `truncated`).

### `ModelSource`: what the invoker talks to

```ts
interface ModelSource {
  stream(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}
interface ModelRequest { messages: MessageParam[]; tools: ToolDef[]; system: string }
// the Messages API's server-sent events, as the SDK types them
type ModelStreamEvent = RawMessageStreamEvent;
```

- `ClaudeModel`: the SDK in the browser (`dangerouslyAllowBrowser`), `claude-haiku-4-5` by
  default (fast and cheap: $1 / $5 per million input / output tokens) with an 8K answer cap and no
  thinking. Set `model` to a newer model and it also gets adaptive thinking (`display:
  "summarized"`), an effort level and `fallbacks: "default"`. Always `maxRetries: 0` (the chart
  retries) and `eager_input_streaming` on every tool. Errors are thrown as the SDK's
  typed errors; the invoker maps them to `error.kind`.
- `SimulatedModel`: rule-based over the last user message, timed on the shared clock. It
  produces the same events and never produces thinking blocks with signatures, so a simulated
  history is valid for Claude. Its knobs are §6's `sim.*` messages.

## 4. Invoker `key-check` (host)

No params. Reads the key from the vault and lists models.
→ `done.invoke.keycheck { ok: true }` or `{ ok: false, message }`. `cancel()` aborts.

## 5. Tool runtime: `urn:llm-chat:tool` (alias `tool`), one per tool-providing client

| Message (client chart → runtime) | Payload | → Response (delivered to the client chart) |
|---|---|---|
| `run` | `{ callId, name, input, real }` | `tool.done { callId, isError, content: string }`, once. `real`: the chart's choice (it is only true once the tool's packages are installed) |
| `cancel` | `{ callId }` | nothing; a `tool.done` already on its way is dropped by the chart |

Each runtime has a simulated and a real implementation per tool, and no loading state: whether a
client is simulated or real, and how far its downloads are, lives in the charts (below). The
panel's **Tools** switch (Simulated by default) sends `ui.tools.real` / `ui.tools.simulated` /
`ui.tools.retry` to the client chart; `ToolRuntime.mode`, `setMode` and `realState` are views
onto the charts for the page. `ToolRuntime.invoke(name, input, signal?, real?)` runs one tool
directly (the site's browser test uses it).

| Client | Tool | Simulated | Real |
|---|---|---|---|
| **Ada** (person) | `ask_ada { question }` | a person answers in Ada's panel (the same in both) | same |
| **Terminal** | `shell { command }` | a tiny shell over a fake `/workspace` (`ls`, `cat`, `wc`, `echo`, `grep`, `date`) | `bash -c` in the shared `/workspace`; `python` and `psql` work too once loaded |
| **Python** | `python { code }` | `print(...)` of integer arithmetic, else an error | `python -c` in the shared `/workspace` |
| **Postgres** | `sql { query }` | canned rows from a seeded `orders` table | one long-lived `psql` session (in the shared `/workspace`, so `\copy` reads and writes files there) to PGlite, seeded with the same `orders` rows; data persists between calls |
| **Statechart Lab** | `run_statechart { scxml, events }` | real: scxmljs, sandboxed (it is local and cheap) | same |

Knobs per tool: latency (simulation only), "fail next call" and "hang" (never answers, to show
timeouts and stops; both modes). Output longer than 16 KB is truncated with a note.

### Real tools: one shared workspace

Real tools run in Wasmer (`@wasmer/sdk` 0.19). **One workspace sandbox** holds the demo files in
`/workspace` and every command-line package a client switches to Real: bash + coreutils
(Terminal), Python (Python), psql (Postgres). They see the same files, and their processes run
concurrently. **PGlite** (the Postgres server) has its own sandbox, one for the page (a second
Postgres client shares it); psql reaches it over the SDK's virtual localhost. The sandboxes use
the SDK's `http` network mode: virtual localhost only, no external egress (DNS doesn't resolve).

| Package | Id | First download | Needed by |
|---|---|---|---|
| Wasmer runtime | `@wasmer/sdk` 0.19.0 (served by this site) | 4.9 MB | every real tool |
| bash | `wasmer/bash@=1.0.25` | 1.9 MB | Terminal, Python |
| coreutils | `wasmer/coreutils@=1.0.27` | 12.7 MB | Terminal, Python |
| Python 3.13 | `python/python@=3.13.20` (depends on bash and coreutils, and ships their commands) | 61.7 MB | Python |
| PostgreSQL (PGlite) | `wasmer/pglite@=0.1.3` | 76.9 MB | Postgres |
| psql | `wasmer/psql@=18.4.0` | 1.1 MB | Postgres |

Packages are installed on demand and only once: a client that needs a package another client
already installed finds it ready at once. Browsers cache the downloads.

### Loading real tools is a statechart

Every download is a machine, and so is the choice between simulated and real tools:

- **`charts/package.scxml`**, one per package (the Wasmer runtime, bash, coreutils, Python, PGlite,
  psql): `absent → waiting` (for the Wasmer runtime) `→ fetching { resolving, downloading,
  installing } → ready`, or `→ failed`, and `failed` goes back to `waiting` when someone needs
  it again (a retry). Its data model has the bytes and percent. The work is the invoker
  `type="wasm-package"` (param `key`): it calls a `PackageLoader` (`src/tools/packages.ts`),
  sends `package.progress` events, and finishes with `done.invoke.fetch { ok, cached?, error? }`;
  leaving `fetching` cancels it. Every change goes to the parent as `package.changed { key, status }`.
- **`charts/workspace.scxml`**, one per tab, invokes the six package machines (see the explorer's
  Chart → *Workspace (downloads)*, System view). It takes `need { packages }` from clients,
  releases waiting packages once the runtime is ready, and never fetches a package twice (a
  second client joins the machine already running). It answers each waiting client
  `workspace.progress { packages }` (on a step change), then `workspace.ready { packages }` or
  `workspace.failed { key, error }`.
- **`client.scxml`, region `tools`**: `simulated`, or `real` = `real-loading` (asks the workspace
  for its packages) `→ real-ready`, or `→ real-failed` (`ui.tools.retry` asks again). A `tool.call`
  that arrives during `real-loading` waits in the chart (`held`), and the client sends the host
  `tool.delayed { callId, reason }`, again on every step change, which re-arms the host's 30 s
  tool timeout: a slow download doesn't turn into a timeout. On `real-ready` held calls run for
  real; on `real-failed` they fail with the reason; back to `simulated` they run simulated.
  Real chosen before the client has joined is remembered (`wantsReal`) and applied once it has.

Clients reach the workspace through the `workspace` I/O processor (`urn:llm-chat:workspace`,
`src/workspace-link.ts`): local to the tab, no latency.

**The loader** (`src/tools/wasm.ts`): `loadPackage(key, { onProgress, signal })` installs one
package (`"sdk"`, or a key of `PACKAGES`) into the shared workspace (PGlite: into the database
sandbox), idempotently, reporting that package's `PackageDownload`. The tools (`shellTool`,
`pythonTool`, `sqlTool`) assume their packages are installed. The page's `?fake-downloads`
(`src/ui/fake-downloads.ts`) and the tests plug in fake loaders instead: everything else, the
machines included, runs as for real.

A non-zero exit, a 20 s time limit or a kill (`cancel`) makes an error result that still carries
the output. Commands are always selected by their package (Python's package also provides
`bash`). PGlite accepts one connection per process, so psql stays connected and queries run one
at a time; a cancelled or stuck query restarts the database with the demo data. The page must be
cross-origin isolated (SharedArrayBuffer): `/demos/llm-chat/` gets COOP/COEP from
`coi-serviceworker` on GitHub Pages (one reload on the first visit) and from
`scripts/site/serve.ts` locally. Packages come from `registry.wasmer.io` and `cdn.wasmer.io` (the
page's CSP `connect-src` allows them).

## 6. Stage: `urn:llm-chat:stage` (alias `stage`), scenarios only

The stage is the page itself: the thing a person clicks. A scenario chart drives it with the same
actions, so scenarios, tests and the media tour are one thing.

| Scenario → stage | Payload | Stage does |
|---|---|---|
| `note` | `{ text }` | shows a caption (the "follow along" line) and adds it to the timeline |
| `client.add` | `{ kind, name? }` | adds a client panel; its id is `kind` (then `kind-2`, …) |
| `client.remove` | `{ client }` | the panel leaves (`ui.leave`) and is removed |
| `client.offline` / `client.online` | `{ client }` | toggles its link |
| `type` | `{ client, text, steer? }` | types into that panel and presses ⏎ (or ⌘⏎) |
| `interrupt` | `{ client }` | presses Esc in that panel |
| `answer` | `{ client, text }` | answers a pending `ask_*` in that panel |
| `queue.edit` / `queue.remove` | `{ client, index }` | edits or deletes that client's queued message at `index` (0 = next to go) |
| `sim.fault` | `{ kind: "rate_limit" \| "overloaded" \| "stream" \| "max_tokens" \| "refusal" \| "hang", retryAfterMs? }` | the simulated model's next request fails that way |
| `sim.tool` | `{ client, tool, latencyMs?, fail?, hang? }` | sets that tool's knobs |

| Stage → scenario | When |
|---|---|
| `host.enter.<stateId>` | the host entered that state (from its `microstep` events) |
| `client.<clientId>.enter.<stateId>` | a client entered that state |

## 7. Client catalog

| Kind | Name | Wants | Tools | Simulated latency |
|---|---|---|---|---|
| `ada` | Ada | input, control, tools | `ask_ada` | a person |
| `bo` | Bo | input | none | |
| `terminal` | Terminal | tools | `shell` | 400 ms |
| `python` | Python | tools | `python` | 1500 ms |
| `postgres` | Postgres | tools | `sql` | 900 ms |
| `lab` | Statechart Lab | tools | `run_statechart` | 300 ms |
| `viewer` | Viewer | none (watches) | none | |

The page starts with Ada only. "+ add client" offers the rest.
