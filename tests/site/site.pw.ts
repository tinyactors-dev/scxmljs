import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, type Page, test } from "@playwright/test";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

/** axe-core (WCAG 2.2 A/AA + best practices) over the whole page, shadow roots included */
async function axe(page: Page) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(() =>
    (window as any).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    }),
  );
  return (result.violations as { id: string; impact: string; nodes: { target: unknown[]; any: { message: string }[] }[] }[]).map(
    (v) => `${v.impact} ${v.id} (${v.nodes.length}× ${JSON.stringify(v.nodes[0]?.target)}: ${v.nodes[0]?.any[0]?.message ?? ""})`,
  );
}

/** fail on uncaught errors and console errors */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

test("landing: the hero <scxml-view> runs", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  const hero = page.locator("#hero-view");
  // the traffic light starts red and its delayed <send> moves it on: an active state changes
  const active = () => hero.evaluate((el) => ((el as any).session?.configuration ?? []).map((s: { id: string }) => s.id).join(","));
  await expect.poll(active).toContain("red");
  await expect.poll(active, { timeout: 15_000 }).not.toContain("red");
  expect(errors).toEqual([]);
});

test("explorer demo: stepping advances the system", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/demos/explorer/?paused=1");
  const explorer = page.locator("scxml-explorer");
  const step = explorer.locator("[part~=step]");
  await expect(step).toBeEnabled();
  const clock = explorer.locator("[part~=clock]");
  const before = await clock.textContent();
  for (let i = 0; i < 3; i++) await step.click();
  await expect(clock).not.toHaveText(before ?? "");
  expect(errors).toEqual([]);
});

test("gallery: every chart renders with playback controls", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/demos/gallery/");
  const views = page.locator("scxml-view[data-gallery]");
  await expect(views).toHaveCount(4);
  for (const v of await views.all()) await expect(v.locator("[part~=step]")).toBeVisible();
  expect(errors).toEqual([]);
});

test("search returns results", async ({ page }) => {
  await page.goto("/search/?q=clock");
  await expect(page.locator(".pagefind-ui__result").first()).toBeVisible();
});

test("docs: a guide renders with sidebar, TOC and highlighted code", async ({ page }) => {
  await page.goto("/docs/playback/");
  await expect(page.locator("h1")).toContainText("Playback");
  await expect(page.locator(".docs-nav [aria-current=page]")).toBeVisible();
  await expect(page.locator(".toc a").first()).toBeVisible();
  await expect(page.locator(".prose pre.shiki").first()).toBeVisible();
});

const PAGES = [
  "/",
  "/docs/",
  "/docs/view/",
  "/demos/",
  "/demos/explorer/",
  "/demos/gallery/",
  "/playground/",
  "/search/?q=clock",
  "/404.html",
];

test.describe("390px wide: no horizontal overflow", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const path of PAGES)
    test(path, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
});

// every page in the sitemap (the TypeDoc reference aside), plus the unindexed search and 404 pages
const SITEMAP = [
  ...readFileSync(new URL("../../_site/sitemap.xml", import.meta.url), "utf8").matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g),
]
  .map((m) => m[1]!)
  .filter((p) => !p.startsWith("/api/"));
const AUDITED = [...new Set([...SITEMAP, "/search/?q=clock", "/404.html"])];

for (const scheme of ["light", "dark"] as const)
  test.describe(`accessibility (axe-core), ${scheme}`, () => {
    for (const path of AUDITED)
      test(path, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(await axe(page)).toEqual([]);
      });
  });
