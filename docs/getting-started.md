# Getting started

This guide takes one chart from a file to a running, interactive diagram: install, write the
chart, run it headless, then render it in a page.

## Install

```sh
npm install @tinyactors/scxmljs
```

Outside browsers you also need a `DOMParser` to read SCXML text. Any standards-compliant one
works; the examples use [happy-dom](https://github.com/capricorn86/happy-dom):

```sh
npm install happy-dom
```

## Write a chart

`traffic-light.scxml` cycles through three colours on a timer and counts completed cycles. The
`power.off` event ends it, and its final state returns the count as `<donedata>`.

<!-- doctest: scxml file=traffic-light.scxml -->
```xml
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="traffic-light" initial="on">
  <datamodel>
    <data id="cycles" expr="0"/>
  </datamodel>
  <state id="on" initial="red">
    <transition event="power.off" target="off"/>
    <state id="red">
      <onentry><send id="timer" event="timer" delay="3s"/></onentry>
      <onexit><cancel sendid="timer"/></onexit>
      <transition event="timer" target="green"/>
    </state>
    <state id="green">
      <onentry><send id="timer" event="timer" delay="3s"/></onentry>
      <onexit><cancel sendid="timer"/></onexit>
      <transition event="timer" target="yellow"/>
    </state>
    <state id="yellow">
      <onentry><send id="timer" event="timer" delay="1s"/></onentry>
      <onexit><cancel sendid="timer"/></onexit>
      <transition event="timer" target="red">
        <assign location="cycles" expr="cycles + 1"/>
      </transition>
    </state>
  </state>
  <final id="off">
    <donedata><param name="cycles" expr="cycles"/></donedata>
  </final>
</scxml>
```

Each colour schedules its own timer when it's entered and cancels it when it's left. So
`power.off` can end the chart at any time without a stale timer firing later.

`createSession()` validates the document when it compiles it. Mistakes such as an unknown target
throw an `SCXMLValidationError` that lists every problem at once. Likely mistakes that are still
valid SCXML appear as [authoring warnings](#authoring-warnings) on `session.model.warnings`.

### Authoring warnings

`model.warnings` lists `Diagnostic` objects (`code`, `severity`, `message`, `element`, `state`)
for valid SCXML that very likely doesn't do what you meant. Nothing is rejected: `<scxml-view>`
shows them above the diagram (`warnings="off"` hides them) and the explorer lists them in each
state's details.

| Code | Means |
|---|---|
| `SCXML_W_EXITS_PARALLEL` | a transition on a parallel region resets the whole parallel state (see below) |
| `SCXML_W_UNREACHABLE` | no initial state, transition or history default can ever enter the state |
| `SCXML_W_NEVER_DONE` | a `done.state.X` / `done.invoke.X` transition waits for something that can't happen |
| `SCXML_W_SHADOWED` | an earlier transition in the same state, without a condition, always wins |

The first one is the easiest trap to fall into. A transition is *external* unless it says
otherwise, and an external transition exits and re-enters its source's nearest *compound*
ancestor. A `<parallel>` isn't compound, so a transition written on one region, targeting that
region's own states, exits the whole parallel state and resets **every** region:

<!-- doctest: run -->
```ts
import { createSession } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";

const chart = (type: string) => `
  <scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript">
    <parallel id="desk">
      <state id="ticket" initial="open">
        <transition event="assign" target="assigned"${type}/>
        <state id="open"/>
        <state id="assigned"/>
      </state>
      <state id="sla" initial="within">
        <state id="within">
          <transition event="tick" target="breached"/>
        </state>
        <state id="breached"/>
      </state>
    </parallel>
  </scxml>`;

for (const type of ["", ' type="internal"']) {
  const session = await createSession(chart(type), { domParser: new new Window().DOMParser() });
  session.start();
  session.send("tick"); // the SLA region moves on…
  session.send("assign"); // …and assigning the ticket should leave it alone
  await session.settled();
  console.log(session.model.warnings.map((w) => w.code), session.activeStateIds());
  session.dispose();
}
```

<!-- doctest: output -->
```text
[ "SCXML_W_EXITS_PARALLEL" ] [ "desk", "ticket", "assigned", "sla", "within" ]
[] [ "desk", "ticket", "assigned", "sla", "breached" ]
```

Without `type="internal"`, assigning the ticket silently reset the SLA region to `within`.

## Run it

`createSession()` compiles the chart and returns a session that hasn't started yet. `start()`
enters the initial states, `send()` queues an external event, and `settled()` resolves once the
session has processed everything queued.

<!-- doctest: run files=traffic-light.scxml -->
```ts
import { readFile } from "node:fs/promises";
import { createSession } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";

const { DOMParser } = new Window();
const source = await readFile("traffic-light.scxml", "utf8");
const session = await createSession(source, { domParser: new DOMParser() });

session.start();
console.log(session.activeStateIds()); // the configuration, in document order
session.send("timer");
await session.settled();
console.log(session.isActive("green"));
session.send("power.off");
console.log(await session.done); // resolves with the <donedata> when the chart ends
session.dispose(); // always: releases the session's sandbox, timers and listeners
```

<!-- doctest: output -->
```text
[ "on", "red" ]
true
{
  cycles: 0,
}
```

(The exact formatting of `console.log` depends on your runtime; this is Bun's.)

### Time: real, virtual or played back

A session takes its time from a *clock*. The default, `realClock`, uses real time, so the
`delay="3s"` timers above really take three seconds. Tests and tools use a `VirtualClock`
instead: time only moves when you move it, and everything is deterministic.

<!-- doctest: run files=traffic-light.scxml -->
```ts
import { readFile } from "node:fs/promises";
import { createSession, VirtualClock } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";

const { DOMParser } = new Window();
const clock = new VirtualClock();
const session = await createSession(await readFile("traffic-light.scxml", "utf8"), {
  clock,
  domParser: new DOMParser(),
});

session.addEventListener("macrostep", (e) => {
  // after the chart ends, the last macrostep reports an empty configuration
  const states = e.configuration.map((s) => s.id).join(" ") || "(terminated)";
  console.log(`${clock.now()} ms: ${states}`);
});
session.start();
clock.advance(7000); // fires every timer due within 7 virtual seconds
session.send("power.off");
clock.run(); // runs whatever is queued now
console.log(session.status, JSON.stringify(await session.done));
session.dispose();
```

<!-- doctest: output -->
```text
0 ms: on red
3000 ms: on green
6000 ms: on yellow
7000 ms: on red
7000 ms: (terminated)
done {"cycles":1}
```

A `PlaybackClock` is a virtual clock that real time drives at an adjustable speed, and it can be
paused and stepped. That's what the elements use for their playback controls: see
[playback](playback.md). For tests, see [testing](testing.md).

## Render it

### The whole chart: `<scxml-view>`

`<scxml-view>` loads a chart, validates it, runs it and draws it. It needs no JavaScript of your
own beyond importing it once:

<!-- doctest: html files=traffic-light.scxml -->
```html
<script type="module">import "@tinyactors/scxmljs/view";</script>

<scxml-view src="traffic-light.scxml"></scxml-view>
```

States are nested boxes, transitions are orthogonal arrows, and the active configuration is
highlighted. Each transition label is a button that sends its event. By default the element runs
the chart in the QuickJS sandbox, which it loads on demand; add the `trusted` attribute for charts
you wrote yourself to skip that download. The [`<scxml-view>` reference](view.md) lists every
attribute, property and event.

The bare specifier `@tinyactors/scxmljs/view` needs a bundler or an import map; see
[bundling](bundling.md).

### A running system: `<scxml-explorer>`

For big charts, or several machines talking to each other, `<scxml-explorer>` shows one level at
a time: a tree of states, a focus on one compound state, the events accepted right now, and a
System level with every invoked machine and external service. You create the session; the
explorer shows it.

<!-- doctest: check -->
```ts
import { createSession, PlaybackClock } from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/explorer";

const source = await (await fetch("traffic-light.scxml")).text();
const clock = new PlaybackClock({ speed: 1 });
const session = await createSession(source, { clock });

const explorer = document.querySelector("scxml-explorer")!;
explorer.attach({ session, clock });
session.start();
```

The page needs a `<scxml-explorer></scxml-explorer>` element. The [`<scxml-explorer>` reference](explorer.md)
covers the element API, keyboard use, slots and translations.

## Next steps

- [Sandboxed or trusted](sandboxed-vs-trusted.md): which entry point to import.
- [Driving charts from the page](driving-charts.md): buttons and forms that send events.
- [Theming](theming.md): make the elements look like your app.
- [Custom I/O processors](io-processors.md) and [custom invokers](invokers.md): connect charts to the outside world.
