/**
 * Installs the packed tarball into an empty project, the way a user would (`npm install`), then
 * uses it from every supported runtime and a bundler:
 *
 *   Node, Bun, Deno   run packages/scxmljs/scripts/smoke-node.mjs against the installed package
 *                     (both entry points, data, scripts, delays, invoke, donedata, the explorer
 *                     module without a DOM, and the missing-DOMParser error)
 *   bun build         bundle all four browser entry points from node_modules for the browser
 *
 * (A plain HTML page loading the files through an import map is covered by the browser tests:
 * tests/browser/fixtures load the same built files that way.)
 *
 *   bun scripts/smoke-tarball.ts        (mise run smoke:tarball)
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const root = join(import.meta.dir, "..");
const pkgDir = join(root, "packages/scxmljs");
const dir = mkdtempSync(join(tmpdir(), "scxmljs-tarball-"));
const t0 = performance.now();
const step = async (name: string, fn: () => Promise<unknown>) => {
  const t = performance.now();
  await fn();
  console.log(`  ✓ ${name} (${((performance.now() - t) / 1000).toFixed(1)}s)`);
};

try {
  const happyDom = (await Bun.file(join(root, "package.json")).json()).devDependencies["happy-dom"];
  let tarball = "";
  await step("npm pack", async () => {
    const out = await $`npm pack --pack-destination ${dir} --json`.cwd(pkgDir).quiet().text();
    // prepack (the build) prints to stdout first; the JSON report is the trailing array
    tarball = join(dir, JSON.parse(out.slice(out.search(/^\[/m)))[0].filename);
  });
  await Bun.write(
    join(dir, "app/package.json"),
    JSON.stringify(
      {
        name: "scxmljs-smoke",
        private: true,
        type: "module",
        dependencies: { "@tinyactors/scxmljs": `file:${tarball}`, "happy-dom": happyDom },
      },
      null,
      2,
    ),
  );
  const app = join(dir, "app");
  await step("npm install (empty project)", () => $`npm install --no-audit --no-fund --loglevel=error`.cwd(app).quiet());
  await Bun.write(join(app, "smoke.mjs"), Bun.file(join(pkgDir, "scripts/smoke-node.mjs")));

  await step(`Node ${(await $`node --version`.text()).trim()}`, () => $`node smoke.mjs`.cwd(app).quiet());
  await step(`Bun ${Bun.version}`, () => $`bun smoke.mjs`.cwd(app).quiet());
  const deno = await $`deno --version`.nothrow().quiet();
  if (deno.exitCode === 0) {
    const version = deno.text().split("\n")[0]!;
    await step(version, () => $`deno run --quiet --allow-read --allow-env --allow-sys smoke.mjs`.cwd(app).quiet());
  } else {
    if (process.env.SCXML_REQUIRE_DENO === "1") throw new Error("deno isn't installed");
    console.log("  - Deno: skipped (not installed)");
  }

  await Bun.write(
    join(app, "browser.js"),
    `import { createSession } from "@tinyactors/scxmljs";\nimport "@tinyactors/scxmljs/trusted";\nimport "@tinyactors/scxmljs/view";\nimport "@tinyactors/scxmljs/explorer";\nconsole.log(typeof createSession);\n`,
  );
  await step("bun build (browser, all entry points, from node_modules)", async () => {
    const r = await Bun.build({
      entrypoints: [join(app, "browser.js")],
      target: "browser",
      splitting: true,
      outdir: join(app, "dist"),
      minify: true,
    });
    if (!r.success) throw new Error(r.logs.join("\n"));
  });
  console.log(`tarball smoke test passed in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
