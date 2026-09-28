/**
 * Renders the frames of every entry in docs/media.json. Runs inside the pinned Playwright image
 * (scripts/lib/media/media.ts starts it; Node, because Playwright's library needs Node):
 *
 *   node scripts/lib/media/render.mjs --stage <built stage dir> --spec docs/media.json --out <dir> [--only a,b]
 *
 * Deterministic by construction: the stage runs everything on a paused PlaybackClock that only
 * this script moves, one fixed step at a time; after every step it waits until the elements stop
 * changing, then takes a lossless screenshot. Real time never decides what a frame shows, and a
 * frame's display time is fixed in the scene, not measured. Reduced motion and disabled
 * animations, a seeded Math.random, a fixed Date and local fonts cover the rest.
 *
 * Writes <out>/<name>/frame-NNNNN.png, frames.json ([{ file, ms }], the display time of each)
 * and still.png (the screenshot the docs show; for a video, its poster).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const stageDir = arg("stage");
const out = arg("out");
const spec = JSON.parse(await readFile(arg("spec", "docs/media.json"), "utf8"));
const only = arg("only")?.split(",");
if (!stageDir || !out) throw new Error("usage: render.mjs --stage DIR --out DIR [--spec FILE] [--only a,b]");

// ── the stage, served from a local static server ───────────────────────────
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".scxml": "application/xml",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try {
    const body = await readFile(join(stageDir, path === "/" ? "stage.html" : path));
    res.writeHead(200, { "content-type": TYPES[extname(path) || ".html"] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
let failed = false;
try {
  for (const entry of spec.media) {
    if (only && !only.includes(entry.name)) continue;
    const started = performance.now();
    const frames = await render(entry);
    console.log(`  ${entry.name}: ${frames} frame(s) in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  }
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);

async function render(entry) {
  const [width, height] = entry.viewport;
  const dir = join(out, entry.name);
  await mkdir(dir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: entry.scale,
    colorScheme: entry.scheme,
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
  });
  await context.clock.setFixedTime(new Date("2026-01-01T00:00:00Z"));
  await context.addInitScript(() => {
    // a seeded Math.random (mulberry32): session ids and anything else "random" repeat exactly
    let seed = 0x5c3a1;
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));

  const scene = entry.scene === "explorer-tour" ? "explorer" : entry.scene;
  await page.goto(`${base}/?scene=${scene}&theme=${entry.theme}`);
  await page.waitForFunction(() => globalThis.stage, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(width - 1, height - 1); // park the pointer where it hovers nothing that matters

  const frames = [];
  const shot = async (target = page) => {
    await settle(page);
    return target.screenshot({ animations: "disabled", caret: "hide", type: "png" });
  };
  /** One frame, shown for `ms`. */
  const frame = async (ms) => {
    const file = `frame-${String(frames.length).padStart(5, "0")}.png`;
    await writeFile(join(dir, file), await shot());
    frames.push({ file, ms });
    return file;
  };
  const still = async (target) => writeFile(join(dir, "still.png"), await shot(target));
  // Moving a paused PlaybackClock by hand doesn't notify its subscribers (only ticks, steps and
  // queued work do), so the explorer's time readout would show whenever work was last queued.
  // Re-setting the speed notifies synchronously: the readout always shows the time of the frame.
  const advance = (ms) =>
    page.evaluate((d) => {
      const { clock } = globalThis.stage;
      clock.advance(d);
      if ("speed" in clock) clock.speed = clock.speed;
    }, ms);
  const clockNow = () => page.evaluate(() => globalThis.stage.clock.now());

  if (entry.scene === "explorer-tour") {
    const x = page.locator("scxml-explorer");
    await x.locator("[part~=tree-row]").first().waitFor();
    /** Virtual time moves forward by `virtualMs`, smoothly, over `realMs` of video. */
    const glide = async (virtualMs, realMs) => {
      const ticks = Math.max(1, Math.round(realMs / 80));
      for (let i = 0; i < ticks; i++) {
        await advance(virtualMs / ticks);
        await frame(realMs / ticks);
      }
    };
    const step = async (ms = 900) => {
      await x.locator("[part~=step]").click();
      await page.mouse.move(width - 1, height - 1);
      await frame(ms);
    };
    const level = async (name) => {
      await x.locator("[part~=levels] button", { hasText: name }).click();
      await page.mouse.move(width - 1, height - 1);
    };

    await frame(1200); // the machine, before anything happens
    for (let i = 0; i < 4; i++) await step(); // the order arrives: intake, one macrostep at a time
    await glide(9000 - (await clockNow()), 3600); // screening, payment with 3-D Secure …
    await glide(10000, 3800); // … into the fulfilment lanes, the shipment machine starts
    await level("System"); // machines and services while the shipment is on its way
    await glide(1200, 1300);
    await still(); // the poster: the busiest moment
    await glide(1300, 1300);
    await level("Machine");
    await frame(900);
    await step();
    await step(1500);
  } else if (entry.scene === "explorer") {
    await page.locator("scxml-explorer [part~=tree-row]").first().waitFor();
    await advance(4600); // payment: the card is being challenged
    await still();
  } else if (entry.scene === "view") {
    await page.evaluate(() => {
      globalThis.stage.session.send("play");
      globalThis.stage.clock.advance(0);
    });
    await still(page.locator("#stage-frame"));
  } else throw new Error(`${entry.name}: unknown scene ${entry.scene}`);

  await writeFile(join(dir, "frames.json"), `${JSON.stringify(frames, null, 1)}\n`);
  await context.close();
  if (problems.length) throw new Error(`${entry.name}:\n  ${problems.join("\n  ")}`);
  return frames.length || 1;
}

/**
 * Waits until the page stops changing: two animation frames apart, the DOM (including every
 * shadow root) must serialise to the same text, twice in a row.
 */
function settle(page) {
  return page.evaluate(async () => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const snapshot = () => {
      let s = document.body.innerHTML;
      const walk = (root) => {
        for (const el of root.querySelectorAll("*")) {
          if (!el.shadowRoot) continue;
          s += el.shadowRoot.innerHTML;
          walk(el.shadowRoot);
        }
      };
      walk(document);
      return s;
    };
    let last;
    for (let i = 0; i < 100; i++) {
      await raf();
      await raf();
      const now = snapshot();
      if (now === last) return;
      last = now;
    }
    throw new Error("the page never settled");
  });
}
