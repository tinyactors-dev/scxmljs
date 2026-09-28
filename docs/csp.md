# Content-Security-Policy

The package works under a strict Content-Security-Policy. What `script-src` must allow depends on
the entry point; styles need nothing special.

| You use | `script-src` needs | Why |
|---|---|---|
| `@tinyactors/scxmljs` (sandboxed), or `<scxml-view>` without `trusted` | `'wasm-unsafe-eval'` | QuickJS is WebAssembly, compiled at run time |
| `@tinyactors/scxmljs/trusted`, or `<scxml-view trusted>` | `'unsafe-eval'` | chart code runs with `eval` in a hidden iframe |
| only `<scxml-explorer>` with a session you created | whatever that session's entry point needs | the explorer itself evaluates nothing |

`'wasm-unsafe-eval'` only allows compiling WebAssembly; it doesn't allow `eval()` of JavaScript.
It's the smaller permission, which is one more reason to prefer the sandbox.

A policy for a page that uses `<scxml-view>` with sandboxed charts, served from the same origin:

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'
```

And one that also runs trusted sessions:

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; style-src 'self'
```

Both are tested in CI in Chromium, Firefox and WebKit (`tests/browser/specs/csp.pw.ts`, with
these exact policies plus the import map's hash): under the first, sandboxed `<scxml-view>` and
`<scxml-explorer>` work with no violations and a trusted `<scxml-view>` is refused (its `eval`
is the only violation); under the second, everything works with no violations. The same two
checks run against the classic-script (IIFE) bundles from [Bundling](bundling.md#classic-scripts-no-modules).

## The other directives

- **Styles.** `style-src 'self'` is enough; `'unsafe-inline'` isn't needed. The elements style
  themselves with constructable stylesheets adopted by their shadow roots, and position things
  through the CSSOM (`element.style`), neither of which `style-src` restricts. They never write
  `style` attributes or inline `<style>` elements. If you link `themes/tinyactors.css` from
  another origin, allow that origin.
- **Fetching charts.** `<scxml-view src>`, and the loader it uses for `<script src>`,
  `<data src>` and `<invoke src>`, use `fetch()`: the URLs must be allowed by `connect-src`
  (`default-src 'self'` covers same-origin charts). Your own I/O processors need whatever their
  transport needs.
- **Frames.** The trusted data model creates a same-origin `about:blank` iframe, which `frame-src`
  doesn't block.
- **Nothing else.** No fonts, images, workers or `.wasm` files are loaded: QuickJS is embedded in
  the JavaScript.
- **Import maps** are inline scripts. If you load the package through an
  [import map](bundling.md#from-a-cdn-with-an-import-map), allow it with a hash
  (`'sha256-…'` of the map's text) or a nonce in `script-src`, and allow the CDN's origin.

## Trusted Types

With `require-trusted-types-for 'script'`, the browser refuses strings where it expects HTML or
scripts:

- **The elements** build all their DOM with `createElement` and never parse HTML, so they work
  unchanged.
- **Parsing SCXML text** uses `DOMParser.parseFromString`, which then needs `TrustedHTML`. Pass a
  `domParser` that wraps the text with your own policy. It goes into `createSession()`, or into
  `<scxml-view>`'s `options` (set it before `src`):

<!-- doctest: check -->
```ts
import { createSession } from "@tinyactors/scxmljs";

// the Trusted Types API (types: @types/trusted-types)
declare const trustedTypes: { createPolicy(name: string, rules: { createHTML(s: string): string }): { createHTML(s: string): string } };

const policy = trustedTypes.createPolicy("scxml", { createHTML: (text) => text });
const domParser = {
  parseFromString: (text: string, type: string) => new DOMParser().parseFromString(policy.createHTML(text), type as DOMParserSupportedType),
};

const session = await createSession(await (await fetch("chart.scxml")).text(), { domParser });
document.querySelector("scxml-view")!.options = { domParser };
```

  If your policy also uses `trusted-types <names>`, include your policy's name.
- **The trusted data model** evaluates chart code with `eval`, which Trusted Types blocks (it
  would need `TrustedScript`). Use the sandboxed entry point on such pages.

Tested in CI in Chromium, Firefox and WebKit, which all enforce Trusted Types: a sandboxed
`<scxml-view>` with this `domParser` and `<scxml-explorer>` (with a screenshot of its focus pane),
no violations and no errors.
