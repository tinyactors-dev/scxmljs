/**
 * Checks the built website in `_site/` (run `mise run site:build` first):
 *
 *   bun scripts/site/check.ts            (mise run site:check)
 *
 *   - every internal link, script, stylesheet, image and chart resolves to a file in _site/,
 *     and every `#anchor` into one of our pages names an element id on it
 *   - no page, script or stylesheet mentions localhost / 127.0.0.1
 *   - every page (the TypeDoc reference aside) has a <title> and a meta description
 *
 * Offline: external URLs aren't fetched (`mise run docs:links` covers the Markdown sources).
 */
import { join, posix } from "node:path";
import { Glob } from "bun";

const root = new URL("../../", import.meta.url).pathname;
const out = join(root, "_site");
if (!(await Bun.file(join(out, "index.html")).exists())) {
  console.error("site:check: no _site/index.html; run `mise run site:build` first");
  process.exit(1);
}

const files = new Set<string>();
for await (const f of new Glob("**/*").scan({ cwd: out, dot: true })) files.add(f);

const ids = new Map<string, Set<string>>();
const html = new Map<string, string>();
for (const f of files) if (f.endsWith(".html")) html.set(f, await Bun.file(join(out, f)).text());
const idsOf = (f: string) => {
  let s = ids.get(f);
  if (!s) {
    s = new Set([...(html.get(f) ?? "").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    ids.set(f, s);
  }
  return s;
};

/** the file a site path serves (GitHub Pages: directories serve index.html) */
function resolve(path: string): string | undefined {
  const p = decodeURIComponent(path).replace(/^\//, "");
  if (p === "" || p.endsWith("/")) return files.has(`${p}index.html`) ? `${p}index.html` : undefined;
  if (files.has(p)) return p;
  if (files.has(`${p}/index.html`)) return `${p}/index.html`;
  return undefined;
}

const problems: string[] = [];
const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
let links = 0;

for (const [file, text] of html) {
  const api = file.startsWith("api/");
  if (!api) {
    const title = /<title>([^<]*)<\/title>/.exec(text)?.[1]?.trim();
    const description = /<meta name="description" content="([^"]*)"/.exec(text)?.[1]?.trim();
    if (!title) problems.push(`${file}: no <title>`);
    if (!description) problems.push(`${file}: no meta description`);
  }
  // attribute values that point somewhere: href, src (links, scripts, styles, images, media, charts)
  const refs = [...text.matchAll(/<[a-z][^<>]*>/gi)].flatMap((tag) => [...tag[0].matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]!));
  for (const ref of refs) {
    const raw = decodeEntities(ref);
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue; // external (https:, mailto:, data:, …)
    if (raw.startsWith("?")) continue;
    links++;
    const [pathPart, hash] = raw.split("#", 2) as [string, string | undefined];
    const base = posix.dirname(`/${file}`);
    const path = pathPart.split("?")[0]!; // a query string doesn't change which file is served
    const target = path === "" ? file : resolve(path.startsWith("/") ? path : posix.join(base, path));
    if (!target) {
      problems.push(`${file}: broken link ${raw}`);
      continue;
    }
    // anchors are checked into our own pages; TypeDoc's are generated client-side in places.
    // The playground's hash is app state (a shared chart), not an anchor.
    const appState = target === "playground/index.html" && /^(example|chart)=/.test(hash ?? "");
    if (hash && !appState && target.endsWith(".html") && !target.startsWith("api/") && !idsOf(target).has(decodeURIComponent(hash)))
      problems.push(`${file}: no #${hash} on ${target}`);
  }
}

for (const f of files) {
  if (!/\.(html|js|css|xml|txt)$/.test(f) || f.startsWith("pagefind/")) continue;
  const text = html.get(f) ?? (await Bun.file(join(out, f)).text());
  if (/\b(localhost|127\.0\.0\.1)\b/.test(text)) problems.push(`${f}: mentions localhost`);
}

if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`site:check: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`✓ site:check: ${html.size} pages, ${links} internal links and assets, no localhost`);
