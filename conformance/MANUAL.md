# The manual W3C tests

Nine tests in the W3C suite are marked *manual*: a person reads the output and
decides. `bun conformance/manual.ts [ids…]` runs them in both data models and prints
everything that's needed (log lines and errors from the root session and every invoked
child, the events processed, and how the run ended). Each verdict below was reached by
reading that output against the test's own instructions. The ones that can be checked
mechanically are pinned in `conformance.test.ts`, so they can't regress silently.

Both data models (sandboxed and trusted) give the same verdict for every test.

| Test | What a person has to check | Verdict |
|---|---|---|
| 178 | A `<send>` with two `<param name="Var1">` keeps both key/value pairs. | **Pass.** `_event.data` is `{ Var1: [2, 3] }`: a repeated name collects its values in an array. The test prints `_event.raw`, which is `undefined`, because the SCXML Event I/O Processor has no wire format to show. `raw` belongs to the Basic HTTP processor. |
| 230 | An autoforwarded event has the same fields in the parent and in the child. | **Pass.** Parent and child log identical `name`, `type`, `sendid`, `origin`, `origintype`, `invokeid` and `data`. |
| 250 | Cancelling an invoked session runs the onexit handlers of its active states. | **Pass.** The child logs `Exiting sub01`, then `Exiting sub0`, and never reaches its final state. *Fixed in phase 5b: the child used to start one task later, so it was cancelled before it had entered any state.* |
| 301 | A document whose `<script src>` can't be loaded is rejected. | **Pass.** `compile` rejects it with an `SCXMLValidationError` naming the script; the session never runs. |
| 307 | With `binding="late"`, reading a not-yet-bound variable behaves like reading a missing substructure. | **Pass.** Both read `undefined` without an error (`no error in s0`, `No error in s1`). *Fixed in phase 5b: `<log expr="">` used to raise `error.execution`; an empty `expr` now logs no value.* |
| 313 | An illegal expression (`expr="return"`) either rejects the document or raises `error.execution`. | **Pass.** It raises `error.execution` when the `<assign>` runs (reaches `pass`). |
| 314 | Such an error is raised only when that expression is evaluated, not earlier. | **Pass.** No error until `s03` is entered (reaches `pass`). |
| 415 | Entering a top-level final state halts the machine before the event it raises is processed. | **Pass.** The session is done in `final`; `event1` is never processed. |
| 513 | The Basic HTTP processor answers a posted event with HTTP 200 (checked by hand with `wget`). | **Not applicable.** The Basic HTTP Event I/O Processor isn't included (see [docs/deviations.md](../docs/deviations.md)). |
