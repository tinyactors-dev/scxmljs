import { expect, test } from "@playwright/test";
import { activeStates, ready } from "./helpers";

const events = (page: import("@playwright/test").Page) => page.evaluate(() => (window as any).__events as string[]);
const violations = (page: import("@playwright/test").Page) => page.evaluate(() => (window as any).__violations as string[]);

// The exact policies are in tests/browser/server.ts and documented in docs/csp.md.
test.describe("Content-Security-Policy", () => {
  test("sandboxed policy ('wasm-unsafe-eval'): the sandbox works, trusted mode is refused", async ({ page }) => {
    await page.goto("/fixtures/view.html?csp=sandboxed");
    await ready(page);
    await expect.poll(() => activeStates(page, "#src")).toEqual(["on", "red"]);
    await expect.poll(() => activeStates(page, "#host")).toEqual(["on", "red"]);
    await expect.poll(() => events(page)).toContainEqual(expect.stringMatching(/^inline:error:/));
    // the only violation is the trusted view's eval
    for (const v of await violations(page)) expect(v).toMatch(/^script-src eval/);
  });

  test("trusted policy ('unsafe-eval' too): everything works, no violations", async ({ page }) => {
    await page.goto("/fixtures/view.html?csp=trusted");
    await ready(page);
    await expect.poll(() => activeStates(page, "#inline")).toEqual(["a"]);
    await expect.poll(() => activeStates(page, "#src")).toEqual(["on", "red"]);
    expect((await events(page)).filter((e) => e.includes(":error"))).toEqual([]);
    expect(await violations(page)).toEqual([]);
  });

  test("explorer under the sandboxed policy", async ({ page }) => {
    await page.goto("/fixtures/explorer.html?csp=sandboxed");
    await ready(page);
    await expect(page.locator("#wide [part~=tree-row]").first()).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  // Classic scripts (IIFE bundles built from dist/ as docs/bundling.md describes; no modules, no import map).
  test("classic-script bundles under the trusted policy: sandboxed view and trusted explorer, no violations", async ({ page }) => {
    await page.goto("/fixtures/iife.html?csp=trusted");
    await ready(page);
    await expect.poll(() => activeStates(page, "#src")).toEqual(["on", "red"]);
    await expect(page.locator("#explorer [part~=tree-row]").first()).toBeVisible();
    expect((await events(page)).filter((e) => e.includes(":error"))).toEqual([]);
    expect(await violations(page)).toEqual([]);
  });

  test("classic-script bundles under the sandboxed policy: the sandbox works, the trusted session is refused", async ({ page }) => {
    await page.goto("/fixtures/iife.html?csp=sandboxed");
    await ready(page);
    await expect.poll(() => activeStates(page, "#src")).toEqual(["on", "red"]);
    await expect.poll(() => events(page)).toContainEqual(expect.stringMatching(/^iife:error:/));
    for (const v of await violations(page)) expect(v).toMatch(/^script-src eval/);
  });

  test("Trusted Types: the elements work; SCXML text goes through the page's policy", async ({ page }, info) => {
    await page.goto("/fixtures/tt.html?csp=tt");
    await ready(page);
    const enforced = await page.evaluate(() => "trustedTypes" in window);
    info.annotations.push({ type: "trusted-types", description: enforced ? "enforced" : "not supported by this engine" });
    await expect.poll(() => activeStates(page, "#src")).toEqual(["on", "red"]);
    const x = page.locator("#wide");
    await expect(x.locator("[part~=tree-row]").first()).toBeVisible();
    // the focus pane must actually render (phase 6 saw an empty one in a quick DOM check)
    await expect(x.locator("[part~=card], [part~=list-row], [part~=lane]").first()).toBeVisible();
    expect(await violations(page)).toEqual([]);
    expect((await events(page)).filter((e) => e.includes(":error"))).toEqual([]);
    // last: Playwright's screenshot injects a <style> (to hide the caret), which WebKit reports
    await info.attach("explorer under Trusted Types", { body: await x.screenshot(), contentType: "image/png" });
  });
});
