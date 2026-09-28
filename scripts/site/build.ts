/**
 * Builds https://scxmljs.tinyactors.dev into `_site/` (static files for GitHub Pages):
 *
 *   bun scripts/site/build.ts            (mise run site:build)
 *
 *   /                      landing page (a live <scxml-view>, the explorer tour, features)
 *   /demos/                demos index · /demos/explorer/ · /demos/gallery/
 *   /playground/           the live editor (placeholder until site phase 2)
 *   /docs/…                docs/*.md, SECURITY.md, CHANGELOG.md rendered (sidebar, TOC, pager)
 *   /api/                  the TypeDoc reference (`mise run docs:api`; built here if missing)
 *   /search/               Pagefind UI over the build-time index in /pagefind/
 *   /charts/*.scxml        every chart the pages load
 *   404.html, sitemap.xml, robots.txt, CNAME, .nojekyll, favicon.svg, og.png
 *
 * The client scripts are bundled from source (the repository's `@tinyactors/scxmljs` path
 * mapping), minified, with content-hashed names under /assets/.
 */
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { $, Glob } from "bun";
import { Window } from "happy-dom";
import { compile, parseSCXML } from "../../packages/scxmljs/src/trusted.ts";
import { type DocPage, GROUPS, pager, renderMarkdown, sidebar, sitePath, tocHtml } from "../../site/src/docs.ts";
import { type Assets, page, type Section } from "../../site/src/layout.ts";
import * as pages from "../../site/src/pages.ts";
import { MEDIA, MEDIA_END, MEDIA_START, SITE } from "../docs/config.ts";

const root = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const out = join(root, "_site");
const started = performance.now();
const log = (msg: string) => console.log(`  ${msg}`);

// ── version shown in the footer ───────────────────────────────────────────
const pkg = await Bun.file(join(root, "packages/scxmljs/package.json")).json();
const commit = (await $`git rev-parse HEAD`.cwd(root).quiet().nothrow().text()).trim() || "unknown";
const version = process.env.SITE_VERSION ?? pkg.version;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// ── client bundles ────────────────────────────────────────────────────────
const entries = ["common", "landing", "gallery", "explorer", "search"].map((n) => join(root, "site/client", `${n}.ts`));
const bundle = await Bun.build({
  entrypoints: [...entries, join(root, "site/styles/site.css")],
  outdir: join(out, "assets"),
  target: "browser",
  format: "esm",
  splitting: true,
  minify: true,
  naming: { entry: "[name]-[hash].[ext]", chunk: "chunk-[hash].[ext]", asset: "[name]-[hash].[ext]" },
});
if (!bundle.success) {
  for (const m of bundle.logs) console.error(m);
  throw new Error("site: bundling failed");
}
const assets: Assets = { js: {}, css: "" };
for (const o of bundle.outputs) {
  const file = basename(o.path);
  const url = `/assets/${file}`;
  // the stylesheet entry isn't reported as kind "entry-point": match it by name
  if (/^site-[a-z0-9]+\.css$/.test(file)) assets.css = url;
  else if (o.kind === "entry-point" && file.endsWith(".js")) assets.js[file.replace(/-[a-z0-9]+\.js$/, "")] = url;
}
if (!assets.css) throw new Error("site: no stylesheet in the bundle");
log(`bundled ${bundle.outputs.length} files`);

// ── fonts: self-hosted woff2 (Bun's CSS bundler would inline them as data: URIs) ──
const FONTS: [family: string, pkg: string, weight: number, style: "normal" | "italic"][] = [
  ["IBM Plex Sans", "ibm-plex-sans", 400, "normal"],
  ["IBM Plex Sans", "ibm-plex-sans", 500, "normal"],
  ["IBM Plex Sans", "ibm-plex-sans", 600, "normal"],
  ["IBM Plex Mono", "ibm-plex-mono", 400, "normal"],
  ["IBM Plex Mono", "ibm-plex-mono", 500, "normal"],
  ["Newsreader", "newsreader", 400, "normal"],
  ["Newsreader", "newsreader", 400, "italic"],
];
await mkdir(join(out, "fonts"), { recursive: true });
const faces: string[] = [];
for (const [family, pkgName, weight, style] of FONTS) {
  const file = `${pkgName}-latin-${weight}-${style}.woff2`;
  await cp(join(root, "node_modules/@fontsource", pkgName, "files", file), join(out, "fonts", file));
  faces.push(
    `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:swap;src:url(/fonts/${file}) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`,
  );
}
await Bun.write(join(out, "fonts/fonts.css"), `${faces.join("\n")}\n`);
assets.fonts = "/fonts/fonts.css";

// ── pages ─────────────────────────────────────────────────────────────────
const written: { path: string; noindex?: boolean }[] = [];
async function write(path: string, html: string, noindex = false) {
  const file = path.endsWith("/") ? join(out, path, "index.html") : join(out, path);
  await Bun.write(file, html);
  written.push({ path, noindex });
}
const common = { assets, version, commit };
const emit = (
  path: string,
  section: Section,
  title: string,
  description: string,
  body: string,
  extra: Partial<Parameters<typeof page>[0]> = {},
) => write(path, page({ path, section, title, description, body, ...common, ...extra }), extra.noindex);

// README media (the explorer tour), from the block scripts/readme-media maintains
const readme = await Bun.file(join(root, "README.md")).text();
const block = readme.slice(readme.indexOf(MEDIA_START), readme.indexOf(MEDIA_END));
const hash = new RegExp(`${MEDIA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/explorer-([0-9a-f]{8})\\.webp`).exec(block)?.[1];
const media = hash
  ? { webp: `${MEDIA}/explorer-${hash}.webp`, png: `${MEDIA}/explorer-${hash}.png`, webm: `${MEDIA}/explorer-${hash}.webm` }
  : undefined;
