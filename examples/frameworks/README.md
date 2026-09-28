# Framework examples

Minimal apps that use `<scxml-view>` and `<scxml-explorer>` the way `docs/frameworks.md` shows,
built with each framework's usual toolchain:

| App | Toolchain |
|---|---|
| `react/` | React 19, bundled with `bun build`, type-checked with `tsc` |
| `vue/` | Vue 3 single-file components, Vite |
| `svelte/` | Svelte 5, Vite |
| `angular/` | Angular 22, the Angular CLI (`@angular/build`) |

Each app is its own project (own `package.json` and lockfile) and depends on the library through
`file:../../../packages/scxmljs`, which resolves to the built `dist/` through the package's
`exports`, like an install from npm. Build the library first (`mise run build`).

`mise run examples:frameworks` installs and builds them; the browser tests
(`tests/browser/specs/frameworks.pw.ts`) load each built app and check that both elements
render, receive their properties and fire their events. Angular's toolchain is heavy, so CI only
builds it with `SCXML_CI_ANGULAR=1`.

Every app renders the same thing: a `<scxml-view>` of `/charts/traffic-light.scxml` (served by the
browser-test server) with a `scxml-load` listener, and a `<scxml-explorer>` for a session the app
creates itself. Each records what happened in `window.__fw` for the tests.
