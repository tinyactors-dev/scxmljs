# Systems recorded by the tracer

Every trace is `data/<system>/trace.json`, made by `drivers/<driver>.ts` (rerun: see README.md),
deterministic, checked by `check.ts`. Times are virtual. "Actors" = total over the run / alive at
peak. Causes = share of transitions / messages / spawns with a `cause` (uncaused messages are
outside stimuli: people, webhooks, scripts).

| system | driver | duration | actors | events | causes | size | charts |
|---|---|---|---|---|---|---|---|
| `llm-chat-dynamic` | llm-chat-dynamic | 28.6 s | 17 / 15 | 3778 | 100% / 98% / 53% | 1.18 MB | 5 |
| `pi-durable` | pi-durable | 42.6 s | 44 / 10 | 2439 | 100% / 97% / 77% | 0.78 MB | 8 |
| `pi-durable-tour-crashes` | pi-durable-tour | 44.2 s | 20 / 6 | 1509 | 100% / 99% / 90% | 0.40 MB | 5 |
| `pi-durable-tour-tasks` | pi-durable-tour | 32.1 s | 20 / 9 | 1063 | 100% / 99% / 95% | 0.30 MB | 8 |
| `pi-durable-tour-multiplayer` | pi-durable-tour | 17.6 s | 10 / 6 | 966 | 100% / 98% / 90% | 0.29 MB | 5 |
| `fulfillment` | fulfillment | 44.0 s | 14 / 7 | 721 | 100% / 93% / 57% | 0.22 MB | 3 |
| `github-issues` | github-issues | 23.2 s | 9 / 9 | 267 | 100% / 83% / 0% | 0.08 MB | 1 |
| `support-desk` | samples | 62.0 s | 15 / 15 | 2043 | 100% / 92% / 93% | 0.55 MB | 15 |
| `gatekeeper-sample` | samples | 62.0 s | 1 / 1 | 197 | 100% / 97% / 0% | 0.05 MB | 1 |
| `many` | many | 53.5 s | 61 / 22 | 1736 | 100% / 83% / 98% | 0.29 MB | 2 |
| `downloads` | singles | 14.8 s | 5 / 2 | 208 | 100% / 88% / 80% | 0.04 MB | 2 |
| `launch` | singles | 8.5 s | 3 / 2 | 38 | 100% / 93% / 0% | 0.01 MB | 1 |
| `order-api` | singles | 3.6 s | 4 / 1 | 31 | 100% / 100% / 0% | 0.01 MB | 1 |
| `single-login` | singles | 10.0 s | 1 / 1 | 29 | 100% / 0% / 0% | 0.00 MB | 1 |
| `single-checkout` | singles | 10.3 s | 1 / 1 | 39 | 100% / 0% / 0% | 0.01 MB | 1 |
| `single-player` | singles | 14.5 s | 1 / 1 | 39 | 100% / 0% / 0% | 0.01 MB | 1 |
| `single-microwave` | singles | 14.2 s | 1 / 1 | 72 | 100% / 58% / 0% | 0.01 MB | 1 |
| `single-blank` | singles | 6.6 s | 1 / 1 | 33 | 100% / 43% / 0% | 0.01 MB | 1 |
| `frameworks-player` | singles | 6.4 s | 1 / 1 | 15 | 100% / 0% / 0% | 0.00 MB | 1 |

## What happens in each run (what the world should show)

