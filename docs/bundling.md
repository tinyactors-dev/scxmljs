# Bundling, CDNs and classic scripts

The package is ESM only. It has four entry points (`@tinyactors/scxmljs`, `/trusted`, `/view`,
`/explorer`) and a stylesheet (`/themes/tinyactors.css`). This page shows how to get them into a
page: with a bundler, from a CDN with an import map, or as classic `<script>` files.

## With a bundler

Vite, esbuild, webpack, Rollup, Parcel and Bun need no configuration. Import what you use:

<!-- doctest: check -->
```ts
import { createSession } from "@tinyactors/scxmljs"; // or "@tinyactors/scxmljs/trusted"
import "@tinyactors/scxmljs/view"; // registers <scxml-view>
import "@tinyactors/scxmljs/explorer"; // registers <scxml-explorer>
```

Things to know:

- **Lazy engines.** `<scxml-view>` loads its data model with `import()` when it first needs one:
  QuickJS for sandboxed charts, the host engine for `trusted` ones. With code splitting (on by
  default in Vite, webpack and Rollup; `splitting: true` in esbuild and Bun), each engine becomes a
  separate chunk that's only downloaded when used.
- **The sandbox is one file.** QuickJS is compiled into the JavaScript (the WebAssembly is embedded
  as base64), so there's no `.wasm` file to copy, serve or configure.
- **Side effects.** The element modules register custom elements when imported. `package.json`
  lists them in `sideEffects`, so tree shaking keeps them; everything else can be shaken.
- **Server-side rendering.** The element modules can be imported where there's no DOM; they just
  don't register anything there.

Sizes, minified and gzipped, for a browser bundle of each entry point alone:

| Import | Size |
|---|---|
| `@tinyactors/scxmljs` | 20 KB, plus 290 KB of QuickJS loaded on first use |
| `@tinyactors/scxmljs/trusted` | 17 KB |
| `@tinyactors/scxmljs/view` | 33 KB, plus the engine it loads |
| `@tinyactors/scxmljs/explorer` | 25 KB |

## From a CDN, with an import map

Browsers can load the published files directly. An import map tells them where each bare
specifier lives: the package's entry points and its two QuickJS dependencies (which are only
fetched when a sandboxed session is created).

<!-- doctest: html files=traffic-light.scxml -->
```html
<script type="importmap">
  {
    "imports": {
      "@tinyactors/scxmljs": "https://cdn.jsdelivr.net/npm/@tinyactors/scxmljs@0.1.0/dist/index.js",
      "@tinyactors/scxmljs/trusted": "https://cdn.jsdelivr.net/npm/@tinyactors/scxmljs@0.1.0/dist/trusted.js",
      "@tinyactors/scxmljs/view": "https://cdn.jsdelivr.net/npm/@tinyactors/scxmljs@0.1.0/dist/view.js",
      "@tinyactors/scxmljs/explorer": "https://cdn.jsdelivr.net/npm/@tinyactors/scxmljs@0.1.0/dist/explorer.js",
      "quickjs-emscripten-core": "https://cdn.jsdelivr.net/npm/quickjs-emscripten-core@0.32.0/dist/index.mjs",
      "@jitl/quickjs-singlefile-browser-release-sync": "https://cdn.jsdelivr.net/npm/@jitl/quickjs-singlefile-browser-release-sync@0.32.0/dist/index.mjs",
      "@jitl/quickjs-ffi-types": "https://cdn.jsdelivr.net/npm/@jitl/quickjs-ffi-types@0.32.0/dist/index.mjs"
    }
  }
</script>
<script type="module">import "@tinyactors/scxmljs/view";</script>

<scxml-view src="traffic-light.scxml"></scxml-view>
```

- Pin exact versions, and use the dependency versions from the package's `package.json`.
- The package's own files import each other with relative paths, so only the entry points need
  entries.
- An import map is an inline script: under a Content-Security-Policy it needs a hash or nonce in
  `script-src` (see [CSP](csp.md)). To avoid that, host the files yourself.
- CDNs that rewrite imports for you, such as `https://esm.sh/@tinyactors/scxmljs@0.1.0/view`,
  work without the dependency entries.

This map has been tested with the same files served locally, in Chrome. The jsDelivr and esm.sh
URLs will work once the package is published; they haven't been tried yet.

## Classic scripts (no modules)

For pages that can't use modules, build IIFE bundles. Classic scripts have no `import.meta`, which
the sandbox and `<scxml-view>` use to find their base URL, so define it as the page's URL:

