# pi-durable: protocol

This file lists the messages each I/O processor and invoker accepts and what each one answers.
Keep `src/harness.ts`, `src/wire.ts` and `src/system.ts` in step with it.

## 1. `durable`: a task's commits (task charts → the harness)

`<send type="durable" event="NAME">` with `<param>`s. The harness applies the commit as one
`Tx`: the entries, documents, child tasks and the task's next state are stored together.

The harness answers nothing; the chart has already moved on. One exception: once a task carries
an abort mark, the harness refuses every commit except an abort handler's (`*.aborted`). This
matches Pi, where a commit from a run invocation is rejected after the mark.

A terminal outcome is stored as `completing` while the task still owns live work. It becomes
`terminal` once that work has ended, and the session then gets `task.terminal`.

| Commit | Params | What it stores |
|---|---|---|
| `task.checkpoint` | `checkpoint` | `running` with the new checkpoint |
| `task.complete` | `result` | outcome `completed` |
| `task.fail` | `message` | outcome `failed`, which is cancellation intent: owned work is aborted |
| `task.aborted` | `reason?` | outcome `aborted` (an abort handler) |
| `generation.request` | `attempt`, `background` | a `pi.system` entry if the sections or tools changed; a background `pi.compaction` if asked; checkpoint `request` |
| `generation.compactBlocking` | `attempt` | a `pi.compaction` owned by this task; `waiting` on it (`allSettled`), checkpoint `prepare` with `compacted` |
| `generation.stream` | `text` | the partial answer in `pi.live.generation.message` (sent by the `model` invoker, throttled) |
| `generation.convertPartial` | | a committed partial becomes a `pi.assistant` entry with `stopReason: "aborted"` |
| `generation.toolRound` | `text`, `toolCalls` | a `pi.assistant` entry; one `pi.tool` task per call, owned by this task; tool slots in `pi.live`; `waiting` on the calls (`allSettled`), checkpoint `tools` |
| `generation.answer` | `text` | a `pi.assistant` entry; the run's inputs `done`; `pi.live.run` removed; the final boundary (which may start the next run); `completed` |
| `generation.retry` | `attempt`, `delayMs`, `error` | checkpoint `retry` with `until` (the timer survives restarts) |
| `generation.failed` | `error` | inputs `unanswered` (`model_error`); `failed` |
| `generation.postTools` | | a handoff result ends the run with a `pi.reset` entry; otherwise the postTools boundary (steers join the run) and the next `pi.generation`. Then `completed` |
| `generation.aborted` | | the partial converted; inputs `unanswered` (`aborted`); the run removed; `aborted` |
| `tool.intent` | `args`, `replay` | checkpoint `execute` with the final arguments and the replay policy; slot `running` |
| `tool.unavailable`, `tool.blocked` (`reason`) | | an error result (`tool_unavailable`, `blocked`); `completed` |
| `tool.result` | `result: {text, isError?, control?}` | the `pi.tool-result` entry; slot `done`; `completed` with `{entryId, control}` |
| `tool.error` | `message` | a `tool_error` result; `failed` |
| `tool.interrupted` | | an `interrupted` result with the stored output; `failed`, so anything the call owned is aborted |
| `tool.aborted` | | an `aborted` result; `aborted` |
| `compaction.nothing` | | `completed` (nothing to cut) |
| `compaction.place` | `summary`, `firstKept` | a `pi.compaction` head marker. Blocking (owned by a generation): appended directly. Otherwise: a write submission (`compaction:<task>`), placed at the next boundary |
| `checkout.pay` | `policy` | one `shop.payment` per card, owned by this task; `waiting` on them (`failFast`), checkpoint `decide` |
| `reminder.deliver` | | a follow-up input to the conversation (`reminder:<task>`); `completed` |

`harness.scxml` sends three commits to the same processor:

| Commit | Answer |
|---|---|
| `harness.acquire` | the storage's owner becomes this process; answers `harness.acquired {previousOwner}` |
| `harness.reconcile` | one commit, no task code: `running` → `pending`, checkpoints and abort marks kept; answers `harness.reconciled {recovered}` |
| `harness.resume` | scheduling starts (the chart gets `resume` from `Harness.resume()`) |

## 2. Harness → task charts

