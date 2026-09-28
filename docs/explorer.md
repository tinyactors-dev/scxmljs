# `<scxml-explorer>`

`<scxml-explorer>` explores a running system one level at a time. It never draws a whole chart,
so it stays usable for charts with thousands of states and for many machines invoking each other.

![<scxml-explorer> showing an order-fulfilment system](https://raw.githubusercontent.com/tinyactors-dev/scxmljs/main/docs/images/explorer-light.webp)

It has two levels:

- **System**: every machine (the root session and the sessions it invoked), every external
  service (I/O processors), and the messages between them. Links light up while traffic flows.
- **Machine**: one machine at a time.
  - A **tree** of its states on the left, with the active path expanded and highlighted.
  - The **focus** in the middle: one compound or parallel state, its children, the transitions
    between them, and "doors" to states outside it. When it gets crowded, it switches from a
    diagram to a list. In the list, each state says what it does and how it leaves: its entry
    actions and invokes, and its transitions as "event → target" (with an `if` mark for a
    condition). While a state is active, those are buttons that send the event. A click opens
    the row in place with every transition, action and way in, and a link to the full detail.
  - The **inspector** on the right: the events the machine accepts right now (each name is a
    button that sends it; event data sits behind a disclosure), and the details of the selected
    state. At the System level it shows the selected service, and the tree is hidden.

The header holds the levels, the breadcrumb, the playback controls and the Follow toggle. Under
the title, one line says what the last step did. Colour means one thing each: the running colour
marks what is active, the waiting colour what just happened (the arrow the last step took, the
transition just taken and the state it left, marked "last visited").

Below 760 px of width, the panes become tabs.

## Use

You create the session; the explorer shows it. It works with sessions from either entry point and
never loads a data model itself.

<!-- doctest: check -->
```ts
import { createSession, PlaybackClock } from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/explorer";

const source = await (await fetch("traffic-light.scxml")).text();
const clock = new PlaybackClock({ speed: 1 });
const session = await createSession(source, { clock });

document.querySelector("scxml-explorer")!.attach({ session, clock });
session.start();
```

Attach before or after `start()`. The explorer finds invoked child sessions by itself. Pass the
session's I/O processors as `processors` to show them as services at the System level. Pass a
`PlaybackClock` (or create the session with one) to get play, pause, step and speed controls.

`detach()` stops showing the session and removes the explorer's listeners. It never disposes the
session: that's yours to do.

## Attributes

| Attribute | Default | |
|---|---|---|
| `follow` | `true` | `"false"` starts without following: the focus stays where the user put it |
| `announce` | `all` | what the live region reads out: `all` (steps and sent events), `sends`, or `off` |

## Properties and methods

| | |
|---|---|
| `attach({ session, processors?, clock? })` | show a root session. `clock` defaults to `session.clock`. |
| `detach()` | stop showing it |
| `session`, `processors`, `clock` | the same three, one at a time. Setting one re-attaches. |
| `follow` | keep the focus on the part of the machine that is moving. Reflected as the `follow` attribute; the header has a toggle for it. |
| `announce` | as the attribute |
| `announceInterval` | while a clock plays, announce steps at most this often (ms, default 3000) |
| `strings` | translations; see [custom UI and translations](custom-ui.md#translations) |

## Events

All events bubble and cross the shadow boundary.

| Event | `detail` | When |
|---|---|---|
| `scxml-focus` | `ExplorerFocusDetail`: `{ session, state }` | the focused state changed, by the user or by following |
| `scxml-select` | `ExplorerSelectDetail`: `{ session, state }` | a state was selected for the detail pane |
| `scxml-send` | `ExplorerSendDetail`: `{ session, name, data }` | the user is about to send an event. Cancelable. |

`session` is the machine the state belongs to: the root, or an invoked child.

<!-- doctest: check -->
```ts
import type { ExplorerSelectDetail, ExplorerSendDetail } from "@tinyactors/scxmljs/explorer";

const explorer = document.querySelector("scxml-explorer")!;
explorer.addEventListener("scxml-select", (e) => {
  const { state } = (e as CustomEvent<ExplorerSelectDetail>).detail;
  history.replaceState(null, "", `#${state.id}`);
});
explorer.addEventListener("scxml-send", (e) => {
  const { name, data } = (e as CustomEvent<ExplorerSendDetail>).detail;
  console.log("sending", name, data);
});
```

## Slots

Put your own content into the explorer with named slots. Slotted elements stay in your DOM, so
they work with any framework and any styling.

| Slot | Where |
|---|---|
| `state:<id>` | in the card of state `<id>` in the focus |
| `detail:<id>` | in the detail pane of state `<id>` |
| `event:<descriptor>` | in the row of that accepted event, e.g. a form for its data (`event:order.placed`) |
| `service:<name>` | in that service's card at the System level (`<name>` is the I/O processor's first alias, or its type) |
| `toolbar` | in the header, before the Follow toggle |
| `empty-tree`, `empty-events`, `empty-detail` | replace the "nothing here" messages |

<!-- doctest: html -->
```html
<scxml-explorer>
  <button slot="toolbar" type="button">Restart</button>
  <p slot="detail:checkout">Payment is handled by the payments team.</p>
  <span slot="empty-events">Waiting for the next order…</span>
