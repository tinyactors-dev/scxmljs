/**
 * The documentation pages: `docs/*.md` (plus SECURITY.md and CHANGELOG.md) rendered to HTML with
 * build-time highlighting, GitHub-compatible heading anchors (so every existing `#anchor` link
 * keeps working), repository links rewritten to site routes, a sidebar and an on-page TOC.
 */
import { dirname, join, normalize } from "node:path";
import { Marked, type Tokens } from "marked";
import { createHighlighter, type Highlighter } from "shiki";
import { BLOB, BRANCH, REPO, SITE, TREE } from "../../scripts/docs/config.ts";
import { slug } from "../../scripts/docs/markdown.ts";
import { esc } from "./layout.ts";

export interface DocPage {
  /** repository path of the Markdown source, e.g. "docs/testing.md" */
  file: string;
  /** site path, e.g. "/docs/testing/" */
  path: string;
  title: string;
  group: string;
}

/** Sidebar groups, in order. `file` null = an external entry (the API reference). */
export const GROUPS: { name: string; items: { file: string | null; label?: string; href?: string }[] }[] = [
  {
    name: "Start",
    items: [
      { file: "docs/README.md", label: "Overview" },
      { file: "docs/getting-started.md" },
      { file: "docs/sandboxed-vs-trusted.md" },
      { file: "docs/driving-charts.md" },
      { file: "docs/playback.md" },
      { file: "docs/testing.md" },
    ],
  },
  {
    name: "Elements",
    items: [
      { file: "docs/view.md" },
      { file: "docs/explorer.md" },
      { file: "docs/theming.md" },
      { file: "docs/custom-ui.md" },
      { file: "docs/frameworks.md" },
      { file: "docs/large-charts.md" },
    ],
  },
  {
    name: "Interpreter",
    items: [{ file: "docs/io-processors.md" }, { file: "docs/invokers.md" }, { file: "docs/node-and-servers.md" }],
  },
  {
    name: "Operations",
    items: [{ file: "docs/bundling.md" }, { file: "docs/csp.md" }, { file: "SECURITY.md" }],
  },
  {
    name: "Reference",
    items: [
      { file: "docs/conformance.md" },
      { file: "docs/deviations.md" },
      { file: "docs/measurements.md" },
      { file: "CHANGELOG.md" },
      { file: null, label: "API reference", href: "/api/" },
    ],
  },
];

/** Repository path → site path for every documentation page. */
export function sitePath(file: string): string | undefined {
  if (file === "docs/README.md") return "/docs/";
  if (file === "SECURITY.md") return "/docs/security/";
  if (file === "CHANGELOG.md") return "/docs/changelog/";
  const m = /^docs\/([\w-]+)\.md$/.exec(file);
  return m ? `/docs/${m[1]}/` : undefined;
}

const LANGS = ["ts", "tsx", "js", "jsx", "html", "xml", "css", "sh", "json", "svelte", "vue", "yaml", "toml"];

let highlighter: Promise<Highlighter> | undefined;
function getHighlighter() {
  highlighter ??= createHighlighter({ themes: ["github-light-default", "github-dark-default"], langs: LANGS });
  return highlighter;
}

export interface Rendered {
  html: string;
  title: string;
  description: string;
  toc: { depth: number; id: string; text: string }[];
}

/**
 * Where a link in `file` should point on the site: documentation pages → their routes, images →
 * copied files, other repository files → GitHub.
 */
