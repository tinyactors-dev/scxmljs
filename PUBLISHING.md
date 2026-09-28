# Publishing checklist: `@tinyactors/scxmljs`

This file tracked everything between the prototype and a polished first release. The preparation
(phases 1–8) is finished: every item below is either done (`[x]`) or deliberately deferred (`[-]`,
with the reason). What's left needs a human, and is listed in order right here.

Items are tagged **[blocker]**, **[should]** or **[polish]**.

## Status

- **Done:** every blocker and every *should*; all but one *polish* item.
- **Deferred (2):** an optional separate `.wasm` file for the sandbox (section 2), and trying a
  shipping Safari by hand (section 9, a human step below). Reasons are next to each item.
- **Checks:** `scripts/ci` runs everything (lint, typecheck, build, unit tests with a coverage gate,
  the W3C suite in both data models, docs, size budgets, the packed tarball in Node/Bun/Deno,
  framework apps, browser and screenshot tests); `scripts/release` is the release dry run.

## Before you publish

In this order:

1. ~~**Answer the open questions.**~~ Resolved:
   - *Repository URL:* `https://github.com/tinyactors-dev/scxmljs`, set in `scripts/docs/config.ts`
     and rewritten into the docs and `package.json` with `mise run docs:set-repo`.
   - *npm scope:* `dhamidi` owns the `tinyactors` org and has read-write access to its packages;
     `@tinyactors/scxmljs` is not taken yet.
2. ~~**Set the release date**~~ Done: `## [0.1.0] - 2026-09-28`.
3. ~~**Remove the "Status: in preparation" line**~~ Done.
4. **Make the first commit** (nothing is committed yet: `git status` lists exactly what belongs in
   it: 456 files, about 3.7 MB, 211 of them the vendored W3C suite).
