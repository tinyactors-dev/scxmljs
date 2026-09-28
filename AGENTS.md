# scxmljs

<!-- Source of truth for agent guidance.
     Read by Amp as AGENTS.md and by Claude Code via the CLAUDE.md symlink. -->

## Overview

`@tinyactors/scxmljs`: a correctness-first SCXML 1.0 interpreter (ECMAScript data model)
that runs on DOM elements, plus custom elements that render running statecharts.
The package is published on npm (0.1.0); `PUBLISHING.md` is the release checklist and
records the decisions (custom elements only, no outside contributions, CI = one script).

Layout:

- `packages/scxmljs/`: the library (`src/`, `test/`). Two entry points with the same API:
  `index.ts` (sandboxed data model, QuickJS/WebAssembly) and `trusted.ts` (host JS engine).
  `explorer.ts` is the `./explorer` entry (`src/explorer/`: element, view-model, styles);
  `view.ts` is the `./view` entry (`src/view/`: `<scxml-view>`, its layered layout, strings,
  styles); it loads data model engines only through `import()`. `src/ui/` holds what the
  elements share: `theme.ts`, the `--scxml-*` token contract and neutral theme, and `announcer.ts`;
  `src/themes/*.css` are optional theme stylesheets. The explorer must import internal modules
  only (never `index.ts`), so it never pulls in QuickJS.
- `examples/playground/`: private demo app (Bun server, the explorer with sample systems,
  the library `<scxml-view>` on `/element`, a GitHub-webhook gatekeeper).
  Its tests live in `examples/playground/test/`.
- `conformance/`: W3C SCXML IRP suite. `fetch.ts` downloads and converts it, `run.ts` runs it.
- `tests/browser/`: Playwright tests (Chromium, Firefox, WebKit) against `server.ts`, which serves
  the playground pages and `fixtures/*.html` (the BUILT package via an import map; `?csp=` adds a
  Content-Security-Policy). Specs tagged `@visual` are screenshot comparisons that only run inside
  the pinned Playwright Docker image; baselines live in `specs/__screenshots__/`.
- `examples/frameworks/{react,vue,svelte,angular}/`: real apps, each its own project and
  lockfile, depending on the library via `file:` (so `dist/` must be built). Their component
  files ARE the snippets in `docs/frameworks.md` (`<!-- doctest: app file=… -->` checks they're
  identical): edit both together. Biome and the root typecheck skip them; each app's toolchain
  checks it.

## Conventions

- Bun for everything: `bun test`, `bun run`, `Bun.serve`, `bun build`. Bun workspaces.
- mise is the task runner. Tasks live in `mise.toml` (committed). Pitchfork runs the playground server.
- Correctness first: any change to `packages/scxmljs/src` must keep the conformance suite at
  160/160 mandatory tests in **both** data models.
- Tests use `VirtualClock` and happy-dom's `DOMParser`; never rely on real time.
- Inside the repo, `@tinyactors/scxmljs[/*]` resolves to `packages/scxmljs/src` through the root
  `tsconfig.json` `paths` (Bun and tsc honour it), so no build is needed to develop. The published
  package resolves to `dist/` through `exports`.
- Don't commit, publish or trigger CI unless asked.

## Commands

