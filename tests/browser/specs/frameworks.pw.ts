/**
 * The framework examples (examples/frameworks/*), built with each framework's own toolchain:
 * both elements render, receive their object properties and fire their events.
 * The components are the snippets from docs/frameworks.md, verbatim (the docs check enforces it).
 * `mise run examples:frameworks` builds them first; an app that isn't built is skipped.
 */
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

const APPS = ["react", "vue", "svelte", "angular"] as const;

for (const app of APPS) {
  test(`${app}: <scxml-view> loads (event handler fires) and <scxml-explorer> gets its session property`, async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "framework integration is engine-independent; Chromium is enough");
    const built = existsSync(new URL(`../../../examples/frameworks/${app}/dist/index.html`, import.meta.url));
    // CI builds them first (scripts/ci sets SCXML_REQUIRE_FRAMEWORKS): there, a missing build is a failure
    if (process.env.SCXML_REQUIRE_FRAMEWORKS === "1") expect(built, `${app} isn't built (mise run examples:frameworks)`).toBe(true);
    test.skip(!built, `${app} isn't built (mise run examples:frameworks)`);
    const errors: string[] = [];
    const logs: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "log" && logs.push(m.text()));
    await page.goto(`/fw/${app}/`);
    // the view: fetched, running (trusted), and the snippet's scxml-load handler logged
    await expect(page.locator("scxml-view [data-state=red][part~=active]")).toBeVisible();
    await expect.poll(() => logs.length).toBeGreaterThan(0);
    // the explorer: the session property arrived
    await expect(page.locator("scxml-explorer [part~=tree-row]", { hasText: "stopped" })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
