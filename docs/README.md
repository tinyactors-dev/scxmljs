# scxmljs documentation

The package's front page is [packages/scxmljs/README.md](../packages/scxmljs/README.md). Start
with [getting started](getting-started.md).

## Guides

- [Getting started](getting-started.md): install, write a chart, run it, render it.
- [Sandboxed or trusted](sandboxed-vs-trusted.md): which entry point to import.
- [Driving charts from the page](driving-charts.md): `send()`, `connect()`, `bind()` and
  `data-scxml-*`, and charts as markup (`reflect`, `elementEvents`).
- [Custom I/O processors](io-processors.md) and [custom invokers](invokers.md): connect charts to
  the outside world.
- [Playback and stepping](playback.md): clocks, `PlaybackClock`.
- [Testing charts](testing.md): `VirtualClock`, `waitFor()`, testing UI in happy-dom.
- [Node, Bun and servers](node-and-servers.md).
- [Large charts](large-charts.md): which element, folding, windowing.

## The elements

- [`<scxml-view>`](view.md) and [`<scxml-explorer>`](explorer.md): attributes, properties,
  events, slots, keyboard, parts.
- [Theming](theming.md): tokens, light and dark, parts.
- [Custom UI and translations](custom-ui.md): strings, slots, your own drawing, your own explorer.
- [Frameworks](frameworks.md): React, Vue, Svelte, Angular, plain HTML.

## Shipping

- [Bundling, CDNs and classic scripts](bundling.md), with the [support table](bundling.md#support).
- [Content-Security-Policy](csp.md), including Trusted Types.
- [Security](../SECURITY.md): what the sandbox isolates, limits, reporting.

## Reference

- [Conformance report](conformance.md): every W3C test, both data models (generated).
- [Deviations from the specification](deviations.md).
- [Measurements](measurements.md): startup, compile times, memory, throughput, rendering.
- [Changelog and versioning](../CHANGELOG.md).

## API reference

Generated from the sources with [TypeDoc](https://typedoc.org): run `mise run docs:api` in the
repository and open `docs/api/index.html`. Every exported symbol is documented; CI fails on
missing documentation or broken `{@link}`s.

## Examples

The charts used in these pages are in [examples/](examples). Every code sample in the docs is
tested by `mise run docs:test` (see `scripts/docs/doctest.ts`), so the samples run as shown.
