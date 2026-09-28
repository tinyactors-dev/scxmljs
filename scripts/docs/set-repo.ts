/**
 * Move the documentation to another repository URL in one go.
 *
 *   1. change REPO (and BRANCH) in scripts/docs/config.ts
 *   2. mise run docs:set-repo -- https://github.com/old-owner/scxmljs
 *
 * Rewrites every occurrence of the OLD base (blob, tree, raw and plain URLs)
 * in the documentation and in packages/scxmljs/package.json to the new one
 * from config.ts, then run `mise run docs:links` to confirm.
 */
import { join } from "node:path";
import { BRANCH, DOC_GLOBS, REPO } from "./config.ts";
import { markdownFiles, ROOT } from "./markdown.ts";

const old = process.argv[2]?.replace(/\/$/, "");
const oldBranch = process.argv[3] ?? BRANCH;
if (!old) {
  console.error("usage: bun scripts/docs/set-repo.ts <old repository URL> [old branch]");
  process.exit(2);
}
const raw = (repo: string) => repo.replace("https://github.com/", "https://raw.githubusercontent.com/");
const pairs: [string, string][] = [
  [`${raw(old)}/${oldBranch}`, `${raw(REPO)}/${BRANCH}`],
  [`${old}/blob/${oldBranch}`, `${REPO}/blob/${BRANCH}`],
  [`${old}/tree/${oldBranch}`, `${REPO}/tree/${BRANCH}`],
  [old, REPO],
];
let changed = 0;
for (const file of [...(await markdownFiles(DOC_GLOBS)), "packages/scxmljs/package.json"]) {
  const path = join(ROOT, file);
  const before = await Bun.file(path).text();
  let after = before;
  for (const [a, b] of pairs) after = after.split(a).join(b);
  if (after !== before) {
    await Bun.write(path, after);
    changed++;
    console.log(`rewrote ${file}`);
  }
}
console.log(`${changed} file(s) changed`);
