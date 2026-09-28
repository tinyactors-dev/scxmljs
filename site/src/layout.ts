/**
 * The HTML shell every page of scxmljs.tinyactors.dev shares: head (meta, Open Graph, canonical,
 * theme bootstrap), header with navigation, search and theme toggle, footer.
 */
import { REPO, SITE } from "../../scripts/docs/config.ts";

export interface Assets {
  /** hashed URLs of the bundled client entries, by entry name (e.g. "common", "landing") */
  js: Record<string, string>;
  css: string;
  /** the @font-face rules for the self-hosted fonts */
  fonts?: string;
}

export type Section = "home" | "docs" | "demos" | "playground" | "api" | "search" | "none";

export interface PageOptions {
  /** site path, starting and ending with "/" (or a file like "/404.html") */
  path: string;
  title: string;
  description: string;
  section: Section;
  body: string;
  assets: Assets;
  /** client entries to load besides "common" */
  scripts?: string[];
  /** extra markup for <head> */
  head?: string;
  /** don't index in search (Pagefind) or sitemaps */
  noindex?: boolean;
  version: string;
  commit: string;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const NAV: [Section, string, string][] = [
  ["docs", "Docs", "/docs/"],
  ["demos", "Demos", "/demos/"],
  ["playground", "Playground", "/playground/"],
  ["api", "API", "/api/"],
];

// runs before first paint: no flash of the wrong theme
const THEME_BOOT = `(function(){var r=document.documentElement,s=null;try{s=localStorage.getItem("theme")}catch(e){}r.setAttribute("data-theme",s||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"))})();`;

export function page(o: PageOptions): string {
  const title = o.section === "home" ? o.title : `${o.title} · scxmljs`;
  const canonical = `${SITE}${o.path.replace(/index\.html$/, "")}`;
  const scripts = ["common", ...(o.scripts ?? [])].map((name) => {
    const src = o.assets.js[name];
    if (!src) throw new Error(`no client bundle "${name}"`);
    return `<script type="module" src="${src}"></script>`;
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="scxmljs">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#F4EEE2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#18120D" media="(prefers-color-scheme: dark)">
${o.noindex ? '<meta name="robots" content="noindex">\n' : ""}<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${o.assets.fonts ? `<link rel="stylesheet" href="${o.assets.fonts}">\n` : ""}<link rel="stylesheet" href="${o.assets.css}">
<script>${THEME_BOOT}</script>
${o.head ?? ""}${scripts.join("\n")}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="inner">
    <a class="brand" href="/">scxmljs <small>by tinyactors</small></a>
    <nav class="site-nav" id="site-nav" aria-label="Main">
${NAV.map(([sec, label, href]) => `      <a href="${href}"${sec === o.section ? ' aria-current="page"' : ""}>${label}</a>`).join("\n")}
      <a href="${REPO}">GitHub</a>
    </nav>
    <div class="header-tools">
      <form class="search-form" role="search" action="/search/" method="get">
        <label class="visually-hidden" for="site-search">Search the docs</label>
        <input id="site-search" type="search" name="q" placeholder="Search docs…" autocomplete="off">
      </form>
      <button class="icon-button theme-toggle" type="button" aria-label="Switch between light and dark">◐</button>
      <button class="icon-button menu-button" type="button" aria-controls="site-nav" aria-expanded="false" aria-label="Menu">☰</button>
    </div>
  </div>
</header>
<main id="main">
${o.body}
</main>
<footer class="site-footer">
  <div class="inner">
    <span>@tinyactors/scxmljs ${esc(o.version)} · MIT licence · <a href="${REPO}/commit/${o.commit}">${o.commit.slice(0, 7)}</a></span>
    <span><a href="https://www.npmjs.com/package/@tinyactors/scxmljs">npm</a> · <a href="${REPO}">GitHub</a> · <a href="/docs/security/">Security</a> · <a href="/docs/changelog/">Changelog</a></span>
  </div>
</footer>
</body>
</html>
`;
}