5. **Create the GitHub repository** and push. Pushes to `main` run the light CI (about half a
   minute plus installing mise and the pinned tools). Full runs (`v*` tags, `release/*` branches,
   "Run workflow") also install the Playwright browsers with `--with-deps` (needs `sudo`, which
   GitHub's Ubuntu runners have) and pull the Playwright Docker image for the screenshot tests
   (about 2 GB), so expect several minutes the first time.
6. **Run the release dry run** on the committed tree: `scripts/release` (or `mise run release`).
   It must end with "✓ releasable (dry run)".
7. ~~**Publish**~~ Done: 0.1.0 was published from the maintainer's laptop on 2026-09-28 (`npm publish --access public`, no provenance).
   **From now on releases publish from GitHub Actions:** `.github/workflows/release.yml` runs on `v*` tags and does only `scripts/publish`, which refuses to run outside Actions, skips versions already on npm, runs the full `scripts/release` check and then `npm stage publish` through npm *trusted publishing* (OIDC: no token anywhere, with provenance). Set up on npmjs.com (done 2026-09-28): *Trusted Publisher* → GitHub Actions, `tinyactors-dev` / `scxmljs` / `release.yml`, permission **npm stage publish** only. So CI can only *stage* a version; it becomes public when the maintainer approves it with 2FA on npmjs.com (the package → *Staged Packages* → Approve) or with `npm stage list @tinyactors/scxmljs` + `npm stage approve <stage-id>`. Staging needs npm ≥ 11.15.0 (the pinned Node ships 11.19.1). Then, under *Publishing access*, choose "Require two-factor authentication and disallow tokens".
   *Dist-tags:* a prerelease version publishes under its first prerelease identifier and never moves `latest` (`0.2.0-dev.3` → `dev`, `0.2.0-beta.1` → `beta`, `1.0.0-rc.1` → `rc`; install with `npm i @tinyactors/scxmljs@dev`). Prereleases need no CHANGELOG entry; other versions go to `latest`.
8. **After publishing:**
   - ~~try the real CDN URLs~~ Done (2026-09-28): the documented import map works against jsDelivr (sandboxed `<scxml-view>`), and esm.sh works without a map (trusted);
   - ~~host the API reference~~ Done: it's part of the website, <https://scxmljs.tinyactors.dev/api/> (see *Website*);
   - try `<scxml-view>` and `<scxml-explorer>` once in a shipping Safari (CI covers Playwright's
     WebKit on Linux, not Safari itself).

## README media

`scripts/readme-media` (also `mise run readme-media`, and the manual `readme-media` workflow: "Run workflow") records a new video of `<scxml-explorer>` with the Tinyactors theme and updates the READMEs:
- a deterministic ~20 s tour on a paused `PlaybackClock` (fulfilment sample: steps through intake and payment, the fulfilment lanes, the System level while the shipment machine runs, back and step), captured at 2880×1800;
- `explorer-<hash>.webm` (the video), `explorer-<hash>.webp` (animated preview, 1600 wide) and `explorer-<hash>.png` (full-resolution still);
- hosted on the orphan branch `readme-media` (one force-pushed commit, newest two sets) and linked through raw.githubusercontent.com. A GitHub release was tried first: its assets are served as `application/octet-stream` with `Content-Disposition: attachment`, so they neither render inline nor play in the browser;
- the READMEs show the animated preview (npmjs.com strips `<video>`), linked to the video. npm picks up the package README's new media only with the next npm release.

## Website

<https://scxmljs.tinyactors.dev>: landing page (a live `<scxml-view>`, the explorer tour), demos
(the explorer on the three playground samples, a `<scxml-view>` gallery), every guide plus
SECURITY and CHANGELOG, the TypeDoc API reference under `/api/`, Pagefind search, and
`/playground/` (a placeholder until the live editor ships). Sources in `site/`, build in
`scripts/site/`.

- **Build:** `mise run site:build` → `_site/` (gitignored; builds `docs/api` first if it's
  missing). `mise run site:check` checks internal links, anchors and assets, that nothing points at
  localhost, and that every page has a title and a description. `mise run site:serve` serves
  `_site/` on http://localhost:4400 the way Pages does (directories, 404.html).
- **Checks:** light CI (`scripts/ci`) runs build + check; `scripts/ci --full` adds
  `mise run site:test` (Playwright in Chromium: the landing page's live view runs, the explorer
  steps, search finds results, no horizontal scrolling at 390px, axe on every page in both themes).
- **Deploy:** `scripts/site-deploy` (or `mise run site:deploy`) installs the toolchain, builds the
  checked-out commit, checks it, and force-pushes `_site/` as the only commit of the orphan branch
  `gh-pages` (no history accumulates). `-- --dry-run` stops before the push. Locally it refuses a
  dirty working tree.
- **Trigger:** `.github/workflows/site.yml` runs `scripts/site-deploy` on every pushed `v*` tag
  (it builds the tagged commit, so the site documents the latest release) and on "Run workflow"
  (builds the chosen branch or tag). Prerelease tags (`v0.2.0-dev.1`, …) are skipped on push, so
  the site keeps following `latest`; run the workflow by hand on such a tag to publish it anyway.
  The first deploy (2026-09-28) was built from `main` (0.2.0-dev.0), because `v0.1.0` predates
  the site; the first release tag after that replaces it.
- **Pages settings** (configured with `gh api`): source = branch `gh-pages`, folder `/`; custom
  domain `scxmljs.tinyactors.dev` (also written to `_site/CNAME` on every build); "Enforce HTTPS"
  on once GitHub has issued the certificate.
- **DNS** (Cloudflare, zone tinyactors.dev): `CNAME scxmljs → tinyactors-dev.github.io`,
  **DNS only** (grey cloud: GitHub must see its own IPs to issue the Let's Encrypt certificate).
- **Recommended:** verify the domain for the organization (GitHub → tinyactors-dev → Settings →
  Pages → *Add a domain*; add the `TXT _github-pages-challenge-tinyactors-dev.tinyactors.dev`
  record it shows). Verified domains can't be claimed by another account's Pages site if this
  one's Pages setting is ever removed (subdomain takeover).
- **Social preview:** `site/public/og.png` (1200×630) is committed; `mise run site:og` renders it
  again from a built `_site/`. Set it as the repository's social preview by hand if wanted
  (Settings → General → Social preview; there's no API for it).
- **npm:** `packages/scxmljs/package.json` `homepage` points at the site; npmjs.com shows it
  from the next published version on.

## Decisions (made)

- **Name:** `@tinyactors/scxmljs`.
- **Scope:** the package contains the interpreter, both data models (sandboxed and trusted), the playback clock, the view-model, and the **custom elements**.
- **Both elements ship:** `<scxml-explorer>` (explore and debug running systems) and `<scxml-view>` (drop-in whole-chart rendering, rebuilt in phase 4c). They share one token contract (`--scxml-*`), one neutral default theme and one parts-naming scheme (`packages/scxmljs/src/ui/theme.ts`).
- **Dropped:** everything that isn't a custom element. Rendering SCXML inline in XHTML, and the self-rendering `.scxml` file with `<?xml-stylesheet?>`, are out. So are their CSS, runtime and server routes. `reflect` / `elementEvents` stay in the core as low-level APIs.
- **Contributions:** not accepted. There's no CONTRIBUTING, no code of conduct and no issue or PR templates; the README says so.
- **CI:** one GitHub Actions workflow that does exactly one thing: run `scripts/ci` from the repository. All logic lives in that script, so CI runs identically on a laptop. Actions are not triggered as part of this preparation.
- **Publishing:** out of scope here. Everything is prepared, up to a dry-run pack, but not published.

## Order of work

1. Repository cleanup and structure
2. Build step, package metadata, Node support
3. CI script, linting, vendored conformance suite, size budgets
4. Explorer into the package: neutral theme, parts, tokens, tests (4a); accessibility, strings, layout polish (4b); `<scxml-view>` rebuilt into the package (4c)
5. Measurements
6. Documentation
7. Cross-browser and framework verification
8. Release preparation (dry run)

---

## 1. Repository cleanup

- [x] **[blocker]** Make it a git repository. `git init` is done; there's no commit yet (the first commit is the maintainer's call).
- [x] **[blocker]** Removed `Tinyactors Design System.zip`. The tokens now live in `examples/playground/web/css/tokens/` (only the playground uses them). `fonts.css` (it referenced missing font files) and the unused `base.css` are deleted. Phase 4 turns the tokens into the optional `tinyactors` theme.
- [x] **[should]** Replaced the `bun init` `CLAUDE.md` with `AGENTS.md`, bridged via `agents md` / `agents sync` (`CLAUDE.md` is a symlink to it).
- [x] **[should]** Project tasks are in the committed `mise.toml`; `mise.local.toml` is deleted (and git-ignored).
- [x] **[should]** Rewrote `.gitignore` for this repository.
- [x] **[should]** Root `package.json` is now `scxmljs-monorepo` (private, workspaces `packages/*` and `examples/*`). `peerDependencies` is gone, and `@types/bun`, `happy-dom` and `typescript` are pinned devDependencies.
- [x] **[should]** `tsconfig.json`: `jsx` and other leftovers dropped, and it type-checks the whole workspace. The package has its own build config, `packages/scxmljs/tsconfig.build.json` (phase 2; see section 2).
- [x] **[should]** Split the product from the demos: `packages/scxmljs` (library) and `examples/playground` (private demo app with `server.ts`, `web/`, `src/`, `charts/`, `test/` and `pitchfork.toml`). `conformance/` stays at the root.
- [x] **[should]** Removed the XHTML and raw-`.scxml` approaches: `web/xhtml.xhtml`, `web/runtime/dom-runtime.ts`, `web/css/scxml.css`, the `/xhtml`, `/view/*`, `/js/dom-runtime.js`, `/css/*` and `/design/tokens/*` routes (so the `import.meta.url` build workaround is gone too), their nav links and index cards, and the harness's XHTML-namespace and docked-panel code. `/charts/*` stays, because the explorer samples load it.
- [x] **[should]** Vendored the converted conformance tests: `conformance/ecma/` (200 tests, 216 files, 844 KB) and `conformance/manifest.json` are committed, with `conformance/LICENSE-W3C` (W3C Test Suite License / W3C 3-clause BSD, dual-licensed; redistributed under the BSD terms, whose text is included). Only `conformance/.cache/` is ignored. `mise run conformance:fetch` regenerates the suite; it needs the network and `bunx xslt3`. Running the suite never touches the network.
- [x] **[polish]** The root README describes the product (overview, layout, commands, "contributions are not accepted").

## 2. Packaging and distribution

- [x] **[blocker]** Renamed `@scxml-ui/interpreter` to `@tinyactors/scxmljs` everywhere: code, docs, error messages, the playground and the conformance runner. `rg "scxml-ui/interpreter"` finds nothing outside this file.
- [x] **[blocker]** Build step: `bun run build` (or `mise run build`) runs `packages/scxmljs/scripts/build.ts`, which writes per-file ESM, `.d.ts` files and source maps (sources inlined) to `dist/`. `exports` has `types`/`import`/`default` conditions for `.` and `./trusted`, plus `./package.json`. `files` ships `dist` and `THIRD_PARTY_NOTICES` (npm adds README, LICENSE and `package.json`).
  *Approach:* one `tsc` pass with `tsconfig.build.json` (`rewriteRelativeImportExtensions`, `stripInternal`). The installed TypeScript 7.0.2 emits JS and declarations in about 0.1 s, so no bundler is involved. Files aren't bundled, so consumers' bundlers can tree-shake per module. The build script then rewrites `./x.ts` to `./x.js` inside the `.d.ts` files, because tsc only rewrites JS output.
  *Phase 4a:* added `./explorer` in the same shape, and `./themes/tinyactors.css` (a plain stylesheet, copied to `dist/themes/` by the build).
  *Inside the repository,* the root `tsconfig.json` `paths` map `@tinyactors/scxmljs` and `@tinyactors/scxmljs/*` to `packages/scxmljs/src`. Bun and tsc both honour this, so the playground, tests and conformance runner work without a build. The wildcard already covers future subpaths.
- [x] **[blocker]** Node can import the package: `packages/scxmljs/scripts/smoke-node.mjs` (`mise run smoke:node`) runs a chart through both entry points of the **built** package via its exports map (package self-reference), with happy-dom's `DOMParser`. It uses data, a script, a delayed send, an invoked child and donedata, and it also checks the missing-`DOMParser` error. It passes on Node 26.10 and 22.3. Phase 3 can call it with a package specifier argument, for example for an installed tarball.
- [x] **[blocker]** `LICENSE`: MIT, © 2026 Dario Hamidi.
- [x] **[blocker]** Metadata: description, keywords, author, license, `repository` (with `directory`), `homepage`, `bugs`, `engines`, `sideEffects: false`, `publishConfig.access: public`, `type: module`, `types`, version 0.1.0. Repository: `https://github.com/tinyactors-dev/scxmljs`.
- [x] **[should]** `sideEffects` lists the files that register custom elements: `dist/explorer.js`, `dist/explorer/element.js`, `dist/view.js` and `dist/view/element.js` (plus their `src/` counterparts, which the repository's own path mapping resolves to) and `*.css`. Everything else can be tree-shaken.
- [x] **[should]** `engines.node: ">=22.3"`. `process.getBuiltinModule` (used by the trusted entry for `node:vm`) exists from 22.3.0 and is `undefined` on 22.2.0; both checked with mise. It was also backported to 20.16, but Node 20 has been end-of-life since April 2026, so 22.3 is the floor. The sandboxed entry alone would run on older Node.
- [x] **[should]** Classic-script and IIFE consumers: documented in `docs/bundling.md` (*Phase 6:* the trusted and explorer entries bundle to IIFE as-is; the sandboxed entry and `/view` need `define: { "import.meta.url": "document.baseURI" }`; the recipe is a doc-tested Bun.build script, and its output ran in Chrome 154 under the strict CSP. An IIFE `/view` inlines both engines: 1.3 MB min, ~340 KB gzip). *Phase 8:* automated. The browser-test server builds both IIFE bundles from `dist/` with exactly that recipe (`/iife/<name>.js`), and `tests/browser/specs/csp.pw.ts` loads them from a page with no modules at all (`fixtures/iife.html`) under both documented policies in Chromium, Firefox and WebKit: under the trusted policy, a sandboxed `<scxml-view>` and a trusted session in `<scxml-explorer>` work with no violations; under the sandboxed policy, the view works and the trusted session is refused (its `eval` is the only violation). Originally: the package ships ESM only. The only `import.meta` use is inside the QuickJS variant (the sandboxed entry). It matters only when someone bundles the sandboxed entry into a classic script. Document it: bundle as ESM, or `define: { "import.meta.url": "document.baseURI" }`.
- [x] **[should]** CDN / import-map usage documented (`docs/bundling.md`). The map lists the four entries plus `quickjs-emscripten-core`, `@jitl/quickjs-singlefile-browser-release-sync` and `@jitl/quickjs-ffi-types`; tested in Chrome with the same files served locally in jsDelivr's layout. The real jsDelivr/esm.sh URLs can only be tried after publishing (see *Before you publish*).
- [-] **[polish]** An optional separate `.wasm` for the sandbox. *Deferred:* the single-file browser variant works everywhere (Node, Bun, Deno, bundlers, classic scripts) with no asset handling, and it already loads lazily (the sandboxed entry is 20 KB up front, 290 KB on demand; phase 5). A separate `.wasm` would only add streaming compilation and CDN caching, at the cost of a second sandboxed entry point and asset configuration in every bundler. Revisit if users ask.
- [x] **[polish]** QuickJS dependencies pinned exactly (`quickjs-emscripten-core` and `@jitl/quickjs-singlefile-browser-release-sync`, both `0.32.0`). `THIRD_PARTY_NOTICES` reproduces the MIT licences of quickjs-emscripten (Jake Teton-Landis) and QuickJS (Fabrice Bellard, Charlie Gordon), taken from the packages themselves.
- *Pack contents* (phase 8, `scripts/release`): 89 files, **338 KB packed / 1,395 KB unpacked**: `dist/` (28 modules as `.js`, `.js.map` and `.d.ts`, plus the theme CSS), README.md, LICENSE, THIRD_PARTY_NOTICES and package.json. No sources or tests. Source maps with inlined sources are 826 KB of the unpacked size, kept on purpose so stack traces and debuggers show the real code; the shipped JavaScript is about 415 KB and the declarations 153 KB. The QuickJS WebAssembly (about 1.2 MB) comes in through the dependency, not this package. (Phase 2 measured 43 files and 115 KB packed, before the two elements moved in.)

## 3. Public API

- [x] **[should]** Reviewed the exports:
  - **Removed:** `createSessionWith` (unused), the trusted entry's no-op `loadQuickJS`, and `CoreSession`.
  - **Hidden** (`@internal`, stripped from the declarations, not re-exported): `resolveModel`, `ScriptDataModel`, `sandboxedDataModel`, `trustedDataModel`, `QuickJSDataModel`, `TrustedDataModel` and `quickJSModule`.
  - **Still exported as the extension point** (types only, marked advanced): `DataModel`, `DataModelFactory` and `DataModelOptions`, needed to type `SessionOptions.datamodel`.
  - **`loadQuickJS()`** now returns `Promise<void>`. It used to return QuickJS's module type, which dragged QuickJS's declarations into consumers' type checks: with `skipLibCheck: false` those fail on `Disposable` unless `lib` is ESNext.
  - **Verified** with a consumer project (NodeNext, `skipLibCheck: false`): clean, and the internals really aren't importable.
- [x] **[should]** Consistent naming:
  - **`SCXMLSession`** (replacing `CoreSession`) is the public type every session has, whichever data model runs it, including invoked children and `ChildSessionEvent.child`. It follows `SCXMLEvent`, `SCXMLErrorEvent` and `SCXMLValidationError`. Each entry point still exports its own `Session` subclass and `createSession`.
  - **`SCXMLErrorEvent.kind`** (was `.error`) is typed as `SCXMLErrorKind` (`"error.execution" | "error.communication" | "error.platform"`). `.error` suggested an `Error` object, as on the DOM's `ErrorEvent`.
  - **Kept:** `status` (`"idle" | "running" | "done"`) plus `cancelled`. "Done" means terminated, and `cancelled` says how. Folding cancellation into `status` would break the common `status === "done"` check for no real gain.
- [x] **[should]** The `DOMParser` requirement outside browsers is handled with an explanatory `SCXMLParseError` (`code: "SCXML_NO_DOMPARSER"`) that shows the happy-dom one-liner and the pass-an-Element alternative. It's documented on `parseSCXML`, `createSession` and in the README.
- [x] **[should]** The global session registry and the `dispose()` contract are documented in the JSDoc of `SCXMLSession` (what a session holds until disposed, and why) and of `dispose()` (what it releases; idempotent). `createSession` says to dispose.
- [x] **[should]** The explorer has a complete element API: `attach()` / `detach()`, the `session`, `processors` and `clock` properties (setting one re-attaches), `follow` (property, reflected as `follow="true|false"`), and bubbling, composed events `scxml-focus`, `scxml-select` and `scxml-send` (cancelable), with a typed `HTMLElementEventMap` augmentation. The session gained a public read-only `clock`.
- [x] **[polish]** `snapshot()`'s JSDoc says exactly what it returns: `<data>` variables only, JSON-like copies (functions dropped, dates as ISO strings, `undefined` properties may be omitted), XML as a string (sandboxed) or DOM (trusted), and `{}` after `dispose()`. Not renamed.
- [x] **[polish]** Error codes:
  - `SCXMLValidationError.code = "SCXML_INVALID"`;
  - new `SCXMLParseError` with `code` `"SCXML_PARSE"` or `"SCXML_NO_DOMPARSER"` (`parseSCXML` used to throw plain `Error`s);
  - `DataModelError.code = "SCXML_DATAMODEL"`.
- *Notes, not done:* the element-level names (`scxml:enter` and so on), the `ElementBridge` class exported from `element-events` and not re-exported, and the view-model API are left to phase 4.

## 4. Correctness and spec

- [x] **[should]** Run the 9 manual W3C tests and record the results. Phase 5b: `conformance/manual.ts` runs them in both data models and prints everything a reader needs; the verdicts are in [conformance/MANUAL.md](conformance/MANUAL.md). **8 pass and 513 is not applicable** (Basic HTTP processor). The mechanically checkable verdicts are pinned in `conformance/conformance.test.ts` (14 more tests). Reading them found two real bugs, both fixed:
  - **250:** a cancelled invocation didn't run its `onexit` handlers, because the child only started one task after the invoke, so an event processed in between cancelled it before it had entered any state. Invoked sessions now start synchronously at the end of the macrostep, as the spec's main loop does.
  - **307:** `<log expr="">` raised `error.execution`; an empty `expr` now logs no value.
  - **178** also changed: repeated `<param>` names used to overwrite each other; now they collect into an array (`{ Var1: [2, 3] }`), as the spec requires every pair to be kept.
- [x] **[should]** State that the Basic HTTP processor isn't included (12 optional tests): [docs/deviations.md](docs/deviations.md), first section.
- [x] **[should]** A complete deviations list: [docs/deviations.md](docs/deviations.md). Every claim is pinned by `packages/scxmljs/test/deviations.test.ts` (22 tests, both engines). Writing it found an **inconsistency between the engines**, now fixed: values leaving the data model were converted differently (the sandbox dropped `undefined` keys, turned a top-level function into its source text and a cycle into `"[object Object]"`; trusted kept `undefined` keys, `NaN` inside objects and so on). Both now use one algorithm (`plainData` in `datamodel-base.ts`, with an engine-side copy for QuickJS), and the sandbox now detects cycles in values going *in*, as the trusted engine did.
- [x] **[should]** Tests for asynchronous loaders, invokes cancelled while loading, long-running sessions and many concurrent sessions: `packages/scxmljs/test/robustness.test.ts` (28 tests, both engines). Found and fixed:
  - **Events sent to an invocation whose source was still loading were lost:** they were buffered, but handed to the child before it started, and a session that isn't running drops incoming events. The child now starts first.
  - **`VirtualClock` was quadratic in the number of pending timers** (`clearTimeout` filtered an array, and finding the next timer scanned it): 100,000 events with a pending timer each took 100 s. It now uses a binary heap plus a map (O(log n) to schedule and fire, O(1) to cancel): the same test takes about 3.5 s, most of it the interpreter.
  - Covered and passing without changes: `<script src>` / `<data src>` loaders (success, failure, slow), `<invoke src>` failure, invocations cancelled while loading (the child never starts, nothing leaks), 1,000 invoke cycles, 200 sessions exchanging events through `#_scxml_<id>`, sends to disposed sessions, `dispose()` / `cancel()` clearing timers, and `dispose()` called from a session's own listener.
- [x] **[polish]** Validation warnings: `model.warnings` (`Diagnostic`: `code`, `message`, `element`, `state`) from `src/diagnostics.ts`, run by `compile()`. Codes: `SCXML_W_EXITS_PARALLEL` (the `type="internal"` trap), `SCXML_W_UNREACHABLE` (only the outermost state is reported), `SCXML_W_NEVER_DONE` (`done.state.X` / `done.invoke.X` that can never fire), `SCXML_W_SHADOWED` (a transition an earlier unconditional one always pre-empts). "Events nothing sends" is deliberately **not** checked: most events come from outside the document, so it would fire on almost every real chart. `<scxml-view>` lists warnings in a collapsed panel above the diagram (each focuses its state; `warnings="off"` hides it), and the explorer lists a state's warnings in its detail pane. 11 unit tests plus one element test each. **Noise:** 0 warnings on the playground charts (gatekeeper, fulfilment, support desk); 19 on the 200 W3C tests, all accurate: 16 states the tests deliberately never enter, 2 real duplicate transitions (tests 343 and 488), and test 580's deliberate exit of a parallel state.
- Note for phase 6: the package README links to `../../docs/deviations.md`, which won't resolve on npm (docs aren't shipped). Decide whether to ship the doc or link to the repository.

## 5. Explorer (the custom element)

- [x] **[blocker]** The explorer and view-model are in the package: `src/explorer/{element,viewmodel,styles}.ts`, exported as `@tinyactors/scxmljs/explorer`.
  - They work with sessions from both entry points and import only shared internal modules, never an entry point, so the explorer bundle has no QuickJS: 66 KB minified, 20 KB gzip.
  - The module is safe to import without a DOM (server-side rendering): it extends a stand-in class and registers only where `customElements` exists. A test and `smoke:node` check this.
  - Samples, fake services and their tests stay in the playground.
- [x] **[blocker]** Tests: `test/explorer-viewmodel.test.ts` (tree, focus scope, follow, accepted events, system tracker) and `test/explorer-element.test.ts` (17 tests in happy-dom):
  - rendering, navigation and `scxml-focus`, Send and cancelable `scxml-send`;
  - playback Step advancing exactly one macrostep;
  - the windowed tree at 1,000 states, and tabs;
  - the element API, all focus layouts, doors and show-more;
  - state and service details, tree filters, event filters and data;
  - the System level with a child machine and with 11 machines, and paging a 50-state list;
  - header controls, and re-attaching after a DOM move.
  Library coverage is 98.4% of lines and 90.9% of functions; the thresholds are unchanged.
- [x] **[should]** Decided: **both elements ship** (see *Decisions*); `<scxml-view>` is rebuilt in phase 4c (done: `./view`, and the playground copy is deleted). *Note:* 4a briefly deleted its files before this decision, and they had never been committed or staged, so they were rebuilt from the recorded history. That covers the pre-phase versions plus every later scripted change: typed events, the element guard, the declarative Allow/Disallow form with `reflectEnabled`, the removed XHTML code, the rename, and lint fixes. They behave as before, checked in the browser, but aren't guaranteed byte-identical.
- [x] **[should]** `::part()` hooks on every region, and a documented `--scxml-*` token contract (package README, *The explorer*). The tokens, the neutral defaults and the shared primitives live in `src/ui/theme.ts`, one constructable stylesheet that every element adopts, so `<scxml-view>` (4c) shares them. The private `--x-*` aliases read `--scxml-*` first.
- [x] **[should]** A neutral default theme: system font stacks, no font loading, one indigo accent, and `light-dark()` colours. The element doesn't set `color-scheme` itself, so it follows the page; `--scxml-color-scheme` overrides that. The Tinyactors look is the optional stylesheet `@tinyactors/scxmljs/themes/tinyactors.css`, which maps the Tinyactors tokens onto `--scxml-*` for both elements; the playground uses it, and `?theme=neutral` shows the default.
- [x] **[should]** The focus diagram's layout (4b):
  - arrows are redrawn when the diagram resizes (a `ResizeObserver`, once per frame);
  - "auto" re-decides diagram vs list whenever the pane's width changes;
  - labels are placed deterministically (live edges first, then document order) at their arrow's middle or the nearest free spot above or below, avoiding cards and other labels (`src/explorer/layout.ts`, unit-tested); labels with no free spot collapse to their event count and open on hover;
  - long event names ellipsize at the column gap.
- [x] **[should]** Link pulses and "hot" state use the session clock. `SystemTracker` stamps traffic with `clock.now()` (the root session's clock by default) and has `isHot(link)`, so hot links are right when paused, stepped or sped up.
- [x] **[should]** More slots (4b). One approach throughout, named slots, so any framework can render them: `event:<descriptor>` (in an accepted event's row), `service:<alias>`, `toolbar` (in the header), `empty-tree` / `empty-events` / `empty-detail` (replacing the default message, which is the slot's fallback). They join `state:<id>` and `detail:<id>`. No render callbacks: slots keep custom UI in the host's framework.
- [x] **[should]** No external font loading in the package: the explorer uses system fonts unless tokens say otherwise. The rebuilt `<scxml-view>` (4c) loads none either.
- [x] **[polish]** Translatable strings (4b): every visible string, accessible name and announcement lives in `ExplorerStrings` (`src/explorer/strings.ts`) with English defaults. The `strings` property takes a partial override; counts and interpolations are functions, so translations control word order and plurals (defaults use `Intl.PluralRules`). A test renders every default string.

### Phase 4b (done): accessibility, strings, layout polish

- Section 11 items: see there.
- Translatable strings, the diagram layout, more slots: see above.
- The System view's link re-layout: see section 13.
- Also:
  - the tree now expands the active path once on the first configuration, even with `follow="false"` (the focus still stays put);
  - one breakpoint (`NARROW_WIDTH` = 760 px) is shared by the CSS container queries and the element, which measures its host with a `ResizeObserver` instead of reading `clientWidth`;
  - `PlaybackClock` now notifies subscribers when work is queued, so the playback bar's queue count and the Step button stay current after a host calls `send()` while paused (Step used to stay disabled until something else re-rendered).
- The explorer's budget went from 73 / 22 KB to 88 / 27 KB (minified / gzip). It measures 79.3 / 24.3 KB: the strings table, keyboard handling, live region and label placement.

### Phase 4c: `<scxml-view>` rebuilt into the package

- [x] In the package as **`@tinyactors/scxmljs/view`** (`src/view.ts` → `src/view/{element,layout,strings,styles}.ts`), with a `sideEffects` entry (`dist/view.js`, `dist/view/element.js` and the `src/` counterparts), a size budget, a no-DOM import check in `smoke:node`, and the package README section. The playground's old `src/ui/scxml-view.ts` is deleted, and `/element` uses the library element. The fake-GitHub `harness.ts` stays, since it's the page's demo panel.
- [x] Zero-JS usage: `<scxml-view src="chart.scxml">` or an inline `<script type="application/scxml+xml">`. `src` is fetched relative to the page, and the chart's own `src`s resolve relative to it. An inline source parsed before its children exist waits for `DOMContentLoaded`. The element parses, compiles and validates, creates a session and starts it (`autostart="false"` only draws). **Sandboxed by default; the `trusted` attribute picks the host engine.** Both engines come in through `import()`, so neither is in the element's own bundle. A host `session` property loads no engine: the element shows that session and never starts or disposes it. More attributes: `interactive`, `data` (JSON), `direction` (`auto` / `right` / `down`), `max-states`, `announce`, `fit`. More properties: `options`, `clock`, `source`, `strings`, `model`, `reload()`. Events: `scxml-load`, `scxml-error` (with the validation problems) and a cancelable `scxml-send`.
  - Bundle per path (minified / gzip; checked on `dist/` with Bun.build and splitting): **the element 93 KB / 31 KB**, interpreter included, and **that's all with a host `session`**. **`trusted` adds 5 KB / 2.2 KB. Sandboxed adds 1.2 MB / 293 KB**: 3.6 KB of glue plus the QuickJS build that the main entry also loads lazily. `scripts/size.ts` now bundles with code splitting: `minKB`/`gzipKB` budget what loads up front, and the new `lazyGzipKB` budgets everything behind `import()`, listed per target. This also shows that the main entry's QuickJS was already a lazy chunk: 55 KB up front + 290 KB lazy.
  - `tsc` rewrites the dynamic `import("../datamodel-*.ts")` specifiers to `.js` in `dist/`, as verified.
- [x] Shared tokens, neutral theme and parts. It adopts `themeSheet()` (so `--scxml-*` tokens, `light-dark()`, reduced motion and no font loading), and `themes/tinyactors.css` already targets it (checked in both playground themes). Parts: `frame`, `canvas`, `state` (+ `atomic` `compound` `parallel` `parallel-region` `final` `history` `collapsed` `active`), `state-name`, `transition` / `edge-label` (+ `live` `fired`), `event`, `cond`, `internal`, `edge` (+ `live` `fired`), `initial`, `expand`, `collapse`, `notice`, `error`, `controls`, `play`, `step`, `speeds`, `clock`. Strings are translatable (`ViewStrings`, with functions for plurals). There's a polite live region (the explorer's announcer, moved to `src/ui/announcer.ts` and shared), labels are buttons with accessible names, state boxes carry name + kind + "active", and the canvas can take focus. The 760px breakpoint (`NARROW_WIDTH`) moved to `src/ui/theme.ts` for both elements. Constructable sheets are now made per realm (`lazySheet()`), so they can be adopted where the page's `CSSStyleSheet` differs.
- [x] Animation and "fired" highlights run on the session clock: a transition stays `fired` for 900 ms of **session** time, so with a `PlaybackClock` it pauses, steps and speeds up with playback, and with a real clock it fades on animation frames. A `PlaybackClock` also shows play / pause / step (to the next macrostep) / speed / time controls, with the shortcuts Space and `.`.
- [x] A real layout algorithm, evaluated against ELK. **Decision: in-house.** `src/view/layout.ts` is a layered (Sugiyama) layout on the hierarchy:
  - greedy feedback-arc-set cycle breaking (Eades–Lin–Smyth), with the initial state preferred first;
  - longest-path layering with dummy chains;
  - barycentre crossing reduction;
  - alignment;
  - transitions lifted to the siblings they connect, then routed orthogonally through gutters, so they exit and enter containers without crossing boxes;
  - back edges routed backwards through the gaps;
  - parallel regions stacked across the layer direction;
  - labels placed on the edge's own segments.

  Evaluated with `scripts/eval-view-layout.ts` (ELK 0.10 layered, run in Node by `scripts/elk-layout.mjs`, since elkjs's worker doesn't start under Bun) on the 11 playground and W3C charts, with the same box and label sizes for both:

  | | in-house | ELK (layered, hierarchy) |
  |---|---|---|
  | edge crossings (total) | 47 (50 after phase 8's two new gatekeeper transitions) | 8 |
  | edges through unrelated boxes | 0 | 0 |
  | label overlaps | 1 | 0 |
  | area (kpx²) | 11,044 | 14,664 |
  | bends | 400 | 300 |
  | layout time (total, median of 5) | 2.0 ms | 94.9 ms |
  | bundle | ~12 KB min in the element | +1,418 KB min / 426 KB gzip |

  ELK's layouts cross less, but it would put more than 400 KB gzip on every page for about 40 fewer crossings over 11 charts, most of them in the 7,000-kpx² `fulfillment` chart that the explorer is built for anyway. The in-house layout is dependency-free, about 47× faster (so it can re-lay out on resize and on unfolding) and 25% more compact, with no edges through unrelated boxes. ELK stays a possible host-supplied layout later; `layoutChart()`'s output shape (boxes, edges with points, label rects, initial markers) would fit it.

  **Degradation for large charts:** above `max-states` (default 150) boxes, `autoCollapse()` folds the largest compound states first, and those holding the active configuration last. Each folded state is one box with an "N states" badge and an Expand button (a Collapse button on the unfolded container), and a notice offers Expand all and points to `<scxml-explorer>`. More than 3 targetless transitions in one box show as "+N more". Narrow widths lay out top-down (`direction="auto"`), and `fit` scales to the width instead of scrolling.
- [x] Tests and docs:
  - `test/view-element.test.ts` (11 tests, happy-dom): inline + trusted, `src` + sandboxed, a host session, errors (none / invalid / bad `data` / 404), sending from labels (with cancel and disabled state), `interactive` / `autostart`, the `options` and `data` merge, playback controls and shortcuts, folding, `strings`, `source`, `reload()` and `direction`.
  - `test/view-layout.test.ts`: every playground chart in both directions. Boxes nest, siblings don't overlap, edges start and end on their boxes, each label is placed once, results are deterministic, plus cycles, self loops, parallel regions, history and `autoCollapse`.
  - The package README has a `<scxml-view>` section: usage, attributes, properties, events, engine sizes, large charts, layout, parts.

## 6. Documentation

- [x] **[blocker]** Getting started: install, first chart, run it, render it (`docs/getting-started.md`).
- [x] **[blocker]** API reference, generated from the sources: TypeDoc 0.28 in `tools/typedoc/` (own `package.json`/lockfile with TypeScript 5.9, because the workspace's TypeScript 7 has no compiler API). `mise run docs:api` writes `docs/api/` (gitignored); `treatWarningsAsErrors` plus `notDocumented`/`invalidLink` validation, and CI builds it. JSDoc gaps were filled (0 warnings). Publishing the HTML (for example on GitHub Pages) is a step after publishing (see *Before you publish*).
- [x] **[blocker]** `SECURITY.md` and the threat model for "sandboxed".
- [x] **[should]** Guides (`docs/`): sandboxed vs trusted, I/O processors, invokers, testing, playback, theming, custom UI (strings, slots, own drawing, own explorer), driving charts (bind/connect/`data-scxml-*`, `reflect`/`elementEvents`), large charts, Node and servers, bundling, CSP, element references (`view.md`, `explorer.md`), index (`docs/README.md`).
- [x] **[should]** A conformance report: `docs/conformance.md`, generated by `mise run docs:conformance` (both data models, per test, manual verdicts, deviations); CI fails if it's stale.
- [x] **[should]** A support table (`docs/bundling.md#support`, summarised in the package README). The browser minimums are derived from the features used (`light-dark()` → Chromium 123, Firefox 120, Safari 17.5). *Phase 7 filled in the verified columns: Chromium 153, Firefox 155, WebKit 26.6 (with the Safari caveat), Node, Bun and Deno, all tested in CI.*
- [x] **[should]** Minimal HTML example, framework examples, a server-side example. *Phase 7: every framework snippet in `docs/frameworks.md` is now a file of a real app in `examples/frameworks/{react,vue,svelte,angular}` (React 19.3 + `bun build` + `tsc` with `skipLibCheck: false`; Vue 3.5 SFC + Vite 8; Svelte 5.57 + Vite 8; Angular 22.2 zoneless + `ng build`, `strictTemplates`). A new doctest mode (`<!-- doctest: app file=… -->`) fails if a snippet and its file ever differ, so docs:test now skips nothing. `mise run examples:frameworks` installs (frozen lockfiles) and builds them (~3 s together), and `frameworks.pw.ts` loads each in Chromium: the view runs, its `scxml-load` handler fires, the explorer receives its `session` property. The snippets worked unchanged. Angular turned out light enough (~5 s install, ~3 s build) to run in every CI run, so there's no gate.*
- [x] **[should]** `CHANGELOG.md` (Keep a Changelog) with the versioning policy (0.x: breaking changes in minor versions; public API = entry-point exports, element attributes/properties/events/slots/parts, `--scxml-*` tokens; `@internal` and shadow-DOM classes excluded).
- [x] **[should]** Content-Security-Policy requirements: `docs/csp.md`.
- [x] **[should]** The README says that contributions aren't accepted (root and package README).
- [x] **[polish]** Screenshots in the README: `docs/images/{view,explorer}-{light,dark}.webp` (neutral theme), referenced through raw.githubusercontent URLs so npm renders them.
- *How samples are tested:* every TS/JS/HTML/SCXML block in the docs carries an invisible `<!-- doctest: … -->` directive (`run` + `output`, `test`, `check`, `html`, `scxml`, `skip reason=…`); untagged samples fail. `mise run docs:test` type-checks them against the sources, runs them with Bun and compares stdout, renders HTML in happy-dom with both elements, compiles charts without warnings, and checks copies of `docs/examples/*` are identical. `mise run docs:links` checks every relative link and anchor, that repository links use the single base URL in `scripts/docs/config.ts`, that images use raw URLs and that the npm README has no relative links. All four doc checks run in `scripts/ci`.
- *Repository URL:* `https://github.com/tinyactors-dev/scxmljs` is one constant (`scripts/docs/config.ts`); `mise run docs:set-repo -- <old URL>` rewrites docs and `package.json` if it changes.
- *Library changes made for the docs:* `DOMParserLike` (any DOMParser, no casts), exported `Invocation`/`ParentInvocation`, `memoryLimitBytes`, `defaultExplorerStrings`/`ExplorerStrings`/`StateKindName`/`AnnounceMode` exports; style attributes replaced by CSSOM writes and SVG markers built with `createElementNS` (CSP and Trusted Types; guarded by `test/csp.test.ts`).

## 7. Measurements

Measured so far:

| | Result |
|---|---|
| Sandboxed entry (browser, built `dist/`, code-split) | 61 KB minified / 19.5 KB gzip up front (budget 67 / 22 KB) + the QuickJS build behind `import()`: 290 KB gzip (budget 319 KB). Phase 5b added about 6 KB (warnings, shared value conversion, the heap-based clock) and raised the budget to keep ~10% headroom |
| Trusted entry (browser, built `dist/`) | 54 KB minified, 17 KB gzip (budget 60 / 20 KB) |
| Explorer entry (browser, built `dist/`) | 79 KB minified, 24 KB gzip (budget 88 / 27 KB), no WebAssembly (was 66 / 20 KB before 4b) |
| View entry (browser, built `dist/`, code-split) | 99 KB minified / 33 KB gzip up front, interpreter included (budget 109 / 37 KB); + trusted engine 5 KB / 2.2 KB, or + sandbox 293 KB gzip (lazy budget 324 KB); nothing more with a host `session` |
| View layout | 11 test charts in 2.0 ms total (ELK: 94.9 ms); see phase 4c |
| Tinyactors theme stylesheet | 1 KB (budget 2 / 1 KB) |
| Coverage, library, **including the W3C suite in both data models** (`scripts/coverage.ts`) | 97.5% of lines, 93.1% of functions (gate raised to 97% / 92%) |
| Cold start (fresh process, Bun / Node) | sandboxed 14.9 / 13.6 ms (import + QuickJS instantiation); trusted 1.6 / 2.6 ms |
| Compile (Bun / Node) | 17 states 67 / 89 µs; 333 states 1.7 / 2.5 ms; 1,000 states 2.9 / 6.0 ms; 5,000 states 23 / 41 ms (roughly linear) |
| Memory per session (500 sessions, Bun / Node) | sandboxed: 172 / 106 KB RSS, of which 65.5 KB QuickJS WebAssembly memory; trusted: 110 / 217 KB RSS. A 15-machine support-desk system: 3.2 / 2.5 MB sandboxed, 2.9 / 4.4 MB trusted |
| Throughput (Bun / Node) | sandboxed 93k / 56k events/s, 101k / 85k microsteps/s; trusted 172k / 76k events/s, 189k / 132k microsteps/s |
| Leak check (1,000 × create/start/send/dispose, Bun / Node) | heap flat: sandboxed 43.28 → 43.54 MB / 21.74 → 21.84 MB, trusted 9.82 → 10.01 / 20.14 → 20.22 MB across four checkpoints |
| Explorer in Chrome 154 (1500×950) | first render within a frame up to 5,001 states (4–18 ms); the windowed tree keeps 31 rows in the DOM; scrolling 5,001 rows: 16.7 ms median / 17.3 ms p95 frames, 0 long tasks |
| `<scxml-view>` in Chrome 154 | 13–17 ms for 17–333 states (session given); 15–38 ms from source text (trusted); 1,000 states folded to 137 boxes: 45 ms |
| Conformance | 160/160 mandatory in both modes; 21/33 optional |
| Node | works (22.3 and 26.10), `mise run smoke:node` |
| Packed tarball | 83 files, 305 kB packed, 1,266 kB unpacked (source maps with inlined sources are most of it) |

Full results: [`docs/measurements.md`](docs/measurements.md) (generated) and `bench/results/<date>.json`. Reproduce with `mise run bench` (≈25 s; the browser part needs `mise run up` and agent-browser).

- [x] **[should]** Coverage including the conformance run: `conformance/conformance.test.ts` runs the vendored W3C suite in both data models as part of `bun test` (386 tests, 0.3 s; every mandatory test, and every optional one except the 12 that need the Basic HTTP processor, must pass). The gate now uses the combined number and was raised from 93% / 85% to 97% / 92%. `conformance/run.ts` stays as the readable report; both use `conformance/harness.ts`.
- [x] **[should]** Startup: QuickJS load and compile, time to first explorer render (table above).
- [x] **[should]** Memory per session, in both modes (table above).
- [x] **[should]** Throughput: events per second and microsteps per second (table above).
- [x] **[should]** Scaling to 1,000 and 5,000 states: compile time, explorer render time, tree scrolling (table above; generated charts from `bench/charts.mjs`).
- [x] **[should]** Leak check: 1,000 sessions created and disposed. Full version in the bench (both models, Bun and Node); regression version in `packages/scxmljs/test/leak.test.ts` (1,500 cycles per model, growth must stay under 750 B per session; it's ~50 B today, and was 1,500–6,600 B before the fix below).
- [x] **[should]** Benchmark harness: `scripts/bench.ts` (orchestrator), `bench/runtime.mjs` (runtime measures, run in fresh Bun and Node processes against `dist/`), `bench/charts.mjs` (deterministic chart generators), `examples/playground/web/bench.html` (`/bench`, browser measures). `scripts/ci` runs `bench --quick` (≈6 s, no thresholds) only to keep the harness from rotting.

**Findings from the measurements (all fixed, with regression tests; conformance stays 160/160 in both modes):**

1. **Trusted mode under Bun lost a variable after ~583 assignments.** Each `<assign>` used a fresh temporary global (`__scxml_tmpN`) and deleted it in a separate script; after 583 of those, a strict-mode read of the assignment's target returned `undefined`. Reproduced in plain Bun `node:vm` without the library, so it's a Bun / JavaScriptCore caching issue, but it affected any long-running trusted session under Bun. Fix: temporary globals are named by nesting depth and reused (`datamodel-base.ts`); test in `trusted.test.ts`. Worth reporting upstream to Bun.
2. **Trusted sessions leaked ~1.5 KB (Bun) to ~6.6 KB (Node) each, also in browsers.** Every session evaluated a system-variable prelude with its own session id inlined, so the engine's compilation cache kept one script per session. Fix: the prelude's source is now constant and receives its values as data, in both engines (`SYSTEM_VARIABLES_SOURCE`); test in `leak.test.ts`.
3. **`document.createElement("scxml-explorer")` failed in every browser** (it returned an `HTMLUnknownElement`): the constructor set `tabindex`, and the HTML spec forbids constructors from adding attributes when elements are created by script. Elements written in HTML weren't affected, which is why the playground didn't show it; React, Vue and most frameworks create elements with `createElement`. Fix: `tabindex` is set in `connectedCallback`; tests assert that neither element's constructor adds attributes or children.
4. **`<scxml-view>` dropped a host session set after the element was added to the page**: `connectedCallback` queued a load of `src` / inline source, and it ran after `view.session = …`, tearing the host's session down. That's the order frameworks use. Fix: the queued load checks for a host session when it runs; test in `view-element.test.ts`.

Nothing else was alarming: compile time scales linearly to 5,000 states, the leak check's heap stays flat, and the explorer stays at 60 fps with 5,000 states.
- [x] **[should]** Size budgets for every entry point, enforced by `scripts/ci`: `scripts/size.ts` bundles each subpath in the package's `exports` from `dist/` (minified, for the browser), gzips it, and compares with `size-budgets.json` (about 10% headroom). Since 4c it bundles with code splitting: `minKB` / `gzipKB` cover what loads up front, and `lazyGzipKB` covers everything behind `import()`, listed per target. An export without a budget fails the check. `bun scripts/size.ts --update` suggests values.
- [x] **[polish]** Accessibility audit (phase 7): axe-core 4.13 (WCAG 2.0/2.1/2.2 A and AA plus best practices) runs in the browser tests over `<scxml-explorer>` at every level (machine, System, state detail, parallel lanes) in a wide and a 400px container, `<scxml-view>` with all three data paths, and the playground explorer in the Tinyactors theme, each in light and dark, in Chromium, Firefox and WebKit: **0 violations** (48 audits). It first found, and phase 7 fixed: the inspector switch was a `tablist` of toggle buttons (now a `group`); the explorer's `<header>` created duplicate banner landmarks (now a `div`); cards and list rows were buttons containing buttons (now labelled groups whose state name is the primary button); drill buttons and event chips were under 24px (now ≥ 24px, WCAG 2.2 target size); machine/service cards were `<article role=button>` with button chips inside (now `div`s with text chips); the narrow layout's event strip had an `aria-label` on a generic `div` (now a `group`); several explorers on one page had identically named breadcrumb landmarks (the host's `aria-label` now names each).

## 8. Testing and CI

- [x] **[blocker]** `scripts/ci` runs everything, and `.github/workflows/ci.yml` only checks out the repository and runs it (two steps, nothing else). *Light vs full:* pushes and pull requests run the light checks (lint, typecheck, build, unit tests with coverage incl. the W3C suite, conformance, Node smoke, package contents, size budgets, docs). The heavy ones (benchmark harness, packed tarball in Node/Bun/Deno, framework apps, browser tests, visual regression) only run for release preparation: `v*` tags, `release/*` branches and manual runs (`workflow_dispatch`); the script reads `GITHUB_REF`/`GITHUB_EVENT_NAME` itself, so the workflow stays one step. Locally: `scripts/ci --full` / `mise run ci:full`; `scripts/release` always runs it.
  - The script bootstraps its own toolchain: mise via the official installer if it's missing, then `mise install bun node biome` (pinned in `mise.toml`), then `bun install --frozen-lockfile`.
  - Checks, in order, each also a mise task: `lint`, `typecheck`, `build`, `test:coverage`, `conformance`, `conformance:trusted`, `smoke:node`, `pack:check`, `size`, the docs checks, `bench:quick`, and since phase 7 `smoke:tarball`, `examples:frameworks`, `test:browser` and `test:visual`.
  - It stops at the first failure. Locally the whole run takes about 61 s (phase 7: unit tests + coverage 17 s, browser tests 12 s, visual regression 14 s, bench 6 s, the rest a few seconds each). The first run on a fresh machine also downloads the browsers and the Playwright image.
  - `mise run ci` runs the same thing.
- [x] **[should]** Browser tests (phase 7): Playwright 1.63 in Chromium 153, Firefox 155 and WebKit 26.6, `tests/browser/` (`mise run test:browser`; installs the browsers itself, with `--with-deps` on Linux). 102 tests, ~12 s. A Bun test server (`tests/browser/server.ts`) serves the playground pages (bundled from source) and fixture pages that load the **built** package through an import map, optionally under a Content-Security-Policy. Covered in every engine: both elements with the three sample systems (paused `PlaybackClock`, stepped deterministically); zero-JS `<scxml-view src>` and inline source; the sandboxed engine (WebAssembly) and the trusted one (iframe realm); a host session with playback controls; explorer levels, the tree's ARIA keyboard pattern, stepping, sending from the events pane; 390px and wide layouts and container queries (a 400px container in a wide page); light/dark (and a page without `color-scheme` stays light); reduced motion (no view transitions); right-to-left pages; the CSP and Trusted Types policies (see section 9); the axe audit (section 7). Files are `*.pw.ts`, so `bun test` doesn't collect them.
- [x] **[should]** Visual regression (phase 7): 6 screenshots per engine (explorer wide light/dark and 390px, view light/dark, the gatekeeper chart at 390px), 18 baselines in `tests/browser/specs/__screenshots__/<engine>/` (692 KB), compared with a 1% pixel tolerance, every clock paused. **Decision:** comparisons only ever run inside the pinned Playwright image (`mcr.microsoft.com/playwright:v1.63.0-noble`, `scripts/visual.sh`, `mise run test:visual`, `mise run test:visual:update`), on a laptop and in CI alike, so fonts and rendering are identical and the baselines can't drift between macOS and Ubuntu. node_modules live in Docker volumes, so the container installs Linux binaries without touching the host's. Without Docker it skips with a notice, except on Linux, where `scripts/ci` requires it. ~14 s with the image cached.
- [x] **[should]** Conformance runs without the network (vendored suite, see section 1).
- [x] **[should]** A formatter and linter: Biome 2.5.14 (pinned in `mise.toml`, config in `biome.json`).
  - Formatting matches the existing style: 2 spaces, double quotes, semicolons, trailing commas, 140 columns. The first format touched 24 files, the import sorting a few more.
  - Lint uses the `recommended` preset, with `noNonNullAssertion` off: the compiled model guarantees what `!` asserts, and strict TypeScript with `noUncheckedIndexedAccess` makes `!` the honest idiom.
  - The explorer's comma / assign-in-expression style was a **warning in `examples/**` only**. It was cleaned up when the explorer moved into `packages/` (4a); the library passes with no override. The override remains for the remaining playground code.
  - `mise run lint` reports errors only (`biome check .` shows the warnings too); `mise run format` fixes things.
  - The generated suite, the vendored design tokens and HTML are excluded.
- [x] **[polish]** Smoke test the packed tarball in an empty project (phase 7): `scripts/smoke-tarball.ts` (`mise run smoke:tarball`) runs `npm pack`, `npm install`s the `.tgz` into an empty temp project, runs `smoke-node.mjs` in Node 26.10, Bun 1.4 and Deno 2.9 (`--allow-read --allow-env --allow-sys`), and bundles all four browser entry points from `node_modules` with `bun build`. ~4 s. The plain-HTML case (the same built files through an import map) is covered by the browser-test fixtures.

## 9. Browser and runtime support

- [x] **[blocker]** Verify Firefox and Safari (WebKit) (phase 7): everything in section 8's browser tests passes in Firefox 155 and WebKit 26.6, including the iframe realm, adopted stylesheets, container queries, `color-mix()`/`light-dark()`, reduced motion around View Transitions, CSP and Trusted Types (all three engines enforce them). Caveat recorded in `docs/bundling.md#support`: Playwright's WebKit is Safari's engine, not Safari itself, and CI runs it on Linux.
- [-] **[should]** Try a shipping Safari by hand. *Deferred to the maintainer* (it needs a Mac with Safari and a human; no automation here can drive a real Safari): listed under *Before you publish*.
- [x] **[should]** Verify Node and Deno (phase 7): the tarball smoke test runs in Node 26.10 (22.3 checked by hand in phase 2), Bun 1.4 and Deno 2.9 (pinned in `mise.toml`; Deno needs `--allow-read --allow-env --allow-sys` and a DOMParser such as `npm:happy-dom`). The support table in `docs/bundling.md` and the package README say what's tested in CI.
- [x] **[should]** Document the CSP requirements: `docs/csp.md`. Tested in Chrome 154 (ESM and IIFE builds): sandboxed needs `script-src 'wasm-unsafe-eval'`, trusted `'unsafe-eval'`, `style-src 'self'` is enough (no `'unsafe-inline'`), chart fetches need `connect-src`, an inline import map needs a hash/nonce. Trusted Types (`require-trusted-types-for 'script'`): the elements work; SCXML text needs a host `domParser` wrapping a TT policy (documented); the trusted data model can't work (eval). *Phase 7: automated in `tests/browser/specs/csp.pw.ts` in Chromium, Firefox and WebKit with these exact policies (plus the import map's hash): sandboxed policy → sandboxed view and explorer work with no violations, a trusted view is refused (its `eval` is the only violation); trusted policy → everything works, no violations; Trusted Types → enforced in all three engines, a sandboxed view with the documented `domParser` and the explorer work with no violations. Phase 6's "no cards rendered" in the explorer under Trusted Types was timing in its quick DOM check, not a bug: the test waits for the focus pane and attaches a screenshot of it.* *Phase 8: the classic-script (IIFE) bundles run under both policies in all three engines too (section 2).*

## 10. Security

- [x] **[blocker]** `SECURITY.md` (private report to dario.hamidi@gmail.com, no bounty, latest 0.x supported):
  - what is isolated and what isn't;
  - resource limits (64 MB, script timeout);
  - QuickJS vulnerabilities count as ours;
  - how to report a problem.
- [x] **[should]** Prominent warnings about trusted mode (it can reach `parent`, and loops can't be interrupted): `SECURITY.md`, `docs/sandboxed-vs-trusted.md`, `docs/node-and-servers.md` (`node:vm` isn't a boundary), package README.
- [x] **[polish]** Fonts are never loaded from Google by default: neither element loads fonts (4a/4c), and the browser tests prove it, since `default-src 'self'` in the CSP tests would report any font request as a violation and there are none.

## 11. Accessibility and internationalisation

- [x] **[should]** Arrow-key navigation in the tree, with a roving tabindex (4b):
  - the ARIA tree pattern: ↑ ↓ ← → Home End, Enter / Space, type-ahead;
  - `aria-level`, `aria-setsize`, `aria-posinset` and `aria-expanded` on each row;
  - the cursor row is always rendered despite windowing, and keeps keyboard focus across re-renders;
  - while the tree isn't focused, its tab stop follows the current focus.
  Cards, list and lane rows, doors and System cards are buttons or links with names that say their kind and status (Enter drills in or selects, Space selects); every Send button is named "Send <event>". Checked with a keyboard-only walkthrough in Chrome.
- [x] **[should]** A polite live region (`role="status"`) announcing steps and events sent from the UI (4b):
  - paused or stepping: every step is announced at once;
  - while a clock plays: at most one step per `announceInterval` (default 3 s), the latest winning;
  - `announce="all|sends|off"` controls it; machines starting aren't announced.
- [x] **[should]** Contrast checked in both themes, colour never the only signal (4b):
  - `CONTRAST_PAIRS` (`src/ui/theme.ts`) lists the pairs every theme must meet: text 4.5:1, `--scxml-fg-faint` and `--scxml-border-strong` 3:1 (graphics only).
  - The neutral theme is checked by a package test; one fix: the faint tone became graphics-only (counts and labels now use the subtle tone), and light-mode "running" was darkened a notch (was 4.47:1 on its background).
  - The Tinyactors mapping is checked against the real tokens by `examples/playground/test/contrast.test.ts`. Three pairs failed in light mode, so the mapping changed, not the design tokens: subtle text → `--fg-2`, faint → `--fg-3`, and "waiting" text = the ochre deepened 20% towards `--fg-1`.
  - Words or shapes accompany every status: badges, "inherited" / "elsewhere" tags on events, screen-reader text on tree rows, and a filled vs hollow Follow dot.
- [x] **[polish]** Reduced motion and focus-visible (4b): with `prefers-reduced-motion`, no view transitions (tested), pulses or transitions. Visible focus rings on every focusable element (inset on tree rows so the scroll pane doesn't clip them); inputs lost their `outline: none`.

## 12. Release (dry run only)

- [x] **[should]** `scripts/release` (`mise run release`; phase 8) is a **dry run by design**: it has no code path that publishes (its only `npm publish` call carries `--dry-run`, and it asserts that before running it). In order it:
  - checks `CHANGELOG.md` has `## [<version>] - YYYY-MM-DD` (it refuses the `unreleased` placeholder) and the version's link line;
  - checks git: warns if there are no commits yet; otherwise requires a clean tree and a free `v<version>` tag;
  - asks the registry, read-only (`npm view`), that the version isn't published yet (a warning if offline);
  - checks `package.json` (required fields, `publishConfig.access: public`, not private, `repository.url` matches `scripts/docs/config.ts`);
  - runs the full `scripts/ci` (`--skip-ci` skips it, with a warning, and only builds);
  - `npm pack`s into a temporary directory, unpacks it and verifies the tarball: only expected files, README/LICENSE/THIRD_PARTY_NOTICES present, every `exports` target and its types inside, no `.ts` imports left in declarations; prints sizes and the integrity hash;
  - runs `npm publish <tarball> --dry-run --access public --tag latest`;
  - prints a summary (passes, warnings, blockers), the exact publish commands (with and without provenance) and the tag to push; exits non-zero while anything blocks.

  Today it reports one blocker (the changelog date, left for the maintainer on purpose) and two warnings (no commits yet, and `--skip-ci` when used).
- [x] **[should]** Versioning policy: in `CHANGELOG.md` (*Versioning*) and the package README (*Stability*). SemVer with the 0.x rule (breaking changes in minor versions until 1.0, each listed with what to do instead). Public API = everything the four entry points export, the elements' attributes, properties, events, slots and parts, the `--scxml-*` properties and the theme stylesheet; `@internal` exports are stripped from the declarations (`stripInternal`) and aren't public.
- [x] **[polish]** npm provenance documented: *Before you publish*, step 7, and the release script's output (GitHub Actions with `id-token: write` and a token or trusted publishing; a laptop publish has no provenance). No publish workflow was added, on purpose.

## 13. Rough edges from the prototype

- [x] The gatekeeper example drops issues that arrive while it is busy (phase 8): the chart now queues them. A `gatekeeper`-level internal transition pushes issues that arrive mid-flight onto a `queue` data item, and an eventless transition in `ready` takes the oldest when the machine is back. No warnings; a playground test sends three issues at once and checks they're handled in arrival order. (The webhook server's one-session-per-issue design was never affected.)
- [x] Document the `type="internal"` pitfall with parallel states (phase 8): `docs/getting-started.md` has an *Authoring warnings* section with all four warning codes and a run, output-checked example of the trap (with and without `type="internal"`); `docs/deviations.md` links to it instead of a README section that didn't exist.
- [x] The System view re-lays out its links on every render (4b): the drawn SVG is cached under a layout key (shown machines and whether each has leaves / invoke / talk lines, services, links, filter, compact mode). Renders with the same key reuse it and only toggle `hot` on paths; a structural change or a resize (a `ResizeObserver` on the pane) redraws.
- [x] Font loading: neither element loads fonts (explorer 4a, `<scxml-view>` 4c).

## Phase 7 findings (browsers, runtimes, frameworks)

Found by the new browser tests and fixed (library tests added; conformance stays 160/160 in both modes):

1. **`<scxml-view>` truncated text after any re-layout while scaled, worst in WebKit.** Box and label sizes were measured with `getBoundingClientRect()`, which includes the scale transform, so a relayout while the diagram was scaled (a resize, `fit`, crossing the narrow breakpoint) measured shrunken boxes. They're now measured with layout sizes (`offsetWidth`/`offsetHeight`). The scaling itself moved from CSS `zoom` (WebKit shrinks boxes but not their text) to `transform: scale()` with negative margins, identical in every engine.
2. **Narrow containers (4c's rough edge).** Without `fit`, a diagram wider than the element now scales down on its own, but no further than `--scxml-min-scale` (a new token, default 0.65, so labels stay legible), and the rest scrolls; `fit` still scales all the way; `--scxml-min-scale: 1` turns it off. Decided against making `fit` the default: at phone widths it shrinks the gatekeeper chart to 37%, which is unreadable.
3. **A terminated session showed nothing.** The spec empties the configuration on exit, so a finished chart had no marked state. The view now keeps the final configuration marked with a `reached` part/class (and "reached" in the accessible name).
4. **An empty `<scxml-view>` fired `scxml-error` "No SCXML to show"** before a framework could set `session` (every framework creates the element first). It now shows the hint quietly in the frame (`empty` part) and fires nothing.
5. **Accessibility:** seven axe findings in the explorer, all fixed (section 7).
6. **Right-to-left:** the view's left-to-right diagram floated to the far right of its canvas (now anchored at the start); the explorer's disclosure triangles pointed the wrong way (now mirrored). Recorded as limitations: arrows written inside labels (→) don't flip, and the view's diagram isn't mirrored.
7. **Inline charts can't contain `<script>`**: the HTML parser ends the outer `<script type="application/scxml+xml">` at the inner `</script>`. Documented in `docs/view.md` (use `src` for charts with scripts).

Not changed, with numbers: 4c's "empty area at the top left of the gatekeeper chart" comes from aligning each layer with its neighbours (a tall parallel state pulls whole layers down). A post-pass that lifts layers closed ~3% of the area but raised crossings from 47 to 57 and label overlaps from 1 to 3 over the 11 evaluation charts (`scripts/eval-view-layout.ts`), so it was reverted; the automatic scaling above makes the chart fit far better anyway.

*Not wanted: a code of conduct, contribution guidelines, issue/PR templates.*
