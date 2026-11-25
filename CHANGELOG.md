# Changelog

All notable changes to `@tinyactors/scxmljs` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning

The package follows [Semantic Versioning](https://semver.org/), with the usual rule for 0.x:
until 1.0, a **minor** version (0.1 → 0.2) may contain breaking changes, and a **patch** version
(0.1.0 → 0.1.1) contains only fixes and additions. Every breaking change is listed under
**Changed** or **Removed** with what to do instead.

The public API is everything the entry points export (`@tinyactors/scxmljs`, `/trusted`, `/view`,
`/explorer`, `/data`), the custom elements' attributes, properties, events, slots and `::part()` names,
the `--scxml-*` custom properties, and `themes/tinyactors.css`. Anything marked `@internal`,
the files under `dist/` other than the entry points, class names inside the shadow DOM and the
private `--x-*` properties are not public API and can change in any release.

## [Unreleased]

## [0.5.0] - 2026-11-25

Charts say what data their events take, and the view asks for it with a form; outside browsers,
SCXML needs nothing installed to parse.

### Added

- **Event data in the chart.** An `<xs:schema>` (XML Schema's namespace) inside a chart describes
  its events' data: each top-level `<xs:element name>` is the `_event.data` of the event of that
  name. The interpreter ignores it. See [event data](docs/data.md).
- **Event forms in `<scxml-view>`.** A label whose event takes data shows `add …`, and a click asks
  for the data with a form before sending: built from the chart's schema, or, without one, a field
  for each name the chart reads as `_event.data.name`. Send or Enter sends; Cancel or Escape
  doesn't; a value the schema refuses shows its problems at their fields. The form opens above the
  page, so a small diagram never squeezes it.
  - The `event-forms` attribute decides when: `auto` (the default: unless `event-data` gives
    data for the event), `always` (filled in from `event-data`), `off`.
  - New parts: `takes-data`, `form-popover`, `form-data`, `form-send`, `form-cancel`.
- **`<scxml-data>`** (new entry point `@tinyactors/scxmljs/data`, 9 KB gzipped) shows, edits and
  composes a value as a schema describes it: objects, lists up to their bounds, choices,
  enumerations, numbers within their bounds, booleans, dates, patterns, optional fields, types
  that refer to themselves. Its schema reader is exported too (`readSchemas`, `check`,
  `initialValue`).
- **No `DOMParser` to install outside browsers.** The library parses SCXML text with its own XML
  parser and DOM in Node, Bun and Deno (namespaces, entities, CDATA, errors with their line and
  column). It runs the W3C conformance suite 160/160 in both data models, and was fuzzed
  with 6000 mutated charts against Chromium's and Firefox's own parsers. Browsers still use their own `DOMParser`; a
  `domParser` option still overrides both. See [Node, Bun and servers](docs/node-and-servers.md).

### Changed

- **Bundle size.** The XML parser adds about 6 KB (gzipped) to each entry point that parses SCXML,
  in browsers too: `parseSCXML` is synchronous, so it can't be loaded only where it's needed.

### Removed

- **`SCXML_NO_DOMPARSER`**, a code of `SCXMLParseError`: there is always a parser now. Code that
  checked for it can drop the check.

## [0.4.0] - 2026-11-25

`<scxml-view>` becomes a place to try a chart: an infinite canvas with a smooth camera, a demo mode
that needs no code, and help popovers you can follow from state to state.

### Added

- **Run a chart as a demo, with no code** ([guide](docs/view.md#running-a-chart-as-a-demo)):
  - **Stand-ins.** A chart that sends to an I/O processor nobody handles (`<send
    type="payments">`) gets a stand-in instead of failing the send. A "Sent" panel under the
    diagram lists what the stand-ins received; the reader answers by clicking the reply's label.
    A processor the page gives in `options.ioprocessors` replaces the stand-in.
  - **`variables`** lists the chart's variables after each step.
  - **`sends`** (`[{"event", "data", "label"}]`) puts a button under the diagram for each preset
    event.
  - **Restart** (the `rotate-ccw` glyph) runs the chart again in a fresh session.
  - New parts: `run`, `preset-send`, `restart`, `panels`, `panel` (`variables`, `stand-ins`).
- **Small charts fill their frame.** `--scxml-max-scale` grows a diagram smaller than the element,
  up to that scale, as far as the width and `--scxml-height` allow. The default, `1`, keeps actual
  size. Use it instead of CSS `zoom`, which the canvas's panning doesn't follow.
- **Follow a flow in the help popovers.** A state's help popover lists its transitions in the
  diagram's notation, and each target is a link that flies the view to that state, marks it and
  opens its help. New part: `go`.
- **Gesture hints and double click.** A plain wheel or a one-finger swipe over the diagram shows how
  to zoom or move it ("Ctrl + scroll to zoom", "Use two fingers to move the diagram"). A double
  click zooms in on the spot, or back to fit, as a double tap does. New part: `hint`.

### Changed

- **The diagram is a canvas, not a scrolling box.** It pans in every direction, past its edges, by
  dragging its background, with two fingers, or with the arrow keys; it shows no scrollbars. One
  finger and a plain scroll wheel scroll the page past it, as on an embedded map. Zooming is
  unchanged. **If your page scrolled the canvas** (`scrollLeft`, `scrollTop`), that has no effect
  now: the drawing's offset is the diagram's `data-pan`.
- **Smooth motion.** When the view moves by itself (a link, fit, the zoom buttons and `+` `-` `0`,
  a double click or tap, following the active states) it moves along a smooth zoom path, zooming
  out on a long trip just enough to keep both ends in view, in a quarter to one second. A drag, a
  pinch or Ctrl/⌘ + wheel stays direct. With reduced motion it jumps, as before. Help popovers
  fade in and out.
- **`--scxml-height`** caps the diagram's height, not the whole element's: the run bar and the
  panels add their own, so asking for them never shrinks the diagram.

### Fixed

- A help popover reflows the XML comment it shows: a sentence no longer breaks wherever the source
  was wrapped (a blank line still starts a paragraph, a list item keeps its own line).
- A help popover taller than the room below its button opens on the side with more room and
  scrolls inside, instead of being cut off by the diagram's frame.

## [0.3.1] - 2026-11-25

A layout fix for charts whose initial state is part of a cycle.

### Fixed

- `<scxml-view>`: a chart whose initial state is part of a cycle is drawn from its initial state.
  Before, when more transitions ran back into the initial state than out of it (a retry loop:
  `paying` back to `cart` twice, `cart` to `paying` once), the state it leads to was drawn first,
  so the diagram read backwards and its initial marker was lost.

## [0.3.0] - 2026-11-23

Cleaner diagrams: self-transitions drawn as loops, edges that run straight into their target.

### Fixed

- `<scxml-view>`: a transition from a state to itself is drawn as a loop with its own place on the
  box's side, beside the box's other edges. Before, the loop ran on top of the edges leaving the
  same side, and its label could land on another edge's label.
- `<scxml-view>`: edges run straight into their target where they can, instead of ending in a
  short sideways step just before the arrowhead (about half the bends in top-to-bottom layouts,
  a sixth in left-to-right ones). Labels sit closer to the state they leave, and a label no
  longer covers a state when the diagram is crowded.

## [0.2.0] - 2026-11-17

Both elements grow up: zoom and pan, folding, help for every state, phones and narrow widths,
one visual language, and clicked events that say what they did.

### Added

- `<scxml-view>`: the `event-data` attribute gives label clicks event data (a JSON object from
  event names to data), and `scxml-send` listeners can set `detail.data`.
- `<scxml-view>`: when a clicked event changes nothing, or raises an error (for example a
  condition that throws, which counts as false), a `send-status` bar says so, and the live
  region announces it. Before, the click looked like it did nothing.
- `<scxml-explorer>`: list rows answer "what is this state, what happens in it, how do I get
  out": entry actions and invokes, transitions as "event → target" with a condition mark, send
  buttons while the state is active, a "last visited" mark, and a click that opens the row in
  place. New parts: `list-row` modifiers `active` `visited` `open`, `visited`, `row-actions`,
  `row-exits`, `row-event` (`fired`), `row-detail`, `open-detail`; `card` and `lane-row` get
  `visited`, `edge-label` gets `fired`. New `strings`: `onEntry`, `eventless`, `guard`,
  `justTaken`, `lastVisited`, `openDetail`, `lastStep`.
- `<scxml-view>` zooms and pans: a zoom toolbar, Ctrl/⌘ + wheel, pinch, `+` `-` `0`, and dragging
  the background. The `zoom` property reads or sets the scale (`null`: automatic). New part `zoom`.
- `<scxml-view>` on phones: two fingers pinch-zoom the diagram, and icon buttons get finger-sized
  hit areas. A chart that doesn't fit scrolls to its
  active states and keeps them in view as it runs, until you scroll or zoom yourself.
- `<scxml-view>` lays charts out more compactly, especially top to bottom: boxes start at the top
  of their layer, labels that don't fit side by side stack below their box instead of widening it,
  ports are spaced by their labels' widths, labels stay near their source, and nothing is drawn
  outside the diagram (labels used to be cut off at its left edge). Charts from the examples are
  up to 45% smaller.
- `<scxml-view>`: a compound state's transitions into its own states, and transitions that cross
  three or more container borders, are chips in their source's box ("cancel → cancelling")
  instead of long arrows; hovering one outlines its target. New parts `portal` and `target`.
  `portalTransitions()` (exported from `/view`) picks them; `layoutChart` takes them as `portals`.
- `<scxml-view>` on narrow elements: parallel regions stack instead of sitting side by side
  (`layoutChart`'s new `maxWidth`), and the chart is laid out again when the width changes a lot.
- `<scxml-view>`'s controls float over the diagram's bottom edge, showing only what's useful:
  playback at the bottom left (Step only while paused, one speed button that cycles, shrinking to
  the play button while playing untouched), zoom at the bottom right (Fit once you've left the
  automatic view; −, the level and + on hover, keyboard focus or while zooming). A double tap
  zooms in on a spot, or back to fit. New parts `zoom-in`, `zoom-out`, `fit`, `zoom-level`; new
  `strings`: `playbackLabel`, `playKey`, `speedButton`, `fit`.
- `<scxml-explorer>` works on any width: the focus fills it and the other panels float over it.
  Wide: the tree on the left, the inspector on the right. Medium: one panel, with the inspector as
  its second page ("Accepts n ›", "‹ States"). Narrow: a bottom sheet you drag or tap between
  three heights, whose lowest shows the accepted events. Playback sits in the bottom-left corner,
  Follow in the bottom-right. New parts `panel`, `side-panel`, `to-inspector`, `back`,
  `sheet-handle`; new `strings`: `backToStates`, `backToStatesLabel`, `panelLabel`,
  `inspectorLabel`, `sheetExpand`, `sheetCollapse`.
- Both elements follow one visual language, written down in
  [docs/design-principles.md](docs/design-principles.md): notation over narration.
  - Event names are shown as written, in monospace, the namespace quieter and cut from the left
    when there's no room; a clickable event sits in the event chip; completion events
    (`done.*`, `*.done`) take the done colours and error events (`error.*`, `*.error`) the error
    colours. New token `--scxml-error-bg` (mapped to `--state-error-bg` by the Tinyactors theme).
  - `<scxml-explorer>`: what a state does is glyphs (on entry, on exit, sends, logs, invokes),
    named in their tooltips; a condition is a diamond; a container shows the layers glyph and its
    number of states; exits and entries are a door glyph, the target and the first event; the
    breadcrumb is the title's first line (with "System", the way to the System level); list and
    diagram are icon toggles, "only active states" a funnel, playback icons. The last-step line
    is gone from the screen, and with it the `last-step` part (the live region still announces
    each step).
  - New `strings` (explorer): `onExit`, `invokesGlyph`, `sendsGlyph`, `logsGlyph`.
- `<scxml-view>`: every compound and parallel state folds and unfolds with a chevron before its
  name (before, only the containers folded for `max-states` could be unfolded and folded again).
- `<scxml-view>`: every state has a help button that opens a popover with its kind, description
  and transitions. Descriptions come from the XML comment right before the state, or from the
  new `descriptions` property; `describe(state)` returns the text, and `sourceDescription(state)`
  (exported from `/view`) reads the comments. New parts `help` and `help-popover`; new `strings`:
  `helpLabel`, `noDescription`, `helpTransitions`, `zoomIn`, `zoomOut`, `zoomReset`, `zoomLevel`,
  `zoomActual`, `zoomToolbar`.

### Changed

- `<scxml-view>` lays charts out top to bottom by default (`direction="down"`). `direction="right"`
  keeps the old left-to-right layout; `direction="auto"` still switches at 760 px.
- `<scxml-explorer>`: the header bar and the narrow layout's tabs are gone (the levels and the
  breadcrumb moved into the panel's head, playback and Follow into the corners). Removed parts
  `tabs` and `tab`; removed `strings` `tabSystem`, `tabStates`, `tabFocus`, `tabEvents`,
  `tabDetail`. The breadcrumb always shortens to "…" and the last two places.
- `<scxml-explorer>`: the System/Machine switch (`levels` part) is gone: the breadcrumb's first
  place goes to the System level. `play`, `pause`, `step` and `clockTime` are plain names now
  ("Play", "Pause", "Step", "0.7 s"); `activeOnly` names the funnel ("Only active states").
- `<scxml-explorer>`: the Follow toggle is a map's locate crosshair (its centre filled while
  following) instead of a dot. The focus list keeps its order (the active path, then the states
  one step from it, then the rest) but only the active path has a heading; removed `strings`
  `groupOneStep`, `groupElse` and `groupCount`.
- `<scxml-view>`: the playback controls moved from above the diagram onto its bottom edge;
  `speeds` is one button that cycles (it was a group of five), and `play` and `step` are icon
  buttons. The `play`, `pause` and `stepHint` strings are plain labels now ("Play", "Pause");
  `playHint` and `step` are gone.
- `<scxml-view>`: the `expand` and `collapse` parts are now icon buttons (a chevron before the
  state's name) instead of text buttons; their accessible names still say "Expand" / "Collapse".
- `<scxml-explorer>` is quieter: one header bar (the playback controls moved into it), no
  status badges or redundant counts, sentence-case labels, hairlines instead of boxes, and colour
  only for meaning (running colour: active; waiting colour: what the last step did). The System
  level hides the tree and shows the service inspector.
- `<scxml-explorer>` parts: `speeds` is now a `<select>` (it was a group of buttons); `last-step`
  moved from the playback bar to under the title; `send` is now the event's name itself (there's
  no separate Send button); `event-data` is a `<details>` disclosure. The playback bar's queue
  readout is the `clock` part's tooltip. The English `focusSummary` no longer lists all
  descendants and `traffic` gives a message total.
- `session.send()` before `start()` queues the event: it's processed, in order, once the session
  starts. Before, it was silently dropped. Events sent after the session has ended are still
  dropped.
- `session.isActive(id)` throws a `RangeError` when the chart has no state with that id, and
  `session.waitFor()` rejects with one at once. Before, a typo returned `false` or waited until
  the timeout (or forever).
- A session disposed before `start()` has ended: `status` is `"done"` and `cancelled` is `true`
  (they said `"idle"` and `false` while `signal` was aborted and `done` resolved), and `start()`
  throws an `Error` saying it was disposed (it threw QuickJS's `Lifetime not alive`, or ran on
  a disposed data model).

### Fixed

- `parseSCXML()` (and `createSession()` with text) throws an `SCXMLParseError` that names the
  problem when the `DOMParser` doesn't implement XML namespaces, as linkedom's doesn't, and when
  it returns no root element. Before, every chart failed validation with a misleading namespace
  error, or a `TypeError`. The docs no longer suggest linkedom.
- The package's type declarations bring in TypeScript's `dom` library, so Node-only projects
  type-check without `"lib": ["dom"]` or `skipLibCheck`.
- `compile()` given SCXML text throws a `TypeError` saying to parse it with `parseSCXML()` first,
  instead of "root element is `<undefined>`".

## [0.1.0] - 2026-09-28

The first release: an SCXML 1.0 interpreter (sandboxed or trusted), `<scxml-view>` and
`<scxml-explorer>`.

The first release.

### Added

- An SCXML 1.0 interpreter with the ECMAScript data model. All 160 automatic mandatory W3C
  conformance tests pass in both data models; see [docs/conformance.md](docs/conformance.md)
  and [docs/deviations.md](docs/deviations.md).
- Two entry points with the same API: `@tinyactors/scxmljs` runs chart code in a QuickJS
  sandbox (WebAssembly), with a per-evaluation timeout (`scriptTimeoutMs`) and a per-session
  memory limit (`memoryLimitBytes`); `@tinyactors/scxmljs/trusted` runs it in the host's engine.
- Load-time validation (`SCXMLValidationError` with every problem) and authoring warnings
  (`model.warnings`).
- Clocks: `realClock`, `VirtualClock` for tests, `PlaybackClock` for pause, step and speed.
- Custom Event I/O Processors and invokers; SCXML child sessions with a `loader` for `src`.
- Typed session events, `settled()`, `waitFor()`, `steps()` and `snapshot()`.
- Page integration: `connect()`, `bind()` with `data-scxml-*` attributes, and the opt-in
  `reflect` and `elementEvents` options.
- `<scxml-view>` (`@tinyactors/scxmljs/view`): a whole chart, drawn and running, with no
  JavaScript of your own.
- `<scxml-explorer>` (`@tinyactors/scxmljs/explorer`): explore running systems level by level,
  and its view-model.
- A shared theming contract (`--scxml-*` tokens, `::part()`), a neutral light/dark default
  theme, and `themes/tinyactors.css`.
- Works under a strict Content-Security-Policy (no `'unsafe-inline'` styles) and with Trusted
  Types (sandboxed entry point); see [docs/csp.md](docs/csp.md).
- `<scxml-view>` scales a too-wide diagram down on its own, no further than
  `--scxml-min-scale` (default 0.65); `fit` scales all the way. A terminated session keeps its
  final states marked (`reached`), and an element with nothing to show yet shows a hint instead
  of an error (a host may set `session` later).
- Tested in CI in Chromium, Firefox and WebKit (functional, screenshots, axe-core with no
  violations), in Node, Bun and Deno from the packed tarball, and with React 19, Vue 3,
  Svelte 5 and Angular 22 apps; see [docs/bundling.md](docs/bundling.md#support).

[Unreleased]: https://github.com/tinyactors-dev/scxmljs/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/tinyactors-dev/scxmljs/releases/tag/v0.5.0
[0.4.0]: https://github.com/tinyactors-dev/scxmljs/releases/tag/v0.4.0
[0.3.1]: https://github.com/tinyactors-dev/scxmljs/releases/tag/v0.3.1
[0.3.0]: https://github.com/tinyactors-dev/scxmljs/releases/tag/v0.3.0
[0.2.0]: https://github.com/tinyactors-dev/scxmljs/releases/tag/v0.2.0
[0.1.0]: https://github.com/tinyactors-dev/scxmljs/releases/tag/v0.1.0