| Event | Data | When |
|---|---|---|
| `task.wake` | `{checkpoint}` | every task in `on` is terminal (the task is `running` again) |
| `task.abort` | | the abort mark was committed (by Esc, an owner's cancellation intent, or failFast) |
| `task.drained` | | an abort-marked task's owned work has ended: its abort handler may run |
| `task.terminal` | `{outcome}` | the stored outcome is final |

A new process starts each live task's session with `data: {task, now}`: the stored record, and
the clock when the session starts. The chart's `recover` state routes to the stored status
and phase.

## 3. Invokers (task charts)

| Type | Params | `done.invoke` data |
|---|---|---|
| `prepare` | | `{tokens, contextWindow, blocking, background}`: the context against the compaction thresholds |
| `model` | (`firstKept` for a compaction) | `{ok: true, text, toolCalls}` or `{ok: false, retryable, error}` |
| `resolve-tool` | | `{found, replay, from, wrappedBy}`: the tool as resolved now. A call keeps this code until it ends |
| `hooks` | `point` (`beforeTool` / `afterTool`), `args`, `result?` | `{args}` or `{block}`; `{result}` |
| `tool` | `args` | `{ok: true, result}` or `{ok: false, error}` |
| `bank` | `op` (`charge` / `refund`), `card`, `key` | `{ok, receipt?, error?}` / `{refunded}` |
| `outcomes` | `ids` | the outcomes of those tasks (`runtime.outcomes`) |
| `compaction-select` | | `{firstKept}` (null: nothing to cut) |

Leaving the invoking state cancels the invocation. Killing the process cancels all of them.

## 4. `wire`: clients ⇄ the process

| Client → process | Data | Answer |
|---|---|---|
| `attach` | `conversationId` | `view {view}` (the whole current view), then `ops {ops, seq}` after every commit that touches it |
| `submit` | `conversationId, requestId, text, whenBusy, author` | `submitted {requestId, submissionId, duplicate}` or `rejected {requestId, reason: "ConversationBusy"}` |
| `abort` | `conversationId` | none (Esc: queued inputs withdrawn, current work marked) |
| `compact` | `conversationId, instructions` | none (a manual compaction task) |
| `fork` | `conversationId, at, title` | `forked {conversationId}` |

The link itself sends `wire.up` and `wire.down`. Messages sent while no process is up are dropped.
Replies a dead process had in flight are lost with it.

`ops` entries are `{op: "entry", entry}`, `{op: "head", first}`, `{op: "doc", name, value}`
and `{op: "submission", record}`.

The page sends `ui.submit {text, whenBusy?, requestId?}`, `ui.switch {conversationId}`,
`ui.abort`, `ui.compact {instructions}` and `ui.fork {at, title}`.

## 5. `stage`: the tour → the world

| Event | Data |
|---|---|
| `note` | `text`, `cite?` (a key of `CITATIONS` in `src/post.ts`), `panel?` (`process` / `storage`: story focus) |
| `kill`, `start` | |
| `client.add` | `client`, `name`, `conversation?` |
| `type` | `client?` (default `you`), `text`, `whenBusy?`, `requestId?` |
| `switch`, `abort`, `compact` (`instructions`), `fork` (`at`: `lastAnswer` / `firstAnswer` / an entry id, `title`) | `client?` |
| `conversation.create` | `title`, `agent`, `client?` (switches it there) |
| `configure` | `conversation` (`root` / `last` / `subagent` / an id), `change` |
| `install` | `extension` (`ops@2`, `venv@1`, `timing@1`) |
| `approve` | `ok?` (answers the open approval) |
| `fault` | `kind` (`overloaded` / `invalid`: the next model request fails) |
| `bank` | `card`, `latencyMs?`, `decline?` |
| `abortTask` | `kind` (the newest live task of that kind) |
| `inspect` | `kind` (`harness` or a task kind), `label?`: the page shows that chart |

The tour gets cues in return, so its transitions can wait on what happens:

- `harness.<state>`, `<task kind>.<state>` and `tool.<name>.<state>` (states entered);
- `client.<id>.<state>`;
- `commit.<name>`, and `commit.<name>.<tool>` for tool commits;
- `submit.admitted`, `submit.duplicate` and `submit.rejected`;
- `approval.asked`, `memo.<name>` and `hook.beforeTool.<extension>`;
- `installed.<extension>`, `process.started` and `process.killed`.
