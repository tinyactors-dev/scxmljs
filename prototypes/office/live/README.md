# Live mode: the Office, running, still until you act

`index.html?live=<system>` (or a `· LIVE` plate in the directory by the door) runs a system of
statecharts **in the page**, on a `VirtualClock` that never advances by itself. The office is
still. Nothing moves until the visitor presses something in the room:

- **inputs** from outside the system are push buttons on a bakelite lectern where that input
  enters: the people's hatch, a person's desk, a service's machine. A button whose event the
  chart would ignore right now (no active state takes it, or its `cond` is false) is grey and
  sunk into its bezel; a live one has a coloured cap that stands proud;
- **time** is the TIME console under the wall clock (and the clock itself): ADVANCE TIME runs
  virtual time to the next due timer; its title plate says what is pending (`TIMER DUE IN 1 S`),
  and a red flag stands on the clock while something is. The FLOW · STEP lever switches to
  stepping, where ONE HOP releases one causal hop at a time;
- **lifecycle** is a console of its own where the system has one (place an order, a person
  joins, LEAVE at one's desk);
- **START OVER**, the big red lever by the door, boots the system again.

The engine runs a press's whole causal chain at once; the room then plays it back, capsule by
capsule, at the replay's pace (`sim.hopSec`), and comes to rest. At rest, the controls that would
do something breathe (a slow glow): the only idle motion. `&still=1` turns that off (tests).
The board grows with the run; touching the past shows that moment (controls go inert, the TIME
plate says `LOOKING BACK`); ADVANCE TIME or the clock returns to now.

| `?live=` | What you can click | Charts |
|---|---|---|
| `microwave` (default) | OPEN/CLOSE DOOR, TURN ON/OFF at the hatch; the cooking tick waits for ADVANCE TIME | `charts/microwave/` (site/charts) |
| `checkout` | ADD NOTEBOOK/MUG, REMOVE MUG, CHECKOUT (inert while the cart is empty: its cond is judged), BACK, SHIP, PAY BY CARD/VOUCHER; NEW SHOPPER once the order is placed | `charts/checkout/` (docs/examples) |
| `fulfillment` | four kinds of order at the shop; per order desk: APPROVE REVIEW, REJECT, HOLD, RELEASE, NEW ADDRESS, CUSTOMER CANCELS; the bank holds each card authorization until APPROVE or DECLINE; the other services answer when time advances | `charts/fulfillment/` (examples/playground) |
| `llm-chat` | the real examples/llm-chat system: things Ada and Bo say at the hatch; the model's ANSWER lever; the tools' RUN THE TOOLS lever; people and tool providers join at the door console and LEAVE / GO OFFLINE at their desk | bundled in `vendor/llm-chat.js` |

## Files

| File | What |
|---|---|
| `live.js` | the driver: boots a system definition under the tracer, feeds the sim, paces playback |
| `controls.js` | the meshes: consoles, buttons, levers, the TIME console, the reset lever |
| `catalog.js` | the list of live systems (the directory imports it without the engine) |
| `systems/<name>.js` | one system: its charts, stand-ins, inputs and payloads, lifecycle controls |
| `charts/<name>/` | committed copies of the charts the page fetches |
| `vendor/` | GENERATED bundles: `scxmljs.js` (the library, trusted data model), `tracer.js`, `llm-chat.js`; `SOURCE-HASH` |
| `entries/` | the sources of the bundles that are not the library or the tracer |
| `build.ts` | makes `vendor/` |
| `test-live.mjs` | the browser test (not published) |

**Rebuild the bundles** after changing the library (`packages/scxmljs/src`), the tracer, the
llm-chat example or `entries/`:

```sh
bun prototypes/office/live/build.ts            # writes live/vendor/*.js and SOURCE-HASH
bun prototypes/office/live/build.ts --check    # exit 1 when vendor/ is stale
```

The library bundle uses the **trusted** data model (`packages/scxmljs/src/trusted.ts`): the
charts here are our own, so no sandbox is needed, it needs no WebAssembly (75 KB minified against
the QuickJS build's megabyte), and session creation is synchronous inside, so a press settles in a
few milliseconds. Every bundle imports the library as `./scxmljs.js`: one copy, one session
registry.

**Test:** `node prototypes/office/live/test-live.mjs [system...] [--shots]` (Playwright from
`/opt/node-tools`, software GL). Per system: loads, two screenshots 3 s apart are identical
(`still=1`), presses controls with a real mouse click at the screen point the page reports,
checks `window.live.snapshot()` after each, checks the room comes to rest, START OVER, still
again. `--shots` writes close-ups of every console to `live/out/` (git-ignored).

## The interface (what `main.js` uses)

```js
import { bootLive } from "./live/live.js";
const live = await bootLive("microwave");   // boots the system; the room starts at rest
live.sim, live.trace, live.office            // the growing sim (core/sim.js, created with {live}); office.json-like overrides
live.controls()      // [{id, at, kind: 'button'|'lever', label, enabled, press(), group?, console?, title?, event?, actor?}]
                     //   at: an actor id (its desk) or an external id (its station)
live.pendingTimers() // [{actor|null, due (trace ms), in (ms from now), id}]
live.advance()       // virtual time to the next due timer, run its chain
live.step()          // stepping: release one more causal hop
live.setStepping(b)  // FLOW (false) or STEP (true)
live.reset()         // boot the system again (the same sim object, emptied)
live.on('change', fn)// the run grew (or was reset): the world rebuilds from live.sim
live.released()      // the playback second the room may play up to now
live.restS(), live.atRest(), live.setPlayhead(s)   // the world reports its playhead every frame
live.viewPast(s), live.returnToNow(), live.viewingPast
live.send(actorId, event, data)    // what a brass button in a head does
live.snapshot()      // {now, traceNow, actors: {id: {states, values, status}}, pendingTimers, playS, restS, atRest, ...}
// added by main.js: live.screen() → each control's screen point; live.pressControl(id)
```

`controls.js`: `createControls({scene, live, still}) → {rebuild(world), sync(), update(amb), pick(raycaster), near(x, y, camera, w, h), press(id), screenPositions(camera, w, h)}`;
`world` is `{plan, stations, sim, building, people, desks, t(), nameOf}`. A console stands 1.15 m in
front of a station (beside a machine's plate) or in the aisle at a desk's front corner.

### A system definition (`systems/<name>.js`)

```js
export default {
  title, app: {id, label, kind: "user"},       // the endpoint inputs come from (its station holds them)
  externals: [{id, label, kind}],              // declared up front, so their stations stand at rest
  office: {plan: {stations: [...]}},           // office.json overrides (plan.showIdleExternals is on)
  preload: ["chart.scxml"],                    // fetched from charts/<name>/
  identify(session, info), resolveOrigin, appCause,   // passed to the tracer
  sessionOptions(ctx),                         // extra options for every ctx.spawn
  inputs: {at: "app"|"desk", only, hide, order, skip(actorId), labels, payloads, variants: {event: [{label, data}]}},
  async boot(ctx), dispose(ctx),
  controls(ctx) → [{id, at, label, kind, enabled, press, console, title, color}],
  snapshot(ctx),
};
// ctx: clock, tracer, state (per run), load(file), spawn(file, who, options), engine(hint), as(endpoint, fn),
//      sessions(), session(actorId), send(actorId, event, data, from), track(promise),
//      advanceWhile(pred), advanceBy(ms) (inside a press), live
```

Inputs are derived from the charts: the events a running session's transitions listen for that
no chart sends (`<send>`/`<raise>`), minus `done.*`, `error.*` and the replies of the processors
and invokers the charts name; `inputs` narrows and labels them. A press of an input is
`session.send(event, payload)` attributed to the app endpoint.

## How time works

Trace time is virtual time plus an offset that grows by 1 s of trace at every press, so two
presses at the same virtual instant are two instants of the trace and their chains never
interleave. A recorded timer's due moves with the offset, so a desk timer rings when its send
really fires (a synthetic `timer`/`fired` event marks it). In the sim (`createSim(trace, {live})`)
the gap before an instant is when the visitor acted (from the playhead at the press), each hop
gets a fixed `hopSec`, and nothing is rescaled, so earlier instants keep their playback times as
the run grows. The room's ambient animation (`wamb` in main.js) runs only while the playhead is
short of what the driver released.
