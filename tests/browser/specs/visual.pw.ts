/**
 * Screenshot comparisons (@visual). They only run inside the pinned Playwright Docker image
 * (`mise run test:visual`, `mise run test:visual:update`): the same fonts and rendering on a
 * laptop and in CI, so the committed baselines stay valid. Every clock is paused, so each
 * screenshot shows a fixed state.
 */
import { expect, type Page, test } from "@playwright/test";
import { activeStates, ready } from "./helpers";

const scheme = async (page: Page, colorScheme: "light" | "dark") => page.emulateMedia({ colorScheme, reducedMotion: "reduce" });

for (const colorScheme of ["light", "dark"] as const) {
  test(`explorer, wide, ${colorScheme} @visual`, async ({ page }) => {
    await scheme(page, colorScheme);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/fixtures/explorer.html");
    await ready(page);
    await page.evaluate(() => (window as any).__session.send("play"));
    await page.locator("#wide [part~=step]").click();
    await expect(page.locator("#wide [part~=lane]").first()).toBeVisible();
    await expect(page.locator("#wide")).toHaveScreenshot(`explorer-wide-${colorScheme}.png`);
  });

  test(`view, ${colorScheme} @visual`, async ({ page }) => {
    await scheme(page, colorScheme);
    await page.goto("/fixtures/view.html");
    await ready(page);
    await expect.poll(() => activeStates(page, "#host")).toEqual(["on", "red"]);
    await expect(page.locator("#host")).toHaveScreenshot(`view-${colorScheme}.png`);
  });
}

test("explorer, 390px @visual", async ({ page }) => {
  await scheme(page, "light");
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/fixtures/explorer.html");
  await ready(page);
  await expect(page.locator("#wide [part~=tabs]")).toBeVisible();
  await expect(page.locator("#wide")).toHaveScreenshot("explorer-narrow.png");
});

test("view, gatekeeper chart at 390px (automatic scale) @visual", async ({ page }) => {
  await scheme(page, "light");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/element");
  await expect(page.locator("#view [data-state=idle]")).toBeVisible();
  await expect(page.locator("#view")).toHaveScreenshot("view-gatekeeper-narrow.png");
});