### llm-chat-dynamic: clients join and leave throughout
Host, shared workspace, 6 package downloads (workspace children) and a scenario director are there
from the start. 0.0 s Ada joins; 0.5 s Bo; 1.0 s the director (provider-leaves scenario) adds
Terminal and Python; 2.5 s Ada asks for both tools, the model calls shell (Terminal) and python
(Python) in parallel; **4.1 s Python leaves while its call is pending** (ends `disposed`), the host
answers its call with an error; 5.0 s the director reaches its final state and ends. 5.9 s Postgres,
the Statechart Lab and a Viewer join: **7 clients at peak** (15 actors alive). 7.1 s Bo asks about
orders: sql on Postgres. 10.7 s Python rejoins (a new actor `python~2`, identity `python`,
incarnation 2). 11.1 s Ada's question runs the Lab and Python in parallel; 11.8 s Bo goes offline
(nothing reaches him: the bus drops it, so no message to or from Bo appears until 17.1 s, when he
comes back and resyncs: `client.resync`, the log's `snapshot`).
17.9 s the Viewer leaves, 18.4 s the Terminal leaves; 19.2 s a shell question nobody can answer;
21.0 s Postgres goes offline with a sql call pending, back at 23.7 s, the call completes;
26.7 s the Lab and 27.1 s Python leave. Ada, Bo, host, workspace and packages run to the end.
Externals: `people` (the panels), `log` (the chat log's broadcasts), `bus`, `stage`, `llm`,
`tool.<client>` (each client's own tool runtime).
Gaps: the chat log is host code, so its broadcasts come from `log` (caused, inferred, by the host's
latest log command); model token streaming shows only as `llm → host` messages and log batches.

### pi-durable: tasks of every kind, two crashes, resumption
One harness actor per process; each task (pi.generation, pi.tool, app.reminder, shop.checkout,
shop.payment, pi.compaction) is an actor from its first event to its terminal state; two clients
(Ada `you`, Bo `bo`) live on other machines and survive the crashes. 0.4 s a reminder (background
app.reminder with a timer); 3.9 s a repo question (generation, bash + read tools, generation);
7.8 s Bo's three-card checkout: one payment declines, the checkout fails fast, the others refund;
11.9 s Ada asks why checkout is slow, bash starts. **13.4 s process 1 is killed: the harness and
the three running tasks (reminder t3, generation t16, bash t17) end at the same instant with
`reason: "disposed"`.** 14.6 s process 2 opens the storage: `harness~2` spawns, then at 14.9 s
`t3-reminder~2`, `t16-model-request~2`, `t17-bash~2` spawn (same `identity`, incarnation 2) and
resume from their checkpoints. 17.5–36 s more questions; a background pi.compaction (t26) runs at
~34 s; the reminder fires at 21.6 s. 36.7 s Bo checks out with two cards; **37.9 s process 2 is
killed** (harness~2, reminder t22, generation t27, checkout tool t28, checkout t29 end); 38.9 s
process 3 (`harness~3`) resumes them as incarnations 2; payments refund by 40 s.
Externals: `process` (the harness process code: storage, scheduler, wire server; it sends tasks
their events and clients their views), `durable` (commits), `people`, and the invoked services
(`model`, `prepare`, `resolve-tool`, `hooks`, `tool`, `bank`, `outcomes`, `compaction-select`).
Gaps: the process is TypeScript, so what it does between a commit and the next task event is
inferred (`appCauseWindowMs: 60`); spawns of tasks right after a restart have no cause.

### pi-durable-tour-*: the tour chapters (crashes, tasks, multiplayer)
The post's chapters run by their own director chart through the stage; the captions are the
tour's own notes. `crashes`: job-42, two crashes (ends `disposed`, incarnations 2 and 3).
`tasks`: checkout with payments, a reminder, aborted tasks. `multiplayer`: a late client, steers.
Other chapters: `bun drivers/pi-durable-tour.ts <chapter-id>` (ids in examples/pi-durable/src/tour.ts).

### fulfillment: six orders with invoked payment and shipment machines
Six order actors (`order-SO-…`), each invoking `…/payment` and later `…/shipment` (children
spawn with the invoke and end with it), six fake services as externals (risk, crm, warehouse,
email, payments, carrier) and `shop` (the web shop and back office). 0.8 s SO-10482 (3-D Secure
challenge, admin hold at 9 s and release via deep history at 11.5 s, an address change redirected
by the shipment machine at 17 s, a late cancel refused at 21 s; completes at 30.4 s);
2.4 s SO-10483: **payment declined three times** (two delayed retries) → paymentFailed → closed at
10.8 s; 4.3 s SO-10484: **cancelled while picking** (9.4 s), payment refunded, closed at 10.2 s,
no shipment; 6.3 s SO-10485: rejected by fraud screening (no payment machine), closed at 7.3 s;
8.3 s SO-10486: redirected in transit, completes at 30.9 s; 14.2 s SO-10487: manual review,
approved, completes at 43 s. Every actor ends `done`.

### github-issues: the webhook gatekeeper, one machine per issue
The server's setup (Gatekeeper, session per issue, sessions live on). 0 s dhamidi's issue kept
(labelled triage); 1.5 s mallory's spam: comment and label in parallel, then closed; 4.2 s eve's:
the close fails once, back-off timer, retry, closed; 7.2 s a burst of three issues at once, three
new machines; 9.7 s mallory reopens #2, the same machine closes it again; 11.7 s peggy's: three
close failures, the machine ends in `failed`; 17.7 s a maintainer adds peggy to #8's allowlist and
she reopens it: kept; 20.2 s a push webhook nobody hears, and victor's issue closed. 9 actors at
the end, none ends. Externals: `webhooks`, `github` (API calls and their answers), `maintainers`.

### support-desk: the playground's generated stress chart (sample-drive)
One root chart of 333 states, depth 10, one state with 65 children, a 10-region parallel floor,
deep history; 14 invoked child machines (intake channels, teams, monitors) alive the whole run;
5 fake services. The sample's own journey script for 60 s (a maintenance window with history).
Good for the head (wide and deep charts); nothing spawns or dies after the start.

### gatekeeper-sample: the explorer's gatekeeper sample (one session, issues queue in its datamodel)

### many: scale (synthetic support desk, charts in `charts/`)
A dispatcher and 60 ticket machines over 53 s: tickets arrive every 0.25–0.85 s from `customers`,
the dispatcher sends `spawn` to the `pool` service, which starts a ticket machine (spawn caused by
that message). Tickets triage (delayed self-send), refunds are escalated (`#_scxml_` send to the
dispatcher, which approves 800 ms later with a delayed send and a send back), bugs wait 1.5 s for
the customer, then each resolves, reports and ends `done`. ~20 alive from 8 s to 40 s (peak 22),
all 60 tickets end; the dispatcher's state goes quiet → busy → swamped (≥ 15 open) and back.

### Small ones (one chart each; the degenerate cases)
- `single-login`: flat, a guard on event data (a login without a user is ignored), sign in/out twice.
- `single-checkout`: flat with a datamodel (cart, address, paidWith), back and forth, ends in `placed` (the actor ends `done`).
- `single-player`: `<parallel>` transport and sound with a shallow `<history>`: muted, stopped, played again, still muted.
- `single-microwave`: `<parallel>` engine and door with `In()`, a 1 s self-send timer (set/cancel events), door opened mid-cook.
- `single-blank`: the playground's blank chart (a counter, a delayed send cancelled on exit).
- `frameworks-player`: the framework apps' two-state player (no datamodel).
- `downloads`: a download manager invoking a child machine per download (4 children over the run, one cancelled: `reason: "cancelled"`); progress via `#_parent`, `done.invoke`.
- `launch`: the docs' countdown invoker (an external service ticking back), three launches, the second aborted; each launch is an actor that ends.
- `order-api`: the docs' order chart and a stub `api` processor: four orders, the third fails (`error.communication`, final `failed`).

## Known gaps (all systems)
- Causes are exact for steps; links through application code (a process, a chat log, an I/O
  processor's own logic) are inferred and marked `inferred: true`.
- A send to a processor counts as reaching a session only when the session receives the same event
  name and data object at the same instant (llm-chat's bus, the workspace link); latency-bearing
  processors (pi-durable's wire, 60 ms) show as messages to and from the processor's external.
- What a processor drops is invisible: a broadcast that some recipients never got (offline) shows
  only the deliveries that happened.
- Values are truncated; the largest datamodels (pi-durable clients' `view`) are cut to fit 700
  characters per value.
- Charts are deduplicated by structure; the support desk's 14 children are 14 charts because their
  state ids differ.
- Not recorded: llm-chat's real Claude path, real WebAssembly tools; the framework apps' UI (only
  their chart); `examples/llm-chat` scenarios other than provider-leaves (cheap: change the scenario).
