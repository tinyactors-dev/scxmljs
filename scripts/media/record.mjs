/**
 * Records the README tour of <scxml-explorer> (run by scripts/readme-media; Node, not Bun,
 * because Playwright's library needs Node).
 *
 *   node scripts/media/record.mjs --base http://127.0.0.1:4391 --out <dir>
 *
 * Opens the playground explorer (fulfillment sample, Tinyactors theme, light, paused clock),
 * hides the page around the element so the explorer fills the viewport, and drives a
 * deterministic tour: every change of virtual time goes through the PlaybackClock, so a
 * recording shows the same states every time; only the real-time pauses between steps set
 * the pacing.
 *
 * Frames are captured with CDP screenshots at device resolution (2×), which is far crisper
 * than Playwright's built-in video recorder. Writes to <dir>:
 *   frame-NNNNN.jpg, frames.ffconcat   the frames with their real display durations
 *   poster.png                          a 2× screenshot at the tour's busiest moment
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split(/\s*--/)
    .filter(Boolean)
    .map((a) => a.split(/\s+/)),
);
const base = args.base ?? "http://127.0.0.1:4391";
const out = args.out ?? "readme-media-out";
const width = Number(args.width ?? 1440);
const height = Number(args.height ?? 900);
const scale = Number(args.scale ?? 2);

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: scale,
  colorScheme: "light",
  reducedMotion: "no-preference",
});
await context.addInitScript(() => {
  try {
    localStorage.setItem("theme", "light");
  } catch {}
});
const page = await context.newPage();
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));

await page.goto(`${base}/explorer?sample=fulfillment&paused=1`);
// only the element: no page chrome around it
await page.addStyleTag({
  content: `
    body > nav, main > h1, main > .lede, main > .bar { display: none !important; }
    body { margin: 0; background: var(--bg-app, #f4eee2); }
    main { max-width: none !important; margin: 0 !important; padding: 0 !important; }
    scxml-explorer { --scxml-height: 100vh; border: 0 !important; border-radius: 0 !important; }
  `,
});
const x = page.locator("scxml-explorer");
await x.locator("[part~=tree-row]").first().waitFor();
await page.waitForFunction(() => typeof globalThis.clock?.advance === "function");
await page.waitForTimeout(600);

// ── capture ─────────────────────────────────────────────────────────────────
// A capture loop runs next to the tour. (Chrome's screencast would be cheaper, but it only
// delivers CSS-pixel frames; captureScreenshot honours deviceScaleFactor.)
const cdp = await context.newCDPSession(page);
const frames = [];
let capturing = true;
const loop = (async () => {
  while (capturing) {
    const t = performance.now() / 1000;
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 90,
      optimizeForSpeed: true,
      clip: { x: 0, y: 0, width, height, scale },
    });
    frames.push({ t, data });
  }
})();

// ── the tour ────────────────────────────────────────────────────────────────
const wait = (ms) => page.waitForTimeout(ms);
/** Move virtual time forward by `virtualMs`, smoothly, over `realMs` of real time. */
async function advance(virtualMs, realMs) {
  const ticks = Math.max(1, Math.round(realMs / 60));
  for (let i = 0; i < ticks; i++) {
    await page.evaluate((d) => globalThis.clock.advance(d), virtualMs / ticks);
    await wait(realMs / ticks);
  }
}
const virtualNow = () => page.evaluate(() => globalThis.clock.now());
const step = async (pause = 900) => {
  await x.locator("[part~=step]").click();
  await wait(pause);
};
const level = (name) => x.locator("[part~=levels] button", { hasText: name }).click();

await wait(1200); // the machine, before anything happens
for (let i = 0; i < 4; i++) await step(); // the order arrives: intake, one macrostep at a time
await advance(9000 - (await virtualNow()), 3600); // screening, payment with 3-D Secure …
await advance(10000, 3800); // … into the fulfilment lanes, the shipment machine starts
await level("System"); // machines and services while the shipment is on its way
await advance(1200, 1300);
await page.screenshot({ path: join(out, "poster.png") }); // the high-resolution still
await advance(1300, 1300);
await level("Machine");
await wait(900);
await step();
await step(1500);

capturing = false;
await loop;
await browser.close();

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
if (frames.length < 10) {
  console.error(`only ${frames.length} frames recorded`);
  process.exit(1);
}

// frames + an ffconcat file with each frame's real display time
let concat = "ffconcat version 1.0\n";
for (let i = 0; i < frames.length; i++) {
  const name = `frame-${String(i).padStart(5, "0")}.jpg`;
  await writeFile(join(out, name), Buffer.from(frames[i].data, "base64"));
  const next = frames[i + 1]?.t ?? frames[i].t + 1.2; // hold the last frame a moment
  concat += `file ${name}\nduration ${Math.max(0.001, next - frames[i].t).toFixed(4)}\n`;
}
// ffconcat ignores the last duration unless the file is repeated
concat += `file frame-${String(frames.length - 1).padStart(5, "0")}.jpg\n`;
await writeFile(join(out, "frames.ffconcat"), concat);
const seconds = frames.at(-1).t - frames[0].t;
console.log(`recorded ${frames.length} frames over ${seconds.toFixed(1)} s at ${width * scale}×${height * scale}`);
