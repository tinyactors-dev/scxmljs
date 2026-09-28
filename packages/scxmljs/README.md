# @tinyactors/scxmljs

Run [SCXML](https://www.w3.org/TR/scxml/) statecharts in the browser, in Node and in Bun, and show them
running. The interpreter implements SCXML 1.0 with the ECMAScript data model and passes all 160
automatic mandatory W3C conformance tests. Two custom elements draw running charts: `<scxml-view>`
shows a whole chart and needs no JavaScript, and `<scxml-explorer>` explores large, multi-machine
systems one level at a time. They are plain custom elements, so they work with any framework.

<!-- readme-media:start -->
![<scxml-explorer> with a running order-fulfilment system](https://raw.githubusercontent.com/tinyactors-dev/scxmljs/main/docs/images/explorer-light.webp)
<!-- readme-media:end -->

## Install

```sh
npm install @tinyactors/scxmljs
```

Node 22.3 or later, Bun, or any current browser. The package is ESM only.

## Quick start

A chart, `traffic-light.scxml`:

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

**Draw it and run it**, with no JavaScript of your own. Import the element once (through your
bundler, or an [import map](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/bundling.md)):

<!-- doctest: html files=traffic-light.scxml -->
```html
<script type="module">import "@tinyactors/scxmljs/view";</script>

<scxml-view src="traffic-light.scxml"></scxml-view>
```

The element loads, validates, runs and draws the chart. Active states are highlighted, and each
transition label is a button that sends its event.

![A media player chart drawn by <scxml-view>: the "playing" and "audible" states are active](https://raw.githubusercontent.com/tinyactors-dev/scxmljs/main/docs/images/view-light.webp)

**Explore a running system** with `<scxml-explorer>`: a tree of states, a focus on one level of
the chart, the events the machine accepts right now, and playback controls.

<!-- doctest: check -->
```ts
import { createSession, PlaybackClock } from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/explorer";

const source = await (await fetch("traffic-light.scxml")).text();
const clock = new PlaybackClock({ speed: 0.5 }); // adds pause, step and speed controls
const session = await createSession(source, { clock });
document.querySelector("scxml-explorer")!.attach({ session, clock });
session.start();
```

**Run it headless**, for example in Node or in tests:

<!-- doctest: run files=traffic-light.scxml -->
```ts
import { readFile } from "node:fs/promises";
import { createSession } from "@tinyactors/scxmljs";
import { Window } from "happy-dom"; // outside browsers, SCXML text needs a DOMParser

const { DOMParser } = new Window();
const source = await readFile("traffic-light.scxml", "utf8");
const session = await createSession(source, { domParser: new DOMParser() });

session.start();
console.log(session.activeStateIds().join(" "));
session.send("timer");
await session.settled();
console.log(session.activeStateIds().join(" "));
session.send("power.off");
console.log(JSON.stringify(await session.done));
session.dispose();
```

<!-- doctest: output -->
```text
on red
on green
{"cycles":0}
```

The [getting-started guide](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/getting-started.md) walks through all three.

## Entry points

| Import | What | Size (min + gzip) |
|---|---|---|
| `@tinyactors/scxmljs` | the interpreter, **sandboxed**: chart code runs in QuickJS (WebAssembly) | 20 KB, then 290 KB loaded on demand |
| `@tinyactors/scxmljs/trusted` | the same API, **trusted**: chart code runs in the host's own JavaScript engine | 17 KB |
| `@tinyactors/scxmljs/view` | `<scxml-view>`: a whole chart, drawn and running, zero-JS | 33 KB, plus the engine it loads |
| `@tinyactors/scxmljs/explorer` | `<scxml-explorer>` and its view-model: explore a running system | 25 KB |
| `@tinyactors/scxmljs/themes/tinyactors.css` | an optional theme stylesheet | 0.3 KB |

Sizes are for a browser bundle of each entry on its own (`mise run size` in the repository).

## Sandboxed or trusted?

Both interpreter entry points have the same API and pass the same conformance suite. They differ
in where the chart's ECMAScript (`<script>`, `expr`, `cond`) runs:

- **Sandboxed** (`@tinyactors/scxmljs`, the default): one QuickJS context per session. The chart
  can't see the page or other sessions, runaway scripts are interrupted, and memory is capped.
  Use it for charts that users write, paste or upload.
- **Trusted** (`@tinyactors/scxmljs/trusted`): a separate realm of the host engine per session (a
  hidden iframe in browsers, a `node:vm` context in Node and Bun). No WebAssembly to download, but
  the chart can reach the page and a loop can't be interrupted. Use it for charts you wrote.

Details: [sandboxed vs trusted](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/sandboxed-vs-trusted.md) and [SECURITY.md](https://github.com/tinyactors-dev/scxmljs/blob/main/SECURITY.md).

## Documentation

- [Getting started](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/getting-started.md)
- Elements: [`<scxml-view>`](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/view.md), [`<scxml-explorer>`](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/explorer.md), [theming](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/theming.md), [custom UI and translations](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/custom-ui.md), [large charts](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/large-charts.md), [frameworks](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/frameworks.md)
- Interpreter: [sandboxed vs trusted](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/sandboxed-vs-trusted.md), [driving charts from the page](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/driving-charts.md), [custom I/O processors](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/io-processors.md), [custom invokers](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/invokers.md), [playback and stepping](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/playback.md), [testing](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/testing.md), [Node and servers](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/node-and-servers.md)
- Shipping: [bundling, CDNs and classic scripts](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/bundling.md), [Content-Security-Policy](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/csp.md)
- Reference: [conformance report](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/conformance.md), [deviations from the spec](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/deviations.md), [measurements](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/measurements.md), API reference (`mise run docs:api` in the repository)

## Support

| | Status |
|---|---|
| Chrome / Edge (Chromium) | tested in CI (Chromium 153) |
| Firefox | tested in CI (Firefox 155) |
| Safari | tested in CI with WebKit 26.6 (Safari's engine, not Safari itself) |
| Node | 22.3 or later; tested in CI on 26.10, by hand on 22.3 |
| Bun | tested in CI (1.4) |
| Deno | tested in CI (2.9) |

The [support table](https://github.com/tinyactors-dev/scxmljs/blob/main/docs/bundling.md#support) lists what each environment needs.

## Stability

The package is at 0.x. Breaking changes can happen in minor versions until 1.0, and every one is
listed in the [changelog](https://github.com/tinyactors-dev/scxmljs/blob/main/CHANGELOG.md). Everything the entry points export is public API; anything
else (and anything marked `@internal`) is not.

## Contributions

This project doesn't accept outside contributions. Please report security problems as described
in [SECURITY.md](https://github.com/tinyactors-dev/scxmljs/blob/main/SECURITY.md).

## License

MIT. QuickJS and quickjs-emscripten are MIT-licensed too; see `THIRD_PARTY_NOTICES`.
