/**
 * Serves `_site/` the way GitHub Pages does: `/x/` → `/x/index.html`, `/x` → `/x/` (redirect)
 * when that's a directory, missing files → `/404.html` with status 404.
 *
 *   bun scripts/site/serve.ts [--port 4400]      (mise run site:serve)
 */
import { stat } from "node:fs/promises";
import { join, normalize } from "node:path";

const root = new URL("../../_site", import.meta.url).pathname;
const i = process.argv.indexOf("--port");
const port = Number(i > 0 ? process.argv[i + 1] : (process.env.PORT ?? 4400));

const isDir = (p: string) =>
  stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = normalize(decodeURIComponent(url.pathname));
    if (path.includes("..")) return new Response("bad path", { status: 400 });
    let file = join(root, path);
    if (await isDir(file)) {
      if (!path.endsWith("/")) return Response.redirect(`${path}/${url.search}`, 301);
      file = join(file, "index.html");
    }
    const f = Bun.file(file);
    if (await f.exists()) return new Response(f);
    return new Response(Bun.file(join(root, "404.html")), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
console.log(`serving _site on ${server.url}`);
