# Deviations from the SCXML specification

`@tinyactors/scxmljs` implements [SCXML 1.0](https://www.w3.org/TR/scxml/) with the
ECMAScript data model. It passes all 160 mandatory automatic W3C conformance tests
and the 8 applicable manual ones (see [conformance/MANUAL.md](../conformance/MANUAL.md)),
in both data models.

This page lists every place where the library leaves out part of the spec, extends it,
or makes a choice the spec leaves open. Each point is pinned by a test, in
`packages/scxmljs/test/deviations.test.ts` unless noted.

## Not included

- **The Basic HTTP Event I/O Processor** (spec Appendix C.2). Twelve optional W3C
  tests need it (201, 509, 510, 518, 519, 520, 522, 531, 532, 534, 567, 577), plus the
  manual test 513. A host can add one as a custom `IOProcessor`.
- **`_event.raw`** is always `undefined`. The spec defines it for the Basic HTTP
  processor; the SCXML Event I/O Processor has no wire format to put there.
- **`#_scxml_<sessionid>` targets** reach only sessions in the same JavaScript
  realm (the same page, or the same process). There is no cross-process transport.

## Data models

- **`datamodel="null"`** is supported. Its only expressions are `In('state')`
  conditions, which the ECMAScript engine evaluates. `<data>`, `<assign>`, `<script>`
  and `<foreach>` are rejected at load time.
- **XML values** (a `<data>` or `<content>` whose content is XML) are DOM objects, as
  the spec requires, but different ones in each engine:
  - **sandboxed:** a small DOM implemented inside QuickJS (`getElementsByTagName`,
    `getAttribute`, `setAttribute`, `childNodes`, `children`, `textContent`,
    `documentElement`, …). It is serialised to XML text when it leaves the engine.
  - **trusted:** real DOM nodes (copies of the source), handed out as nodes.
- **Values crossing into and out of the data model are copies.** Going in (event
  data, `data` option, invoke parameters): functions and symbols become `undefined`,
  `Date`s become their timestamp, and a reference back into its own ancestors (a
  cycle) becomes `undefined`. Going out (`<log>`, send payloads, `<donedata>`,
  `evaluate()`, `snapshot()`), both engines apply the same rules:
  - top-level primitives pass through unchanged (including `undefined`, `NaN`, `-0` and
    bigints), and a top-level function becomes `undefined`;
  - inside objects and arrays, JSON's rules apply: keys holding `undefined` or functions
    are dropped, such array entries become `null`, `NaN` and `Infinity` become `null`,
    and bigints become strings;
  - `toJSON()` is honoured (so `Date`s become ISO strings); `Map`s and `Set`s become
    plain objects of their own keys;
  - cyclic references are dropped.
- **Repeated `<param>` names** collect their values in an array
  (`{ Var1: [2, 3] }`). The spec requires every pair to be kept, but leaves the
  shape to the data model (W3C test 178).
- **Expressions may end with a semicolon** (`expr="x + 1;"`), as authors often
  write. The spec's grammar doesn't allow it.
- **An empty `expr` on `<log>`** logs no value instead of raising
  `error.execution` (W3C test 307 writes `<log expr=""/>`).

## Scheduling and limits

- **External events are asynchronous.** `session.send()`, delayed `<send>`s and
  replies from I/O processors are queued and processed one at a time by the session's
  clock (`clock.defer`), never inside the caller's stack. The internal queue is
  drained synchronously within each macrostep, as the spec requires.
- **Invoked sessions start synchronously** at the end of the macrostep that
  entered the invoking state. When the source comes from an asynchronous `loader`,
  they start as soon as it has arrived (unless the invoking state has been exited
  meanwhile, in which case the child never starts).
- **`maxMicrosteps`** (default 100,000) stops a macrostep that never settles
  (an eventless loop), raises `error.platform` and ends the session. The spec would
  let it run forever.
- **The sandbox limits every evaluation** to `scriptTimeoutMs` (default 2 s) and
  64 MB of memory. Exceeding either raises `error.execution`. The trusted engine
  can't interrupt a runaway script.

## Load-time validation

- Documents are **validated strictly when compiled**, and every problem is reported at
  once in an `SCXMLValidationError` (unknown targets, duplicate ids, illegal initial
  states, targets that can't be active together, misplaced or unknown elements, and so
  on). The spec allows a processor to reject a non-conformant document; this one does
  so eagerly, instead of failing later at run time.
- A `<script src>` that can't be loaded rejects the document (spec §5.8; W3C test
  301). A `<data src>` that can't be loaded raises `error.execution` and leaves the
  variable `undefined`.
- An `<invoke>` whose source can't be loaded or compiled raises `error.execution`
  in the invoking session.
- **Warnings** (`model.warnings`) point out likely mistakes that are still valid
  SCXML. See [authoring warnings](getting-started.md#authoring-warnings).