</scxml-explorer>
```

Slots are only shown while their place exists: `detail:checkout` appears when `checkout` is
selected. [Custom UI](custom-ui.md) has a complete example.

## Keyboard and screen readers

- The tree follows the ARIA tree pattern: ↑ ↓ move, → expands or moves to the first child,
  ← collapses or moves to the parent, Home and End jump, Enter or Space focuses the state, and
  typing jumps to the next state whose name starts with those letters.
- Cards, rows, lanes and doors are focusable. In the diagram, Enter drills into a container or
  selects a state, and Space selects. In the list, Enter, Space or a click drills into a container
  and opens a leaf in place (its name button says whether it's expanded); the opened row links to
  the detail. Keyboard focus stays on the row when the view re-renders.
- With a `PlaybackClock`: Space plays and pauses, `.` steps. They don't apply in fields, buttons,
  rows and cards, which use those keys themselves.
- A polite live region announces steps and sent events. While a clock plays, step announcements
  are throttled to one per `announceInterval`.
- Several explorers on one page: give each an `aria-label`. It names the explorer's breadcrumb
  landmark ("Orders: Breadcrumb"), so screen-reader users can tell them apart.
- Checked with axe-core in Chromium, Firefox and WebKit (every level, both layouts, both themes):
  no violations. Controls are at least 24px tall (WCAG 2.2 target size), and cards and list rows
  are labelled groups whose state name is the primary button (controls never nest).
- Right-to-left pages: the layout mirrors, and so do the tree's disclosure triangles. Arrows
  written inside labels (→) don't.

## Styling

The explorer uses the shared `--scxml-*` tokens (see [theming](theming.md)). It fills
`--scxml-height` (default: the smaller of 860 px and the viewport height minus 32 px), and tree
rows are `--scxml-row-height` tall (default 30 px).

Parts, with their modifiers (added while they apply):

| Area | Parts |
|---|---|
| Header | `top`, `levels`, `crumbs`, `crumb` (`current`), `follow` |
| Playback (in the header) | `playback`, `play`, `step`, `speeds` (a `<select>`), `clock` |
| Tree | `tree-pane`, `tree-search`, `tree`, `tree-row` (`path` `active` `match`) |
| Focus | `focus-pane`, `title`, `last-step`, `diagram`, `card` (`path` `active` `waiting` `final` `selected` `visited`), `edges`, `edge-label` (`live` `fired` `collapsed`), `list`, `list-row` (`path` `active` `visited` `open`), `visited`, `row-actions`, `row-exits`, `row-event` (`fired`), `row-detail`, `open-detail`, `lanes`, `lane` (`path`), `lane-row` (`active` `visited`), `doors`, `door` (`exit` or `entry`, `live`) |
| Accepted events | `inspector`, `event-search`, `scopes`, `event-data` (a `<details>`), `events`, `event-group`, `event-row` (`here`, `inherited` or `elsewhere`), `send` (the event's name) |
| Details | `detail`, `warning` |
| System level | `system`, `machine` (`running` `done` `hot`), `service` (`selected` `hot`) |
| Narrow layout | `tabs`, `tab` (`selected`), `strip` |
| Anywhere | `empty` |

## The view-model

Everything the explorer shows is computed by pure functions exported from
`@tinyactors/scxmljs/explorer`: `treeRows`, `focusScope`, `acceptedEvents`, `groupEvents`,
`followTarget`, `SystemTracker` and more. Use them to build your own explorer with your own
components; see [custom UI](custom-ui.md#build-your-own-explorer).
