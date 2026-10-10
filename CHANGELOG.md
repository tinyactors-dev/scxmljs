# Changelog

All notable changes to `@tinyactors/scxmljs` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning

The package follows [Semantic Versioning](https://semver.org/), with the usual rule for 0.x:
until 1.0, a **minor** version (0.1 → 0.2) may contain breaking changes, and a **patch** version
(0.1.0 → 0.1.1) contains only fixes and additions. Every breaking change is listed under
**Changed** or **Removed** with what to do instead.

The public API is everything the entry points export (`@tinyactors/scxmljs`, `/trusted`, `/view`,
`/explorer`), the custom elements' attributes, properties, events, slots and `::part()` names,
the `--scxml-*` custom properties, and `themes/tinyactors.css`. Anything marked `@internal`,
the files under `dist/` other than the entry points, class names inside the shadow DOM and the
private `--x-*` properties are not public API and can change in any release.

## [Unreleased]

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

## [0.1.0] - 2026-09-28

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

[Unreleased]: https://github.com/tinyactors-dev/scxmljs/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tinyactors-dev/scxmljs/releases/tag/v0.1.0
