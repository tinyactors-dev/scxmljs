# Security

## Reporting a vulnerability

Email **dario.hamidi@gmail.com** with "scxmljs security" in the subject. Please don't open a
public issue. Include what you found, how to reproduce it, and the version. You'll get an answer
within a week. There is no bug bounty.

## Supported versions

Until 1.0, only the latest `0.x` release gets fixes. A fix is released as a new version; older
versions aren't patched.

## What the sandbox protects

The default entry point, `@tinyactors/scxmljs`, runs each session's ECMAScript (`<script>`,
`expr`, `cond`, `<assign>`…) in its own [QuickJS](https://bellard.org/quickjs/) context, inside
WebAssembly. It is meant for charts you don't trust: written, pasted or uploaded by users.

A chart's code **can't**:

- read or change the page, its DOM, cookies, storage, or JavaScript globals;
- make network requests, or reach any host API: the context has only the standard ECMAScript
  built-ins, the SCXML system variables and `In()`;
- see other sessions' data, including its own invoked children and its parent;
- run forever: each evaluation is interrupted after `scriptTimeoutMs` (default 2000 ms) and fails
  with `error.execution`;
- use unlimited memory: each context is capped at `memoryLimitBytes` (default 64 MiB); allocations
  beyond it fail with `error.execution`.

Values cross the boundary as copies. Event data and `<data>` values are plain data; functions
never leave the sandbox.

What the sandbox **doesn't** protect against, because the chart's *structure* is trusted input to
the interpreter even when its code isn't:

- **Events and sends.** A chart can `<send>` events to anything the session can reach: its parent,
  its children, and every I/O processor you configured. Your I/O processors and invokers are
  the chart's capabilities; give untrusted charts only the ones they should have, and validate
  what they receive.
- **Loading.** `<script src>`, `<data src>` and `<invoke src>` go through the session's `loader`.
  `<scxml-view>`'s default loader fetches any URL relative to the chart. Pass your own loader to
  restrict it.
- **Busy loops across steps.** `scriptTimeoutMs` limits one evaluation, and `maxMicrosteps`
  (default 100 000) one macrostep. A chart can still keep a session busy with a stream of
  delayed events. Dispose sessions you no longer want.
- **Denial of service by size.** Parsing and compiling a huge document takes time and memory
  before any limit applies. Limit the size of charts you accept.
- **Rendering.** The elements show state ids, event names and log values as text, never as HTML.
  They are still text chosen by the chart author.

QuickJS vulnerabilities are ours to handle: the package pins the QuickJS build it ships, and a
security fix in QuickJS or in quickjs-emscripten will be released as a new version of this
package. Report them to us as well as upstream.

### Setting the limits

<!-- doctest: check -->
```ts
import { createSession } from "@tinyactors/scxmljs";

const session = await createSession(untrustedSource, {
  scriptTimeoutMs: 500, // per evaluation
  memoryLimitBytes: 16 * 1024 * 1024, // per session
  maxMicrosteps: 10_000, // per macrostep
  ioprocessors: [], // no capabilities beyond the built-in SCXML processor
  loader: () => {
    throw new Error("loading is disabled");
  },
});
declare const untrustedSource: string;
```

For `<scxml-view>`, set the same options through its `options` property.

## The trusted entry point is not a sandbox

`@tinyactors/scxmljs/trusted` runs chart code in the host's own JavaScript engine. It separates
sessions' global variables, but it is **not a security boundary**:

- **In browsers**, each session evaluates code in a hidden, *same-origin* iframe. The chart's code
  can reach `parent`, and with it your page, its DOM, cookies and storage.
- **In Node and Bun**, each session uses a `node:vm` context. `node:vm` is not a security
  mechanism; code can escape it and reach the process.
- **No interruption.** A `while (true) {}` in a chart hangs the page or the server;
  `scriptTimeoutMs` and `memoryLimitBytes` don't apply.
- **CSP.** It needs `'unsafe-eval'` in `script-src` (the sandbox only needs
  `'wasm-unsafe-eval'`), and it doesn't work with Trusted Types. See
  [docs/csp.md](docs/csp.md).

Use it only for charts you wrote or reviewed, like any other script you ship. `<scxml-view>` uses
the sandbox unless you add the `trusted` attribute.

More: [sandboxed or trusted](docs/sandboxed-vs-trusted.md), [Content-Security-Policy](docs/csp.md).