if (!media) console.warn("  ! no README media block found: the landing page has no explorer tour");

await emit(
  "/",
  "home",
  "scxmljs — SCXML statecharts you can run, see and step through",
  "A correctness-first SCXML 1.0 interpreter (160/160 W3C tests) with custom elements that render and step through running statecharts in any framework.",
  pages.landing(media),
  { scripts: ["landing"] },
);
await emit(
  "/demos/",
  "demos",
  "Demos",
  "Live demos of scxmljs: the explorer on three sample systems and a gallery of classic statecharts.",
  pages.demosIndex(),
);
const { samples } = await import("../../examples/playground/src/explorer/samples.ts");
await emit(
  "/demos/explorer/",
  "demos",
  "Explorer demo",
  "<scxml-explorer> on three running systems: an order pipeline with invoked machines, a 333-state support desk, and a GitHub gatekeeper.",
  pages.explorerDemo(samples.map((s: { id: string; title: string }) => ({ id: s.id, title: s.title }))),
  { scripts: ["explorer"] },
);
await emit(
  "/demos/gallery/",
  "demos",
  "Chart gallery",
  "Classic statecharts drawn and run by <scxml-view>: parallel regions, history, delayed events and guards.",
  pages.gallery(),
  { scripts: ["gallery"] },
);
await emit(
  "/playground/",
  "playground",
  "Playground",
  "Edit an SCXML statechart and watch it run in the sandboxed engine (coming soon).",
  pages.playground(),
);
await emit("/search/", "search", "Search", "Search the scxmljs documentation.", pages.search(), {
  scripts: ["search"],
  noindex: true,
  head: '<link rel="stylesheet" href="/pagefind/pagefind-ui.css">\n<script src="/pagefind/pagefind-ui.js"></script>\n',
});
await emit("/404.html", "none", "Not found", "This page doesn't exist.", pages.notFound(), { noindex: true });

// ── docs ──────────────────────────────────────────────────────────────────
const docFiles = GROUPS.flatMap((g) => g.items.filter((i) => i.file).map((i) => ({ file: i.file!, group: g.name })));
const sources = new Map<string, string>();
const docPages = new Map<string, DocPage>();
for (const { file, group } of docFiles) {
  const text = await Bun.file(join(root, file)).text();
  sources.set(file, text);
  const title = /^#\s+(.*)$/m.exec(text)?.[1]?.replace(/`/g, "") ?? file;
  docPages.set(file, { file, path: sitePath(file)!, title, group });
}
// every docs/*.md must be in the sidebar (a new guide shouldn't silently be missing from the site)
for await (const f of new Glob("docs/*.md").scan({ cwd: root }))
  if (!docPages.has(f)) throw new Error(`site: ${f} isn't in the sidebar (site/src/docs.ts GROUPS)`);
const images = new Set<string>();
for (const [file, p] of docPages) {
  const r = await renderMarkdown(file, sources.get(file)!, images);
  const body = `<div class="docs">
${sidebar(p.path, docPages)}
<article class="prose" data-pagefind-body>
${r.html}
${pager(p.path, docPages)}
</article>
${tocHtml(r, file)}
</div>`;
  await emit(p.path, "docs", r.title, r.description || `${r.title} — scxmljs documentation.`, body);
}
for (const img of images) await cp(join(root, img), join(out, img));
log(`rendered ${docPages.size} documentation pages`);

// ── charts ────────────────────────────────────────────────────────────────
await mkdir(join(out, "charts"), { recursive: true });
const chartDirs = ["examples/playground/charts", "docs/examples", "site/charts"];
const domParser = new new Window().DOMParser() as unknown as DOMParser;
for (const dir of chartDirs)
  for (const f of await readdir(join(root, dir))) if (f.endsWith(".scxml")) await cp(join(root, dir, f), join(out, "charts", f));
// the gallery charts must compile without warnings
for (const c of pages.GALLERY) {
  const model = await compile(parseSCXML(await Bun.file(join(out, "charts", c.file)).text(), domParser));
  if (model.warnings.length) throw new Error(`site: ${c.file} has warnings: ${model.warnings.map((w) => w.code).join(", ")}`);
}

// ── API reference ─────────────────────────────────────────────────────────
if (!(await Bun.file(join(root, "docs/api/index.html")).exists())) {
  log("building the API reference (mise run docs:api)");
  await $`mise run docs:api`.cwd(root).quiet();
}
await cp(join(root, "docs/api"), join(out, "api"), { recursive: true });

// ── static files ──────────────────────────────────────────────────────────
for (const f of await readdir(join(root, "site/public"))) await cp(join(root, "site/public", f), join(out, f), { recursive: true });
await Bun.write(join(out, "CNAME"), `${new URL(SITE).host}\n`);
await Bun.write(join(out, ".nojekyll"), "");
await Bun.write(join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
const urls = [...written.filter((w) => !w.noindex).map((w) => w.path), "/api/"];
await Bun.write(
  join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join("\n")}\n</urlset>\n`,
);

// ── search index ──────────────────────────────────────────────────────────
const pagefind = await import("pagefind");
const { index } = await pagefind.createIndex({});
if (!index) throw new Error("site: pagefind failed to start");
const added = await index.addDirectory({ path: out });
if (added.errors.length) throw new Error(`site: pagefind: ${added.errors.join("; ")}`);
await index.writeFiles({ outputPath: join(out, "pagefind") });
await pagefind.close();
log(`search index: ${added.page_count} pages`);

console.log(`✓ site built in ${((performance.now() - started) / 1000).toFixed(1)}s → _site/ (${written.length} pages, version ${version})`);