- `scripts/ci` (or `mise run ci`): the light checks every push and pull request runs; `scripts/ci --full` (or `mise run ci:full`) adds browsers, visual regression, framework apps and the tarball in Node/Bun/Deno (release preparation: release/* branches, manual runs; v* tags go through release.yml). The GitHub workflow only calls this script, which picks its mode from the environment
- `scripts/release` (or `mise run release`): the release DRY RUN (changelog date, git, registry, full CI, pack + verify the tarball, `npm publish --dry-run`); it never publishes. `-- --skip-ci` skips `scripts/ci`
- Releasing: bump `packages/scxmljs/package.json`, add the dated CHANGELOG entry, commit, then `git tag vX.Y.Z && git push origin main vX.Y.Z`. The tag runs `.github/workflows/release.yml` → `scripts/publish` (refuses to run outside Actions; skips versions already on npm; runs `scripts/release`, then `npm stage publish` via npm trusted publishing/OIDC with provenance). The trusted publisher only allows staging: a maintainer approves each version with 2FA (npmjs.com → Staged Packages, or `npm stage approve <id>`) before it's public. No npm tokens exist. Prereleases (`X.Y.Z-dev.N`, `-beta.N`, `-rc.N`) publish under that dist-tag (`dev`, `beta`, `rc`), never `latest`, and need no CHANGELOG entry
- `mise run lint` / `mise run format`: Biome check (errors only) / fix formatting, safe lint fixes and import order
- `mise run test:coverage`: unit tests plus the library coverage gate (`scripts/coverage.ts`)
- `mise run pack:check` / `mise run size`: what `npm pack` would ship; bundle sizes against `size-budgets.json`
- `mise run build`: build the library into `packages/scxmljs/dist` (ESM, `.d.ts`, source maps)
- `mise run smoke:node`: run the built library in Node, both entry points
- `mise run test`: all unit tests
- `mise run typecheck`: type-check the workspace
- `mise run conformance` / `mise run conformance:trusted`: the vendored W3C suite (offline); `mise run conformance:fetch` regenerates it
- `mise run docs:test`: every code sample in the docs (each needs a `<!-- doctest: … -->` directive; see `scripts/docs/doctest.ts`); `mise run docs:links`: link check; `mise run docs:api`: TypeDoc into `docs/api` (fails on warnings: document every export); `mise run docs:conformance`: regenerate `docs/conformance.md`
- `mise run bench`: benchmarks (Bun, Node, Chrome via the running playground's `/bench`) → `bench/results/<date>.json`, `docs/measurements.md`; `mise run bench:quick` is the few-second smoke run CI uses
- `conformance/conformance.test.ts` runs the whole W3C suite in both data models as part of `bun test`, so coverage includes it
- `bun conformance/manual.ts [ids]`: trace the 9 manual W3C tests (verdicts in `conformance/MANUAL.md`, pinned in `conformance.test.ts`)
- `docs/deviations.md` lists every deviation from the spec; each is pinned by `packages/scxmljs/test/deviations.test.ts` — update both together
- `compile()` also returns `model.warnings` (`src/diagnostics.ts`): keep them low-noise — run them over `examples/playground/charts` and the W3C suite after changing a check
- `mise run test:browser`: browser tests in all three engines (builds first; installs the browsers; extra args go to Playwright, e.g. `-- --project=chromium specs/view.pw.ts`). The fixtures load `dist/`: rebuild after changing the library
- `mise run test:visual` / `mise run test:visual:update`: screenshot comparisons / new baselines, inside Docker (`scripts/visual.sh`); look at changed baselines before accepting them
- `mise run examples:frameworks`: install and build the four framework apps (needed before their browser test)
- `mise run smoke:tarball`: `npm pack` → empty project → Node, Bun, Deno, and a bundler
- `scripts/readme-media` (or `mise run readme-media`; the `readme-media.yml` workflow runs it on "Run workflow"): records a 2× tour of `<scxml-explorer>` (Tinyactors theme, paused `PlaybackClock`; `scripts/media/record.mjs` via Playwright/Node), encodes `explorer-<hash>.{webm,webp,png}` with ffmpeg (pinned in `mise.toml`), force-pushes them to the orphan branch `readme-media` (newest 2 sets; raw.githubusercontent URLs, because release assets download as octet-stream/attachment), rewrites the block between `<!-- readme-media:start/end -->` in `README.md` and `packages/scxmljs/README.md` and commits/pushes only those. `-- --dry-run` records into `./readme-media-out`; `--no-upload` / `--no-commit` stop earlier. Don't edit the media block by hand
- `mise run up` / `mise run down` / `mise run logs`: playground on http://localhost:4321 (`/explorer`, `/element`)
