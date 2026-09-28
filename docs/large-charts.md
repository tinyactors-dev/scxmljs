# Large charts

Charts grow: a support desk with a few hundred states, a generated chart with thousands, a root
machine that invokes a dozen others. Both the interpreter and the elements are built for that.
Numbers are from [measurements](measurements.md) (Apple M4 Max, Chrome 154).

## The interpreter

Compiling is linear in the size of the chart: about 3 ms for 1 000 states and 23 ms for 5 000
(Bun), plus the time your DOMParser needs. A running session costs about 110–170 KB for a small
chart; a system of 15 machines with 330 states costs about 3 MB. Sessions don't leak: create,
run and dispose them as often as you like.

- **Share the model.** `compile()` once, then pass the `Model` to `createSession()` for each
  session. A model is read-only and can be shared by any number of sessions.
- **Dispose.** A sandboxed session holds a QuickJS context until `dispose()`.
- **Runaway loops.** `maxMicrosteps` (default 100 000) stops a session whose eventless
  transitions never settle, with `error.platform`, instead of freezing the page.

<!-- doctest: check -->
```ts
import { compile, createSession, parseSCXML } from "@tinyactors/scxmljs";

const model = await compile(parseSCXML(await (await fetch("support-desk.scxml")).text()));
const sessions = await Promise.all(Array.from({ length: 100 }, () => createSession(model)));
```

## Which element

| | `<scxml-view>` | `<scxml-explorer>` |
|---|---|---|
| Shows | the whole chart at once | one level at a time, plus a tree |
| Comfortable up to | about 150 boxes; bigger charts are folded | thousands of states (measured with 5 000) |
| Several machines | the root machine only | every machine and service, and the messages between them |
| Needs your JavaScript | no | yes: you create the session |

Use `<scxml-view>` to show a chart. Use `<scxml-explorer>` to understand a big system, or to
operate it.

## `<scxml-view>` folds

When a chart has more boxes than `max-states` (default 150), the view folds the largest compound
states into single boxes until it fits. It chooses the folds around the states that are active
when the chart loads, so they stay visible. When the machine later moves into a folded state, the
folded box is highlighted as active. A notice says how many states are folded,
with **Expand all**; each folded box has **Expand**, and each expanded one **Collapse**.

A 1 000-state chart draws 137 boxes and renders in about 45 ms from a running session, or 58 ms
from text (including parsing, compiling and loading the engine).

<!-- doctest: html files=player.scxml -->
```html
<scxml-view src="player.scxml" max-states="6" fit></scxml-view>
```

Raise `max-states` to fold less (the layout slows down with the number of boxes); lower it for a
compact overview. `fit` scales the drawing down to the element's width instead of scrolling.

## `<scxml-explorer>` stays small

The explorer never draws more than one level of the chart:

- The tree is windowed: only the rows in view are in the DOM (about 30), so scrolling through
  5 000 states stays at one frame per scroll step. It has a search field and an "active only"
  filter.
- The focus shows one compound state's children. With more than 9 children, or with crowded
  transitions, it switches from a diagram to a list; parallel states show their regions as lanes.
- Long lists (accepted events, transitions, machines) are grouped, filterable, and cut off with
  "+N more".

First render of a 5 000-state chart takes about 10 ms.

## Many machines

A root session that invokes others is a *system*. The explorer's System level shows every
machine, including ones that already finished, and every I/O processor, with links that light up
while messages flow. Selecting a machine opens it at the Machine level. `SystemTracker`, from
`@tinyactors/scxmljs/explorer`, gives you the same information for your own UI (see
[custom UI](custom-ui.md#build-your-own-explorer)).
