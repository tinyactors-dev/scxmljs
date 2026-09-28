/**
 * Build: per-file ESM, declarations and source maps into dist/ with tsc, then
 * point relative import specifiers in the .d.ts files at .js (tsc rewrites
 * them in JavaScript output only), so every TypeScript version and tool can
 * follow them.
 */

import { readdir } from "node:fs/promises";
import { $ } from "bun";

const root = new URL("..", import.meta.url).pathname;
await $`rm -rf ${root}dist`;
await $`tsc -p ${root}tsconfig.build.json`.cwd(root);

// stylesheets (themes) are shipped as-is
for (const name of await readdir(`${root}src/themes`)) {
  if (name.endsWith(".css")) await Bun.write(`${root}dist/themes/${name}`, Bun.file(`${root}src/themes/${name}`));
}

let rewritten = 0;
for (const name of await readdir(`${root}dist`, { recursive: true })) {
  if (!name.endsWith(".d.ts")) continue;
  const file = Bun.file(`${root}dist/${name}`);
  const text = await file.text();
  const fixed = text.replace(/(from\s+["']\.{1,2}\/[^"']+)\.ts(["'])/g, (_, a, b) => {
    rewritten++;
    return `${a}.js${b}`;
  });
  if (fixed !== text) await Bun.write(file, fixed);
}
console.log(`built dist/ (${rewritten} declaration import specifiers rewritten to .js)`);
