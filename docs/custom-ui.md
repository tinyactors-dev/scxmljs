# Custom UI and translations

The elements can be adapted at four levels, from small to large:

1. [Theme](theming.md) them with tokens and `::part()`.
2. [Translate](#translations) or reword every string.
3. Put your own content into [`<scxml-explorer>`'s slots](#slots).
4. Keep the engine and build your own UI: [draw charts yourself](#draw-it-yourself) with the
   exported layout, or [build your own explorer](#build-your-own-explorer) on its view-model.

## Translations

Every user-visible string of both elements comes from their `strings` property. Set a partial
object; keys you leave out keep their English default. Strings that include a value or a count
are functions, so the translation controls word order and plural forms:

<!-- doctest: check -->
```ts
import "@tinyactors/scxmljs/explorer";
import "@tinyactors/scxmljs/view";

const plural = new Intl.PluralRules("de");

document.querySelector("scxml-view")!.strings = {
  expand: "Aufklappen",
  collapse: "Zuklappen",
  statesInside: (n) => `${n} ${plural.select(n) === "one" ? "Zustand" : "Zustände"}`,
  announceSent: (name) => `${name} gesendet`,
};

document.querySelector("scxml-explorer")!.strings = {
  follow: "Folgen",
  transitions: (n) => `${n} ${plural.select(n) === "one" ? "Übergang" : "Übergänge"}`,
  kind: (kind) => ({ atomic: "Zustand", compound: "Zusammengesetzt", parallel: "Parallel", final: "Endzustand", history: "Historie", scxml: "Maschine" })[kind],
};
```

The keys, with their English defaults, are the `ViewStrings` and `ExplorerStrings` types, also
exported as `defaultViewStrings` and `defaultExplorerStrings` (a good starting point for a complete
translation). Right-to-left layouts haven't been checked yet.

## Slots

`<scxml-explorer>` has named slots for your own content, listed in its
[reference](explorer.md#slots). Slotted elements belong to your page, so your framework renders
and styles them as usual.

A common one is a form for an event's data. The explorer's generic data field takes JSON; a slot
named `event:<descriptor>` puts a form into that event's row instead:

<!-- doctest: html -->
```html
<scxml-explorer id="explorer">
  <form slot="event:volume" id="volume-form">
    <input type="range" name="value" min="0" max="10">
    <button>Set volume</button>
  </form>
  <p slot="detail:muted">Muted players remember their volume.</p>
</scxml-explorer>
```

<!-- doctest: check prelude=session -->
```ts
const form = document.querySelector<HTMLFormElement>("#volume-form")!;
form.addEventListener("submit", (e) => {
  e.preventDefault();
  session.send("volume", { value: Number(new FormData(form).get("value")) });
});
```

(Or mark the form with `data-scxml-send="volume"` and [`bind()`](driving-charts.md#declarative-bind-and-data-scxml-) the session to the explorer.)

## Draw it yourself

`<scxml-view>`'s layout is exported, and it knows nothing about the DOM: give it sizes, get
positions. Use it to draw charts with SVG, canvas, or your framework's components.

<!-- doctest: run files=traffic-light.scxml -->
```ts
import { readFile, writeFile } from "node:fs/promises";
import { compile, parseSCXML } from "@tinyactors/scxmljs/trusted";
import { layoutChart } from "@tinyactors/scxmljs/view";
import { Window } from "happy-dom";

const { DOMParser } = new Window();
const model = await compile(parseSCXML(await readFile("traffic-light.scxml", "utf8"), new DOMParser()));

// sizes would normally come from measuring rendered text; fixed ones will do here
const layout = layoutChart(model.root, {
  measure: (state) => ({ w: 16 + 8 * state.id.length, h: state.children.length ? 28 : 36 }),
  labelSize: (t) => ({ w: 16 + 7 * t.events.join(" ").length, h: 18 }),
});

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" font-size="12">`,
  ...layout.boxes.map(
    ({ node, rect: r }) =>
      `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" fill="none" stroke="gray"/>` +
      `<text x="${r.x + 8}" y="${r.y + 18}">${node.id}</text>`,
  ),
  ...layout.edges.map((e) => `<polyline points="${e.points.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="black"/>`),
  "</svg>",
].join("\n");
await writeFile("traffic-light.svg", svg);

console.log(layout.boxes.map((b) => b.node.id || "(root)").join(" "));
console.log(layout.edges.map((e) => `${e.from.id}→${e.to.id}`).join(" "));
```

<!-- doctest: output -->
```text
(root) on red green yellow off
on→off red→green green→yellow yellow→red
```

- `measure(state, collapsed)` returns the size a state needs for its own content: the whole box
  for a leaf, the header band for a container (the layout adds room for the children).
- `labelSize(transition)` returns the size of a transition's label.
- `direction: "down"` lays layers out top to bottom; `collapsed` is a set of containers to draw as
  single boxes, and `autoCollapse(model.root, maxBoxes)` picks one for big charts; `spacing`
  overrides gaps.

The result has `boxes` (parents before children, so draw them in order), `edges` with orthogonal
`points` and a `label` rectangle, `initials` (initial-state markers), and `inside`: per box, the
transitions it should list itself (targetless ones, and ones hidden by folding). The same chart
always gives the same layout.

To animate the drawing, follow the session: `macrostep` for the active states, `microstep` for the
transitions that fired. Or let the session mark the chart's own elements with
[`reflect`](driving-charts.md#the-chart-as-your-markup).

## Build your own explorer

Everything `<scxml-explorer>` shows comes from pure functions, exported from
`@tinyactors/scxmljs/explorer`:

| | |
|---|---|
| `treeRows(model, { expanded, isActive, filter?, activeOnly? })` | the visible rows of the state tree, for a (windowed) list |
| `activeExpansion(model, isActive)` | the containers to expand so the active path is visible |
| `focusScope(model, focus, isActive)` | one level of the chart: children, the transitions between them (merged per pair), and doors in and out |
| `followTarget(configuration, current)` | where to focus to see everything that's active |
| `acceptedEvents(session, focus)` | the events the machine accepts now, scoped `here`, `inherited` or `elsewhere` relative to the focus |
| `groupEvents(events)` | the same, grouped by their first dotted token |
| `new SystemTracker(session, processors)` | every machine and service in a system, and the traffic between them; fires `change` |

Example, with the media player from the screenshots
([`player.scxml`](examples/player.scxml)):

<!-- doctest: run files=player.scxml -->
```ts
import { readFile } from "node:fs/promises";
import { createSession, type StateNode } from "@tinyactors/scxmljs/trusted";
import { acceptedEvents, activeExpansion, followTarget, treeRows } from "@tinyactors/scxmljs/explorer";
import { Window } from "happy-dom";

const { DOMParser } = new Window();
const session = await createSession(await readFile("player.scxml", "utf8"), { domParser: new DOMParser() });
session.start();
session.send("play");
await session.settled();

const { model } = session;
const isActive = (s: StateNode) => session.isActiveNode(s);
for (const row of treeRows(model, { expanded: activeExpansion(model, isActive), isActive }))
  console.log(`${"  ".repeat(row.depth)}${row.node.id}${row.active ? " *" : ""}`);

const focus = followTarget(session.configuration, model.root);
console.log(`focus: ${focus.id}`);
for (const e of acceptedEvents(session, focus)) console.log(`accepts ${e.descriptor} (${e.scope})`);
session.dispose();
```

<!-- doctest: output -->
```text
stopped
active *
  transport *
    playing *
    paused
  sound *
    audible *
    muted
focus: active
accepts mute (here)
accepts next (here)
accepts pause (here)
accepts stop (here)
accepts volume (here)
```

Recompute on the session's `macrostep` event. `acceptedEvents` lists descriptors from the
transitions of active states. It doesn't evaluate conditions (that could have side effects), so
`volume` is listed even though its condition may reject a value.
