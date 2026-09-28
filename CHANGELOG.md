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
