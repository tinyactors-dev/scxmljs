/**
 * Test server for the browser tests (Playwright starts it; see playwright.config.ts).
 *
 *   /explorer, /element     the playground pages (bundled from the library sources)
 *   /fixtures/<name>.html   test pages that load the BUILT package (packages/scxmljs/dist) through an
 *                           import map — the way a plain HTML page would use the published files.
 *                           `?csp=sandboxed|trusted|tt` serves them under a Content-Security-Policy.
 *   /dist/*, /modules/*     the built package and its QuickJS dependencies (for the import map)
 *   /charts/*.scxml         charts from the playground and docs/examples
 *   /fw/<name>/*            built framework example apps (examples/frameworks/<name>/dist)
 *   /iife/<name>.js         classic-script (IIFE) bundles of fixtures/iife/<name>.entry.js, built from
 *                           dist/ with the recipe docs/bundling.md gives (define import.meta.url)
 */
import { createHash } from "node:crypto";
import { dirname, join, normalize } from "node:path";
import element from "../../examples/playground/web/element.html";
import explorer from "../../examples/playground/web/explorer.html";

const root = join(import.meta.dir, "../..");
const port = Number(process.env.PORT ?? 4390);
const pkgDir = join(root, "packages/scxmljs");

/** Directory of an installed dependency, resolved the way the package's own imports resolve. */
const depDir = (name: string, from = pkgDir) => dirname(Bun.resolveSync(`${name}/package.json`, from));
const core = depDir("quickjs-emscripten-core");
const MODULES: Record<string, string> = {
  "quickjs-emscripten-core": core,
  "@jitl/quickjs-singlefile-browser-release-sync": depDir("@jitl/quickjs-singlefile-browser-release-sync"),
  "@jitl/quickjs-ffi-types": depDir("@jitl/quickjs-ffi-types", core),
};

const IMPORT_MAP = JSON.stringify(
  {
    imports: {
      "@tinyactors/scxmljs": "/dist/index.js",
      "@tinyactors/scxmljs/trusted": "/dist/trusted.js",
      "@tinyactors/scxmljs/view": "/dist/view.js",
      "@tinyactors/scxmljs/explorer": "/dist/explorer.js",
      "quickjs-emscripten-core": "/modules/quickjs-emscripten-core/dist/index.mjs",
      "@jitl/quickjs-singlefile-browser-release-sync": "/modules/@jitl/quickjs-singlefile-browser-release-sync/dist/index.mjs",
      "@jitl/quickjs-ffi-types": "/modules/@jitl/quickjs-ffi-types/dist/index.mjs",
    },
  },
  null,
  2,
);
const IMPORT_MAP_HASH = `'sha256-${createHash("sha256").update(IMPORT_MAP).digest("base64")}'`;

/** The policies the CSP tests run under (docs/csp.md documents exactly these). */
const CSP: Record<string, string> = {
  sandboxed: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${IMPORT_MAP_HASH}; style-src 'self'`,
  trusted: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' ${IMPORT_MAP_HASH}; style-src 'self'`,
  tt: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${IMPORT_MAP_HASH}; style-src 'self'; require-trusted-types-for 'script'; trusted-types scxml`,
};

const type = (path: string) =>
  path.endsWith(".js") || path.endsWith(".mjs")
    ? "text/javascript; charset=utf-8"
    : path.endsWith(".scxml")
      ? "application/xml; charset=utf-8"
      : path.endsWith(".css")
        ? "text/css; charset=utf-8"
        : path.endsWith(".html")
          ? "text/html; charset=utf-8"
          : path.endsWith(".map")
            ? "application/json"
            : "application/octet-stream";

/** IIFE bundles, built once per server run (docs/bundling.md, "Classic scripts"). */
const iifeCache = new Map<string, Promise<Response>>();
async function buildIife(name: string): Promise<Response> {
  const entry = join(import.meta.dir, "fixtures/iife", `${name}.entry.js`);
  if (!/^[\w-]+$/.test(name) || !(await Bun.file(entry).exists())) return new Response("not found", { status: 404 });
  const result = await Bun.build({
    entrypoints: [entry],
    format: "iife",
    target: "browser",
    minify: true,
    define: { "import.meta.url": "document.baseURI" },
  });
  if (!result.success) return new Response(result.logs.join("\n"), { status: 500 });
  return new Response(await result.outputs[0]!.text(), { headers: { "content-type": "text/javascript; charset=utf-8" } });
}

/** Serve a file from `base`, refusing paths that escape it. */
async function file(base: string, rel: string, headers: Record<string, string> = {}) {
  const path = normalize(join(base, rel));
  if (!path.startsWith(base)) return new Response("forbidden", { status: 403 });
  const f = Bun.file(path);
  if (!(await f.exists())) return new Response("not found", { status: 404 });
  return new Response(f, { headers: { "content-type": type(path), "cache-control": "no-store", ...headers } });
}

const server = Bun.serve({
  port,
  development: false,
  routes: {
    "/explorer": explorer,
    "/element": element,
  },
  async fetch(req) {
    const url = new URL(req.url);
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith("/fixtures/")) {
      const rel = p.slice("/fixtures/".length);
      if (!rel.endsWith(".html")) return file(join(import.meta.dir, "fixtures"), rel);
      const f = Bun.file(join(import.meta.dir, "fixtures", rel));
      if (!(await f.exists())) return new Response("not found", { status: 404 });
      const html = (await f.text()).replace("<!--importmap-->", `<script type="importmap">${IMPORT_MAP}</script>`);
      const csp = CSP[url.searchParams.get("csp") ?? ""];
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          ...(csp ? { "content-security-policy": csp } : {}),
        },
      });
    }
    if (p.startsWith("/dist/")) return file(join(pkgDir, "dist"), p.slice(6));
    if (p.startsWith("/iife/") && p.endsWith(".js")) {
      const name = p.slice(6, -3);
      if (!iifeCache.has(name)) iifeCache.set(name, buildIife(name));
      return (await iifeCache.get(name)!).clone();
    }
    if (p.startsWith("/modules/")) {
      const rest = p.slice(9);
      const name = Object.keys(MODULES).find((m) => rest.startsWith(`${m}/`));
      return name ? file(MODULES[name]!, rest.slice(name.length + 1)) : new Response("not found", { status: 404 });
    }
    if (p.startsWith("/charts/")) {
      const name = p.slice(8);
      const fromPlayground = await file(join(root, "examples/playground/charts"), name);
      return fromPlayground.ok ? fromPlayground : file(join(root, "docs/examples"), name);
    }
    if (p.startsWith("/fw/")) {
      const [, , name, ...rest] = p.split("/");
      const rel = rest.join("/") || "index.html";
      const res = await file(join(root, "examples/frameworks", name ?? "", "dist"), rel);
      return res.ok ? res : file(join(root, "examples/frameworks", name ?? "", "dist"), "index.html");
    }
    if (p === "/") return new Response("scxmljs browser-test server");
    return new Response("not found", { status: 404 });
  },
});

console.log(`browser-test server on ${server.url}`);
