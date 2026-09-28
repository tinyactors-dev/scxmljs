# Custom invokers

`<invoke>` starts a service while its state is active and stops it when the state is left. The
interpreter runs `type="scxml"` itself: the service is a child session. Every other `type` is
handled by an *invoker* that you pass to `createSession()` as `invokers`.

An invoker is a function. It receives an `InvokeContext` and returns an `InvokedService` (or a
promise of one):

| `InvokeContext` | |
|---|---|
| `invokeid` | the `id` attribute, or a generated `stateid.platformid` |
| `type`, `src` | the `type`/`typeexpr` and `src`/`srcexpr` values |
| `content` | inline `<content>`: an Element, or the value of `content/@expr` |
| `params` | the `<param>` and `namelist` values |
| `sendToParent(name, data?)` | send an event to the invoking session (it arrives with `invokeid` set) |
| `done(data?)` | the service finished: the parent receives `done.invoke.<invokeid>` |

| `InvokedService` | |
|---|---|
| `send(event)` | an event from the parent: a `<send target="#_<invokeid>">`, or autoforwarded with `autoforward="true"` |
| `cancel()` | the invoking state was exited: stop, and don't call `sendToParent` or `done` any more |

If the invoker throws or its promise rejects, the parent gets `error.execution`. Events the parent
sends before the service is ready are held and delivered once it is.

## Example: a countdown

<!-- doctest: scxml file=countdown.scxml -->
```xml
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="launch" initial="counting">
  <state id="counting">
    <invoke id="countdown" type="countdown">
      <param name="from" expr="3"/>
    </invoke>
    <transition event="tick">
      <log label="tick" expr="_event.data.left"/>
    </transition>
    <transition event="abort" target="aborted"/>
    <transition event="done.invoke.countdown" target="launched"/>
  </state>
  <final id="launched">
    <onentry><log label="launched"/></onentry>
  </final>
  <final id="aborted"/>
</scxml>
```

The invoker takes its time from the session's clock, so it works with a `VirtualClock` in tests and
a `PlaybackClock` in the elements (pause and step included):

<!-- doctest: run files=countdown.scxml -->
```ts
import { readFile } from "node:fs/promises";
import { createSession, type Invoker, VirtualClock } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";

const clock = new VirtualClock();

const countdown: Invoker = (ctx) => {
  let left = Number(ctx.params.from);
  const tick = () => {
    left--;
    if (left > 0) {
      ctx.sendToParent("tick", { left });
      timer = clock.setTimeout(tick, 1000);
    } else ctx.done();
  };
  let timer = clock.setTimeout(tick, 1000);
  return {
    send(event) {}, // this service ignores events from the parent
    cancel: () => clock.clearTimeout(timer),
  };
};

const { DOMParser } = new Window();
const session = await createSession(await readFile("countdown.scxml", "utf8"), {
  clock,
  domParser: new DOMParser(),
  invokers: { countdown },
});
session.addEventListener("log", (e) => console.log(`${clock.now()} ms: ${e.label} ${e.value ?? ""}`.trim()));
session.start();
clock.advance(5000);
console.log(session.status);
session.dispose();
```

<!-- doctest: output -->
```text
1000 ms: tick 2
2000 ms: tick 1
3000 ms: launched
done
```

Sending `abort` before the countdown ends exits `counting`, which cancels the invocation: the
invoker's `cancel()` clears its timer.

Inside the elements, pass invokers through `options`: `view.options = { invokers: { countdown } }`
for `<scxml-view>`, or to `createSession()` for sessions you show in `<scxml-explorer>`.

## SCXML children

`<invoke type="scxml">` (or the type URI `http://www.w3.org/TR/scxml/`) starts a child session
from inline `<content>`, or from `src`. For `src` (and for `<script src>` and `<data src>`), the
session needs a `loader`: a function from the `src` value to the text, synchronous or async.

<!-- doctest: check -->
```ts
import { createSession } from "@tinyactors/scxmljs";

const base = new URL("/charts/", location.href);
const loader = async (src: string) => (await fetch(new URL(src, base))).text();
const session = await createSession(await loader("main.scxml"), { loader });
```

`<scxml-view>` sets a loader for you that resolves against the chart's URL. Children run in the
same data model (sandboxed or trusted) as their parent, with their own global scope, and get the
parent's clock, I/O processors, invokers and loader. The `child` event on the parent session hands
you each child before it starts; `session.invocations` lists the running ones.
