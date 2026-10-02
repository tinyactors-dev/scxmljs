# pi-durable

A working model of [Pi Durable](https://earendil.com/posts/pi-durable/) (Earendil's durable
agent harness, [source](https://github.com/earendil-works/pi/tree/main/packages/durable)), where
every task the harness runs is a statechart. It runs entirely in one browser tab:

- a storage that survives the process;
- a harness process you can kill at any moment and start again;
- clients on "other machines" that reconnect;
- a simulated model, machine and bank, all on one clock.

The page is /demos/pi-durable/ on the website (`site/client/pi-durable.ts`). To run it:
`mise run site:build && mise run site:serve`, then open
http://localhost:4400/demos/pi-durable/.

## The page

- **Stage.** The clients sit side by side, one column each ("+ Add a client" adds another person).
- **Sidebar.** A sidebar docked on the right, full height, shows Process (the harness, the task
  ownership tree, the registry) or Storage (the records, the working set, the commit log). Drag its
  edge to resize it (or focus the edge and use the arrow keys). » collapses it to a ribbon of
  icons; on narrow screens it slides over the page.
- **Story focus.** A chapter picks the panel a caption talks about (the `panel` param of `note`,
  or the chapter's `panel` in `src/tour.ts`).
- **Pacing.** A chapter opens paused and pauses at every caption: Next plays on to the next one.
  `?autoplay=1` runs straight through, `?speed=` sets the speed.
- **Inspector.** It is a mode: "chart" on a client, a task row or a tool slot (or the caption's
  "Open the chart" when the tour points at one) replaces the stage with `<scxml-explorer>`. The
  simulation keeps running; Esc or "Back to the simulation" returns.

## The post, section by section

Each chapter of the tour is a scenario chart in `charts/tour/`. It boots a fresh world, drives it
through the `stage` processor, and captions each step. On the page, every ¶ button opens the
passage it illustrates (`src/post.ts`: verbatim quotes and text-fragment links).

| Section of the post | Chapter | What to look at |
|---|---|---|
| What is a harness? | `01-harness` | Storage, Process and Clients columns; `pi.generation` and `pi.tool` charts |
| Long runs anywhere | `02-anywhere` | storage owner and commit log (the JSONL file); a conversation with its own `cwd`; process 2 takes over |
| Survives crashes | `03-crashes` | job-42: `tool.scxml` `execute.resume` (safe → `run`, else `tool.interrupted`); `generation.convertPartial`; `submit.duplicate`; the inbox survives |
| Many conversations at once | `04-conversations` | fork at an answer (inherited entries); `pi.agent` per conversation; two runs at once |
| Extensions › System prompt sections | `05-sections` | the positional `pi.system` entries |
| Extensions › Tools | `06-tools` | `triage`: a subagent conversation owned by the call, rerun after a crash; `venv` override plus `timing` wrap |
| Extensions › Hooks | `07-hooks` | the beforeTool chain (`approval`, then `freeze`); the `approval:deploy` memo across a crash |
| Extensions › Tasks | `08-tasks` | `checkout.scxml`/`payment.scxml`: failFast, bottom-up abort, refunds; a background `reminder.scxml` that survives Esc and restarts |
| Compaction | `09-compaction` | the context meter; `compaction.scxml` (background, manual); `handoff` → `pi.reset`; `search_history` |
| Durable application state | `10-documents` | the `app.todos` document, committed with the transcript; a fork's todos `asOf` the fork entry |
| Malleable | `11-malleable` | install `ops@2` while `ops@1`'s deploy runs; the next call and the next process use `ops@2` |
| Multiplayer | `12-multiplayer` | `client.scxml`: view first, then ops; `whenBusy` steer, followUp and reject |

## Files

| Path | |
|---|---|
| `charts/harness.scxml` | one process: `Harness.open` (acquire, reconcile), then `resume()` |
| `charts/generation.scxml`, `tool.scxml`, `compaction.scxml` | the built-in tasks `pi.generation`, `pi.tool`, `pi.compaction` |
| `charts/checkout.scxml`, `payment.scxml`, `reminder.scxml` | the post's `shop.checkout`, `shop.payment`, and a background `app.reminder` |
| `charts/client.scxml` | a client: attach (view), ops, reconnect, resubmit by `requestId` |
| `charts/tour/*.scxml` | the tour, one chapter per section of the post |
| `PROTOCOL.md` | every processor, invoker and event the charts use |
| `src/types.ts` | Pi's records: tasks, conversations, entries, submissions, documents |
| `src/storage.ts` | `Storage` (survives the process) and `Tx` (one atomic commit) |
| `src/conversation.ts` | admission, runs, the inbox's two boundaries, abort, forks: as transactions |
| `src/harness.ts` | the process: the `durable` processor (named commits), the invokers, the scheduler, views |
| `src/registry.ts`, `src/extensions.ts` | extensions (tools, sections, hooks, wraps, tasks), resolved by name |
| `src/model.ts`, `src/env.ts` | the simulated model (a playbook), the machine (files, commands) and the bank |
| `src/wire.ts`, `src/system.ts` | the clients' link, and one world with a `stage` for the tour |
| `src/post.ts`, `src/tour.ts` | the post's passages, and the chapters |

Every task chart has the same outer shape, the task's lifecycle:
`recover` (route to the stored status and phase) · `live` { `running` (the definition's phases)
· `waiting` · `completing` } · `aborting` { `draining` (owned work first, bottom-up) · the abort
handler } · `terminal`.

Charts never write storage. Each step is a named commit (`<send type="durable">`) that the harness
applies in one transaction, checkpoint included. A new process recreates each live task's
session from its record.

```sh
bun test examples/pi-durable
```

`test/system.test.ts` pins the semantics (crash recovery, exactly-once, failFast, memos,
forks, steering, compaction, the malleable registry) and runs every chapter to its end.
`tests/site/site.pw.ts` covers the page.

## Simplifications

This is a model of Pi Durable, not a port. Its names, statuses and rules are Pi's (see
`src/types.ts`), but:

- one storage backend (memory);
- one model (scripted);
- `watch()` ops are a simple diff per commit;
- hooks cover beforeTool and afterTool only;
- no task versioning or migrations;
- compaction cuts at user messages.
