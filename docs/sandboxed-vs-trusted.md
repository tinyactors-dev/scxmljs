# Sandboxed or trusted

SCXML charts contain ECMAScript: `<script>`, `expr`, `cond`, `<assign>` and so on. The package has
two entry points that differ only in *where* that code runs. Their APIs are identical, and both
pass the same W3C conformance suite ([report](conformance.md)).

| | `@tinyactors/scxmljs` (sandboxed) | `@tinyactors/scxmljs/trusted` |
|---|---|---|
| Engine | [QuickJS](https://bellard.org/quickjs/) compiled to WebAssembly, one context per session | the host's own engine: a hidden same-origin `<iframe>` per session in browsers, a `node:vm` context in Node and Bun |
| Browser download | 20 KB gzip, plus 290 KB of QuickJS loaded on demand | 17 KB gzip |
| Chart can reach the page | no | **yes**: the iframe's `parent` is your page |
| Runaway scripts | interrupted after `scriptTimeoutMs` (default 2 s) | not interruptible: the page hangs |
| Memory | capped per session by `memoryLimitBytes` (default 64 MiB) | shared with the page |
| Content-Security-Policy | needs `'wasm-unsafe-eval'` | needs `'unsafe-eval'` |
| Startup | `createSession` loads QuickJS once (about 15 ms) | synchronous |
| XML data values | a small DOM inside the sandbox | real DOM nodes |

Measurements are in [measurements](measurements.md); security details are in
[SECURITY.md](../SECURITY.md).

## Which one to use

- A chart that **someone else** wrote, pasted or uploaded: **sandboxed**. Its code can't read your
  page, cookies or other sessions, and a `while (true) {}` can't freeze the tab.
- A chart that **you** wrote and ship with your app: **trusted** is fine, and saves the
  WebAssembly download. It isn't a security boundary: treat the chart like any other script in
  your bundle.

Both keep sessions apart from each other: each session has its own global scope, so `<script>`
declarations persist across evaluations and two sessions (including invoked children) never share
variables. System variables such as `_sessionid` and `_event` are read-only in both.

<!-- doctest: run -->
```ts
import { createSession } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";

const { DOMParser } = new Window();
const chart = (script: string) => `
  <scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript">
    <state id="s"><onentry><script>${script}</script></onentry></state>
  </scxml>`;

// Each session has its own global scope …
const a = await createSession(chart("var secret = 42;"), { domParser: new DOMParser() });
const b = await createSession(chart("var seen = typeof secret;"), { domParser: new DOMParser() });
a.start();
b.start();
console.log(b.datamodel.evaluate("seen"));

// … and in the sandbox, a runaway script is interrupted instead of hanging the page.
const c = await createSession(chart("while (true) {}"), { domParser: new DOMParser(), scriptTimeoutMs: 100 });
c.addEventListener("error", (e) => console.log(e.kind));
c.start();

for (const s of [a, b, c]) s.dispose();
```

<!-- doctest: output -->
```text
undefined
error.execution
```

## Using both

The two entry points can be used in the same app. Sessions from either one are `SCXMLSession`s,
so code that works with sessions (and both elements) doesn't care which engine runs them:

- `<scxml-explorer>` shows sessions from either entry point and never loads an engine itself.
- `<scxml-view>` creates its own session when it loads a chart. It uses the sandbox unless it has
  the `trusted` attribute, and loads that engine on demand. Given your own session through its
  `session` property, it loads nothing.

<!-- doctest: check -->
```ts
import type { SCXMLSession } from "@tinyactors/scxmljs";
import { createSession as sandboxed } from "@tinyactors/scxmljs";
import { createSession as trusted } from "@tinyactors/scxmljs/trusted";

async function open(source: string, fromUser: boolean): Promise<SCXMLSession> {
  return fromUser ? sandboxed(source) : trusted(source);
}
```

Import only what you use: importing even one value from `@tinyactors/scxmljs` puts its (small)
loader in your bundle, and QuickJS is fetched the first time a sandboxed session is created.

## Limits

These `SessionOptions` apply to the sandbox:

| Option | Default | |
|---|---|---|
| `scriptTimeoutMs` | 2000 | maximum run time of one evaluation (a `<script>`, one `expr`…); it then fails with `error.execution` |
| `memoryLimitBytes` | 64 MiB | memory of the session's QuickJS context; allocations beyond it fail with `error.execution` |

This one applies to both:

| Option | Default | |
|---|---|---|
| `maxMicrosteps` | 100 000 | microsteps in one macrostep before the session stops with `error.platform` (an eventless loop) |

## How each engine works

**Sandboxed.** Each session gets its own QuickJS context inside one shared WebAssembly module.
Values cross the boundary as copies (plain data; functions stay inside). Evaluations run under an
interrupt handler that enforces the timeout, and the context has its own memory limit.

**Trusted.** In browsers, each session creates a hidden, same-origin `<iframe>` and evaluates the
chart's code with that iframe's own `eval`, so the chart gets a fresh global object. In Node and
Bun, each session gets a `node:vm` context. Values are copied at the boundary too, so a chart can't
change your objects through event data. But the iframe is same-origin: the chart's code can reach
`parent`, and nothing can interrupt a loop.

Both engines share one implementation of the SCXML data-model rules, so behaviour matches. The
remaining differences are listed in [deviations](deviations.md).

## Advanced: another engine

`SessionOptions.datamodel` takes a `DataModelFactory`, which creates a `DataModel` per session.
Both entry points set it for you. Implementing your own is possible (the interface is exported),
but you then own the SCXML data-model semantics that the conformance suite checks.
