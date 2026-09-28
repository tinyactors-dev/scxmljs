# Testing charts

Charts are easy to test: give the session a `VirtualClock`, send events, move time, and check the
configuration and the data. Nothing waits for real time, and the same test always gives the same
result. The examples use `bun test`; any test runner works.

## A chart

<!-- doctest: test files=traffic-light.scxml -->
```ts
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createSession, VirtualClock } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";

const { DOMParser } = new Window();
const source = await readFile("traffic-light.scxml", "utf8");

async function start() {
  const clock = new VirtualClock();
  const session = await createSession(source, { clock, domParser: new DOMParser() });
  session.start();
  return { clock, session };
}

test("cycles red → green → yellow → red and counts the cycles", async () => {
  const { clock, session } = await start();
  expect(session.activeStateIds()).toEqual(["on", "red"]);

  clock.advance(3000);
  expect(session.isActive("green")).toBe(true);

  clock.advance(4000);
  expect(session.isActive("red")).toBe(true);
  expect(session.snapshot()).toEqual({ cycles: 1 });
  session.dispose();
});

test("power.off ends the chart at any time, with the count as donedata", async () => {
  const { clock, session } = await start();
  clock.advance(3500); // in green
  session.send("power.off");
  clock.run();
  expect(session.status).toBe("done");
  expect(await session.done).toEqual({ cycles: 0 });
  session.dispose();
});
```

What the clock does:

- `clock.run()` runs everything that's queued now (such as events you sent), then every timer, in
  time order, until nothing is left. Charts whose timers re-arm themselves never run out, so give
  those a limit: `clock.run(until)` stops at the absolute time `until`.
- `clock.advance(ms)` moves time forward by `ms`, running everything that falls due on the way.
- `clock.runNext()` runs exactly one task, for checking what happens in between.
- `clock.now()`, `clock.pending` and `clock.nextTimerAt` show where things stand.

With a `VirtualClock`, `send()` only queues the event: it's processed at the next `run()`,
`advance()` or `runNext()`.

`session.snapshot()` returns the values of every `<data>` element as plain data, from either data
model. Create a fresh session per test; always `dispose()` it (a sandboxed session holds a QuickJS
context).

## Waiting for a state

`session.waitFor()` resolves when a state is active, or all of several are, or a predicate holds.
It's convenient when the test doesn't control time, for example with real I/O:

<!-- doctest: check prelude=session -->
```ts
await session.waitFor("saved", { timeoutMs: 5000 }); // rejects with a TimeoutError, or when the chart ends first
await session.waitFor(["playing", "muted"]); // all of them
await session.waitFor((s) => s.isActive("done") || s.isActive("failed"));
```

`timeoutMs` is measured on the session's clock. `session.steps()` is an async iterator over
macrosteps, for asserting on the whole sequence:

<!-- doctest: check prelude=session -->
```ts
const seen: string[][] = [];
for await (const step of session.steps()) seen.push(step.configuration.map((s) => s.id));
```

## Both data models

The two entry points behave the same, and your tests can check that your chart does too: run the
same test against both.

<!-- doctest: check -->
```ts
import { describe } from "bun:test";
import * as sandboxed from "@tinyactors/scxmljs";
import * as trusted from "@tinyactors/scxmljs/trusted";

for (const [name, { createSession }] of [["sandboxed", sandboxed], ["trusted", trusted]] as const) {
  describe(name, () => {
    // …the tests above, using this createSession
  });
}
```

## UI that drives a chart

Page code that uses `bind()` or `connect()` can be tested in happy-dom, with no browser:

<!-- doctest: test files=login.scxml -->
```ts
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { bind, createSession } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";

test("the login form signs in", async () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = `
    <form data-scxml-send="login"><input name="user" value="ada"><button>Log in</button></form>
    <button id="logout" data-scxml-send="logout">Log out</button>`;

  const session = await createSession(await readFile("login.scxml", "utf8"), { domParser: new window.DOMParser() });
  session.start();
  bind(session, document as unknown as Document, { reflectEnabled: true });
  const logout = document.querySelector("#logout")!;
  expect(logout.hasAttribute("data-scxml-enabled")).toBe(false);

  document.querySelector("button")!.click(); // submits the form
  await session.settled();
  expect(session.isActive("signed-in")).toBe(true);
  expect(session.snapshot()).toEqual({ user: "ada" });
  expect(logout.hasAttribute("data-scxml-enabled")).toBe(true);
  session.dispose();
});
```

(The cast is needed because happy-dom's types differ slightly from the DOM's.)

## The elements

`<scxml-view>` and `<scxml-explorer>` work in happy-dom too. A custom element can only be
registered once per process, so install happy-dom's globals (`window`, `document`,
`HTMLElement`, `customElements`, `CSSStyleSheet`…) once, before importing the element module, and
keep all tests for one element in one file. For layout and visual checks, use a real browser.