<!-- doctest: run files=scxml-view.ts,scxml-global.ts -->
```ts
const results = await Promise.all(
  ["scxml-view.ts", "scxml-global.ts"].map((entry) =>
    Bun.build({
      entrypoints: [entry],
      outdir: "public/vendor",
      format: "iife",
      target: "browser",
      minify: true,
      // classic scripts have no import.meta: give the code the page's URL instead
      define: { "import.meta.url": "document.baseURI" },
    }),
  ),
);
for (const result of results) {
  if (!result.success) throw new AggregateError(result.logs, "build failed");
  for (const output of result.outputs) console.log(output.path.slice(output.path.indexOf("public/")));
}
```

<!-- doctest: output -->
```text
public/vendor/scxml-view.js
public/vendor/scxml-global.js
```

The two entry files: `scxml-view.ts` registers the element,

<!-- doctest: check file=scxml-view.ts -->
```ts
import "@tinyactors/scxmljs/view";
```

and `scxml-global.ts` puts the interpreter on `window.scxml` and registers the explorer:

<!-- doctest: check file=scxml-global.ts -->
```ts
import * as scxml from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/explorer";

Object.assign(globalThis, { scxml });
```

<!-- doctest: html files=traffic-light.scxml -->
```html
<script src="vendor/scxml-view.js"></script>
<script src="vendor/scxml-global.js"></script>

<scxml-view src="traffic-light.scxml"></scxml-view>
<scxml-explorer></scxml-explorer>
<script src="app.js"></script> <!-- scxml.createSession(…), explorer.attach(…) -->
```

With esbuild, the same build is `--format=iife --define:import.meta.url=document.baseURI`.

An IIFE can't load chunks lazily, so `scxml-view.js` contains both engines (about 1.3 MB
minified, 340 KB gzipped). For a smaller page, use modules. `<scxml-explorer>` and the trusted
entry point don't use `import.meta` and can be bundled as-is.

Tested in CI in Chromium, Firefox and WebKit, under both policies from [CSP](csp.md): both
bundles (built from the published files with exactly this recipe), a sandboxed `<scxml-view>`,
and a trusted session in `<scxml-explorer>` (`tests/browser/specs/csp.pw.ts`).

## Support

| Environment | Status | Needs |
|---|---|---|
| Chrome, Edge (Chromium) | tested in CI: Chromium 153 (and Chrome 154 by hand) | Chromium 123 or later (from the features used; older versions aren't tested) |
| Firefox | tested in CI: Firefox 155 | Firefox 120 or later (from the features used) |
| Safari | tested in CI with WebKit 26.6 (Playwright's build, see below) | Safari 17.5 or later (from the features used) |
| Node | tested in CI: 26.10 (and 22.3 by hand) | 22.3 or later (`process.getBuiltinModule`), and a DOMParser such as happy-dom |
| Bun | tested in CI: 1.4 | a DOMParser such as happy-dom |
| Deno | tested in CI: 2.9 | `--allow-read --allow-env --allow-sys`, and a DOMParser such as happy-dom (`npm:happy-dom`) |

What "tested in CI" covers:

- **Browsers** (`tests/browser`, Playwright): both elements with the three playground systems;
  zero-JS `<scxml-view src>` and inline source; the sandboxed engine (WebAssembly) and the trusted
  one (the iframe realm); the explorer's levels, tree keyboard navigation, stepping and sending;
  390px and wide layouts, container queries, light and dark, reduced motion, right-to-left
  pages; the Content-Security-Policies and Trusted Types from [CSP](csp.md); an axe-core audit
  (no violations); and screenshot comparisons. The packed files are loaded through an import
  map, as a plain HTML page would.
- **Runtimes** (`scripts/smoke-tarball.ts`): the packed tarball, installed with `npm install`
  into an empty project, runs a chart through both entry points in Node, Bun and Deno, and a
  bundler builds all four entry points from it.
- **Frameworks**: the [framework examples](frameworks.md) are built and loaded in Chromium.

**Safari:** Playwright's WebKit is the engine Safari uses, built from the same sources, but not
Safari itself (and on Linux in CI). Differences are rare; the package hasn't been tried in a
shipping Safari by hand yet.

The browser minimums come from `light-dark()` in the default theme (the newest feature used),
constructable stylesheets, container queries and `color-mix()`. The sandbox needs WebAssembly;
the trusted entry point needs `eval` in an iframe. See [CSP](csp.md) for both.
