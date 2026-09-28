/**
 * Checks every link in the documentation, offline:
 *   - relative links and `#anchors` resolve to existing files and headings;
 *   - absolute links into this repository (config.ts: BLOB, TREE, RAW) are
 *     mapped back to local files and checked the same way;
 *   - the package README (shown on npm, where relative links break) uses
 *     only absolute links;
 *   - package.json's repository URLs match config.ts;
 *   - README media (config.ts: MEDIA, on the `readme-media` branch) is linked only inside the
 *     generated block of the READMEs that have one, as explorer-<hash>.{webm,webp,png}, the same
 *     set everywhere; the files are checked against origin/readme-media when that ref is fetched.
 * Other external URLs are listed but not fetched (CI stays offline).
 *
 *   bun scripts/docs/links.ts          (mise run docs:links)
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { $ } from "bun";
import { BLOB, DOC_GLOBS, MEDIA, MEDIA_BRANCH, MEDIA_END, MEDIA_READMES, MEDIA_START, RAW, REPO, SITE, TREE } from "./config.ts";
import { anchors, links, markdownFiles, ROOT } from "./markdown.ts";

const NPM_README = "packages/scxmljs/README.md";
const problems: string[] = [];
const external = new Set<string>();
const anchorCache = new Map<string, Set<string>>();

async function anchorsOf(file: string) {
  let a = anchorCache.get(file);
  if (!a) {
    a = anchors(await Bun.file(join(ROOT, file)).text());
    anchorCache.set(file, a);
  }
  return a;
}

/** A repository URL → a repository-relative path (or undefined if it isn't one). */
function fromRepoUrl(url: string): string | undefined {
  for (const base of [BLOB, TREE, RAW]) if (url === base || url.startsWith(`${base}/`)) return url.slice(base.length + 1) || ".";
  return undefined;
}

let count = 0;
const mediaSets = new Map<string, Set<string>>(); // README → media hashes it links
for (const file of await markdownFiles(DOC_GLOBS)) {
  const text = await Bun.file(join(ROOT, file)).text();
  const lines = text.split("\n");
  const blockStart = lines.findIndex((l) => l.includes(MEDIA_START)) + 1;
  const blockEnd = lines.findIndex((l) => l.includes(MEDIA_END)) + 1;
  for (const { line, url, image } of links(text)) {
    count++;
    const where = `${file}:${line}`;
    if (/^(mailto|tel):/.test(url)) continue;
    if (url.startsWith(`${MEDIA}/`)) {
      const name = url.slice(MEDIA.length + 1);
      const m = name.match(/^explorer-([0-9a-f]{8})\.(webm|webp|png)$/);
      if (!m) problems.push(`${where}: README media must be explorer-<hash8>.{webm,webp,png}: ${url}`);
      else (mediaSets.get(file) ?? mediaSets.set(file, new Set()).get(file)!).add(m[1]!);
      if (!MEDIA_READMES.includes(file) || line < blockStart || line > blockEnd)
        problems.push(`${where}: README media may only be linked inside the ${MEDIA_START} block (scripts/readme-media writes it)`);
      if (m && (await $`git cat-file -e refs/remotes/origin/${MEDIA_BRANCH}`.cwd(ROOT).quiet().nothrow()).exitCode === 0) {
        const present = await $`git cat-file -e refs/remotes/origin/${MEDIA_BRANCH}:${name}`.cwd(ROOT).quiet().nothrow();
        if (present.exitCode !== 0) problems.push(`${where}: ${name} isn't on origin/${MEDIA_BRANCH}`);
      }
      continue;
    }
    let target: string | undefined;
    let anchor: string | undefined;
    if (/^https?:\/\//.test(url)) {
      const [path, hash] = url.split("#");
      const local = fromRepoUrl(path!);
      if (local === undefined) {
        if (url.startsWith(REPO) && !url.startsWith(`${REPO}#`) && !/\/(issues|security|releases|compare)(\/|$)/.test(url))
          problems.push(`${where}: repository link not under ${BLOB}, ${TREE} or ${RAW}: ${url}`);
        else external.add(url);
        continue;
      }
      if (image && !url.startsWith(RAW)) problems.push(`${where}: images must use ${RAW}/… (npm doesn't render blob URLs): ${url}`);
      target = normalize(local);
      anchor = hash;
    } else if (url.startsWith("#")) {
      target = file;
      anchor = url.slice(1);
    } else {
      if (file === NPM_README) problems.push(`${where}: relative link in the npm README (use ${BLOB}/…): ${url}`);
      const [path, hash] = url.split("#");
      target = normalize(join(dirname(file), decodeURIComponent(path!)));
      anchor = hash;
    }
    if (target.startsWith("..")) {
      problems.push(`${where}: link leaves the repository: ${url}`);
      continue;
    }
    const abs = join(ROOT, target);
    if (!existsSync(abs)) {
      problems.push(`${where}: missing ${relative(ROOT, abs)} (${url})`);
      continue;
    }
    if (anchor && statSync(abs).isFile() && target.endsWith(".md") && !(await anchorsOf(target)).has(decodeURIComponent(anchor)))
      problems.push(`${where}: no heading #${anchor} in ${target}`);
  }
}

// every README with a media block links one and the same set
for (const f of MEDIA_READMES) {
  const text = await Bun.file(join(ROOT, f)).text();
  if (!text.includes(MEDIA_START) || !text.includes(MEDIA_END)) problems.push(`${f}: missing the ${MEDIA_START} … ${MEDIA_END} block`);
}
const sets = new Set([...mediaSets.values()].flatMap((s) => [...s]));
if (sets.size > 1) problems.push(`README media: the READMEs link different sets (${[...sets].join(", ")}); run scripts/readme-media`);

// package.json must point at the website and the same repository
const pkg = await Bun.file(join(ROOT, "packages/scxmljs/package.json")).json();
if (pkg.homepage !== SITE) problems.push(`packages/scxmljs/package.json: homepage should be ${SITE}`);
if (pkg.repository?.url !== `git+${REPO}.git`) problems.push(`packages/scxmljs/package.json: repository.url should be git+${REPO}.git`);
if (pkg.bugs?.url !== `${REPO}/issues`) problems.push(`packages/scxmljs/package.json: bugs.url should be ${REPO}/issues`);

console.log(`checked ${count} links; ${external.size} distinct external URLs not fetched`);
if (problems.length) {
  console.error(`\n${problems.length} broken link(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("✓ all links resolve");