export function rewriteHref(href: string, file: string, images: Set<string>): string {
  if (/^(mailto:|#|\/)/.test(href)) return href; // anchors and site paths are final
  if (href === SITE || href.startsWith(`${SITE}/`)) return href.slice(SITE.length) || "/"; // links to this site
  let target: string;
  let hash = "";
  if (/^https?:/.test(href)) {
    const prefix = [`${BLOB}/`, `${TREE}/`].find((p) => href.startsWith(p));
    if (!prefix) return href;
    target = href.slice(prefix.length);
  } else target = normalize(join(dirname(file), href));
  const i = target.indexOf("#");
  if (i >= 0) {
    hash = target.slice(i);
    target = target.slice(0, i);
  }
  target = target.replace(/\/$/, "");
  const route = sitePath(target);
  if (route) return route + hash;
  if (target.startsWith("docs/images/")) {
    images.add(target);
    return `/${target}`;
  }
  if (target === "docs/api" || target.startsWith("docs/api/")) return "/api/";
  // anything else lives in the repository
  const isDir = !/\.[a-z0-9]+$/i.test(target);
  return `${isDir ? TREE : BLOB}/${target}${hash}`;
}

export async function renderMarkdown(file: string, source: string, images: Set<string>): Promise<Rendered> {
  const hl = await getHighlighter();
  const seen = new Map<string, number>();
  const toc: Rendered["toc"] = [];
  let title = "";
  let description = "";
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, { tokens, depth, text }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        const base = slug(text);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        const plain = inner.replace(/<[^>]+>/g, "");
        if (depth === 1 && !title) title = decodeEntities(plain);
        if (depth === 2 || depth === 3) toc.push({ depth, id, text: plain });
        const anchor = depth > 1 ? `<a class="anchor" href="#${id}" aria-label="Link to this section" data-pagefind-ignore>#</a>` : "";
        return `<h${depth} id="${id}">${inner}${anchor}</h${depth}>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        const l = (lang ?? "").split(/\s/)[0]!.toLowerCase();
        const language = l === "scxml" ? "xml" : l === "bash" || l === "shell" ? "sh" : LANGS.includes(l) ? l : "text";
        return hl.codeToHtml(text.replace(/\n$/, ""), {
          lang: language,
          themes: { light: "github-light-default", dark: "github-dark-default" },
          defaultColor: false,
          // comments are too faint on the site's code background: darken to WCAG AA
          colorReplacements: { "github-light-default": { "#6e7781": "#57606a" } },
        });
      },
      html({ text }: Tokens.HTML | Tokens.Tag) {
        // the doc-test directives are comments; drop them (and any other comment) from the output
        return text.replace(/<!--[\s\S]*?-->\s*/g, "");
      },
      paragraph(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, { tokens }: Tokens.Paragraph) {
        const inner = this.parser.parseInline(tokens);
        if (!description)
          description = decodeEntities(inner.replace(/<[^>]+>/g, ""))
            .replace(/\s+/g, " ")
            .trim();
        return `<p>${inner}</p>\n`;
      },
    },
    walkTokens(token) {
      if (token.type === "link" || token.type === "image") token.href = rewriteHref(token.href, file, images);
    },
  });
  let html = await marked.parse(source);
  // an empty header cell (a column of values without a heading) isn't a header
  html = html.replace(/<th( align="\w+")?>\s*<\/th>/g, "<td$1></td>");
  // raw HTML in the Markdown (e.g. <a href>, <img src>) gets the same rewriting
  html = html.replace(
    /(<(?:a|img|source)\s[^>]*?\s(?:href|src))="([^"]+)"/g,
    (_, pre: string, url: string) => `${pre}="${rewriteHref(url, file, images)}"`,
  );
  if (description.length > 200) description = `${description.slice(0, 197).replace(/\s+\S*$/, "")}…`;
  return { html, title: title || file, description, toc };
}

function decodeEntities(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function sidebar(current: string, pages: Map<string, DocPage>): string {
  return `<nav class="docs-nav" aria-label="Documentation">
  <button class="icon-button docs-nav-toggle" type="button" aria-expanded="false">Documentation menu</button>
  <div class="groups">
${GROUPS.map(
  (g) => `    <h2>${g.name}</h2>
    <ul>
${g.items
  .map((item) => {
    if (!item.file) return `      <li><a href="${item.href}">${esc(item.label!)}</a></li>`;
    const p = pages.get(item.file);
    if (!p) throw new Error(`sidebar: unknown page ${item.file}`);
    return `      <li><a href="${p.path}"${p.path === current ? ' aria-current="page"' : ""}>${esc(item.label ?? p.title)}</a></li>`;
  })
  .join("\n")}
    </ul>`,
).join("\n")}
  </div>
</nav>`;
}

export function tocHtml(r: Rendered, file: string): string {
  const edit = `${REPO}/edit/${BRANCH}/${file}`;
  if (!r.toc.length) return `<aside class="toc"><a class="edit" href="${edit}">Edit this page on GitHub</a></aside>`;
  return `<aside class="toc" aria-label="On this page">
  <h2>On this page</h2>
  <ul>
${r.toc.map((t) => `    <li class="depth-${t.depth}"><a href="#${t.id}">${t.text}</a></li>`).join("\n")}
  </ul>
  <a class="edit" href="${edit}">Edit this page on GitHub</a>
</aside>`;
}

/** Previous/next links in sidebar order (documentation pages only). */
export function pager(current: string, pages: Map<string, DocPage>): string {
  const order = GROUPS.flatMap((g) => g.items.filter((i) => i.file).map((i) => pages.get(i.file!)!));
  const i = order.findIndex((p) => p.path === current);
  const prev = order[i - 1];
  const next = order[i + 1];
  if (!prev && !next) return "";
  return `<nav class="pager" aria-label="Previous and next page">
${prev ? `  <a class="prev" href="${prev.path}"><small>Previous</small>${esc(prev.title)}</a>` : ""}
${next ? `  <a class="next" href="${next.path}"><small>Next</small>${esc(next.title)}</a>` : ""}
</nav>`;
}
