/**
 * Checks every link in the documentation, offline:
 *   - relative links and `#anchors` resolve to existing files and headings;
 *   - absolute links into this repository (config.ts: BLOB, TREE, RAW) are
 *     mapped back to local files and checked the same way;
 *   - the package README (shown on npm, where relative links break) uses
 *     only absolute links;
 *   - package.json's repository URLs match config.ts.
 * Other external URLs are listed but not fetched (CI stays offline).
 *
 *   bun scripts/docs/links.ts          (mise run docs:links)
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { BLOB, DOC_GLOBS, RAW, REPO, TREE } from "./config.ts";
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
for (const file of await markdownFiles(DOC_GLOBS)) {
  const text = await Bun.file(join(ROOT, file)).text();
  for (const { line, url, image } of links(text)) {
    count++;
    const where = `${file}:${line}`;
    if (/^(mailto|tel):/.test(url)) continue;
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

// package.json must point at the same repository
const pkg = await Bun.file(join(ROOT, "packages/scxmljs/package.json")).json();
if (pkg.homepage !== `${REPO}#readme`) problems.push(`packages/scxmljs/package.json: homepage should be ${REPO}#readme`);
if (pkg.repository?.url !== `git+${REPO}.git`) problems.push(`packages/scxmljs/package.json: repository.url should be git+${REPO}.git`);
if (pkg.bugs?.url !== `${REPO}/issues`) problems.push(`packages/scxmljs/package.json: bugs.url should be ${REPO}/issues`);

console.log(`checked ${count} links; ${external.size} distinct external URLs not fetched`);
if (problems.length) {
  console.error(`\n${problems.length} broken link(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("✓ all links resolve");
