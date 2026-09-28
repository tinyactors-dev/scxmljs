/**
 * Renders the social preview image (Open Graph / Twitter card, 1200×630) into site/public/og.png:
 *
 *   bun scripts/site/og.ts               (mise run site:og; needs a built _site/ for the fonts
 *                                         and the chart)
 *
 * The PNG is committed; run this again when the tagline or the look changes.
 */
import { join } from "node:path";
import { chromium } from "@playwright/test";

const root = new URL("../../", import.meta.url).pathname;
const site = join(root, "_site");
const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="${await asset(/href="(\/assets\/site-[a-z0-9]+\.css)"/)}">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; }
  body {
    box-sizing: border-box; padding: 56px 72px 0; background: #F4EEE2; color: #2A2622;
    font-family: "IBM Plex Sans", sans-serif; border-bottom: 14px solid #1F5E4A;
  }
  .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 26px; }
  .eyebrow { font: 500 20px "IBM Plex Mono", monospace; letter-spacing: .08em; text-transform: uppercase; color: #194D3D; }
  code { font: 500 20px "IBM Plex Mono", monospace; background: #FAF6EE; border: 1px solid #D9CFBE; padding: 10px 16px; border-radius: 3px; }
  h1 { font: 400 66px/1.08 Newsreader, serif; margin: 0 0 30px; letter-spacing: -.01em; }
  h1 em { color: #1F5E4A; }
  .chart { height: 260px; }
  scxml-view { display: block; zoom: 1.45; height: calc(260px / 1.45); }
</style>
<script type="module" src="${await asset(/src="(\/assets\/landing-[a-z0-9]+\.js)"/)}"></script>
</head><body data-theme="light">
  <div class="top"><span class="eyebrow">scxmljs · SCXML 1.0 · 160/160 W3C tests</span><code>npm install @tinyactors/scxmljs</code></div>
  <h1>Statecharts you can <em>run</em>,<br>see and step through</h1>
  <div class="chart"><scxml-view trusted fit direction="right" src="/charts/traffic-light.scxml"></scxml-view></div>
</body></html>`;

/** a hashed asset URL, taken from the built landing page */
async function asset(pattern: RegExp) {
  const index = await Bun.file(join(site, "index.html")).text();
  const url = pattern.exec(index)?.[1];
  if (!url) throw new Error(`og: no ${pattern} in _site/index.html; run \`mise run site:build\` first`);
  return url;
}

// serve _site/ plus the card itself, so the fonts, the chart and the element load as on the site
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/og.html") return new Response(html, { headers: { "content-type": "text/html" } });
    const file = Bun.file(join(site, path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(`http://127.0.0.1:${server.port}/og.html`);
  await page.waitForFunction(() => (document.querySelector("scxml-view") as any)?.session?.configuration?.length > 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(root, "site/public/og.png") });
  console.log("✓ site/public/og.png");
} finally {
  await browser.close();
  server.stop();
}
