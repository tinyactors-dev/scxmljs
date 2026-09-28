/**
 * Checks every link in the documentation, offline:
 *   - relative links and `#anchors` resolve to existing files and headings;
 *   - absolute links into this repository (config.ts: BLOB, TREE, RAW) are
 *     mapped back to local files and checked the same way;
 *   - the package README (shown on npm, where relative links break) uses
 *     only absolute links;
 *   - package.json's repository URLs match config.ts;
 *   - media (config.ts: MEDIA, the `readme-media` branch) are linked as <name>-<hash8>.<ext>, with a
 *     name and format from docs/media.json and the hash from docs/media.lock.json (scripts/media
 *     keeps them current), and each file must exist on the branch (fetched first; offline, the
 *     local ref is used if there is one). Nothing links docs/images/ (frozen: only old npm READMEs use it).
 * Other external URLs are listed but not fetched (CI stays offline).
 *
 *   bun scripts/docs/links.ts          (mise run docs:links)
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { $ } from "bun";
import { BLOB, DOC_GLOBS, MEDIA, MEDIA_BRANCH, RAW, REPO, SITE, TREE } from "./config.ts";
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

const mediaSpec: { media: { name: string; formats: string[] }[] } = await Bun.file(join(ROOT, "docs/media.json")).json();
const mediaLock: Record<string, { hash: string }> = await Bun.file(join(ROOT, "docs/media.lock.json")).json();
// the media files must exist on the branch: fetch its head (the one network access here; a stale
// local ref would report files the media workflow has just pushed as missing)
const fetched = await $`git fetch --quiet --depth=1 origin +refs/heads/${MEDIA_BRANCH}:refs/remotes/origin/${MEDIA_BRANCH}`
  .cwd(ROOT)
  .quiet()
  .nothrow();
const mediaBranch = (await $`git cat-file -e refs/remotes/origin/${MEDIA_BRANCH}`.cwd(ROOT).quiet().nothrow()).exitCode === 0;
if (fetched.exitCode !== 0)
  console.log(
    `! couldn't fetch origin/${MEDIA_BRANCH}: media files are checked ${mediaBranch ? "against the local ref" : "for their names only"}`,
  );

let count = 0;
for (const file of await markdownFiles(DOC_GLOBS)) {
  const text = await Bun.file(join(ROOT, file)).text();
  for (const { line, url, image } of links(text)) {
    count++;
    const where = `${file}:${line}`;
    if (/^(mailto|tel):/.test(url)) continue;
    if (url.startsWith(`${MEDIA}/`)) {
      const name = url.slice(MEDIA.length + 1);
      const m = name.match(/^(.+)-([0-9a-f]{8})\.([a-z0-9]+)$/);
      const entry = mediaSpec.media.find((e) => e.name === m?.[1]);
      if (!m || !entry || !entry.formats.includes(m[3]!))
        problems.push(`${where}: media must be <name>-<hash8>.<ext> for an entry and format of docs/media.json: ${url}`);
      else if (mediaLock[entry.name]?.hash !== m[2])
        problems.push(
          `${where}: ${name} is stale: docs/media.lock.json has ${entry.name}-${mediaLock[entry.name]?.hash ?? "(none)"} (run scripts/media)`,
        );
      if (m && mediaBranch) {
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
    if (target.startsWith("docs/images/")) {
      problems.push(`${where}: docs/images/ is frozen (old npm READMEs link it); add the image to docs/media.json instead: ${url}`);
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
