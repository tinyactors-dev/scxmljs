/**
 * Playground server for @tinyactors/scxmljs.
 *
 *   /                         overview (HTML import, HMR)
 *   /element                  the <scxml-view> custom element
 *   /explorer                 the <scxml-explorer> custom element with sample systems
 *   /charts/<chart>.scxml     chart files (the explorer samples load these)
 *   POST /webhook             GitHub webhook → headless gatekeeper (dry-run unless GH_LIVE=1)
 */
import { Window } from "happy-dom";
import { GhCliBackend } from "./src/github/gh-cli.ts";
import { Gatekeeper } from "./src/scxml/gatekeeper.ts";
import bench from "./web/bench.html";
import element from "./web/element.html";
import explorer from "./web/explorer.html";
import home from "./web/index.html";

const port = Number(process.env.PORT ?? 4321);
const root = import.meta.dir;
const CHART = /^[\w-]+\.scxml$/;

const chartFile = (name: string) => (CHART.test(name) ? Bun.file(`${root}/charts/${name}`) : null);
const xml = (body: string) =>
  new Response(body, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" } });

// ── headless system behind a real webhook endpoint ────────────────────────
const live = process.env.GH_LIVE === "1";
const gatekeeper = await Gatekeeper.create({
  chart: await Bun.file(`${root}/charts/github-issues.scxml`).text(),
  backend: new GhCliBackend({ dryRun: !live, log: (l) => console.log(`[webhook] ${l}`) }),
  domParser: new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document },
  webhookUrl: `http://localhost:${port}/webhook`,
  log: (l) => console.log(`[webhook] ${l}`),
});

async function verifySignature(req: Request, body: string) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const hmac = new Bun.CryptoHasher("sha256", secret).update(body).digest("hex");
  const expected = Buffer.from(`sha256=${hmac}`);
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

const server = Bun.serve({
  port,
  development: { hmr: true, console: true },
  routes: {
    "/": home,
    "/element": element,
    "/explorer": explorer,
    "/bench": bench,

    "/charts/:file": async (req) => {
      const f = chartFile(req.params.file);
      return f && (await f.exists()) ? xml(await f.text()) : new Response("not found", { status: 404 });
    },

    "/webhook": {
      POST: async (req) => {
        const body = await req.text();
        if (!(await verifySignature(req, body))) return new Response("bad signature", { status: 401 });
        const event = req.headers.get("x-github-event") ?? "";
        const handled = gatekeeper.webhook(event, JSON.parse(body));
        return Response.json({ handled, sessions: gatekeeper.sessions.size });
      },
    },
  },
});

console.log(`scxmljs playground listening on ${server.url} (webhook: ${live ? "LIVE gh" : "dry-run"})`);
