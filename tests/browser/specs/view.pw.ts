import { expect, test } from "@playwright/test";
import { activeStates, ready, stateBox } from "./helpers";

test.describe("<scxml-view>", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/fixtures/view.html");
    await ready(page);
  });

  test("zero-JS src: fetched, sandboxed, running; a label sends its event", async ({ page }) => {
    const view = page.locator("#src");
    await expect.poll(() => activeStates(page, "#src")).toEqual(["on", "red"]);
    await view.locator("button[part~=transition]", { hasText: "power.off" }).click();
    await expect.poll(() => activeStates(page, "#src", "reached")).toEqual(["off"]);
    expect(await activeStates(page, "#src")).toEqual([]);
  });

  test("zero-JS inline source, trusted engine: data persists in the iframe realm", async ({ page }) => {
    const view = page.locator("#inline");
    await expect.poll(() => activeStates(page, "#inline")).toEqual(["a"]);
    await view.locator("button[part~=transition]", { hasText: "go" }).first().click();
    await expect.poll(() => activeStates(page, "#inline")).toEqual(["b"]);
    await view.locator("button[part~=transition]:not([disabled])", { hasText: "go" }).click();
    await expect.poll(() => activeStates(page, "#inline", "reached")).toEqual(["c"]);
    expect(await page.locator("iframe[data-scxml-realm]").count()).toBeGreaterThan(0);
  });

  test("host session on a paused PlaybackClock: controls step it", async ({ page }) => {
    const host = page.locator("#host");
    await expect.poll(() => activeStates(page, "#host")).toEqual(["on", "red"]);
    await expect(host.locator("[part~=controls]")).toBeVisible();
    await host.locator("[part~=step]").click();
    await expect.poll(() => activeStates(page, "#host")).toEqual(["on", "green"]);
    await expect(stateBox(page, "#host", "green")).toHaveAttribute("part", /active/);
  });

  test("a page that doesn't declare color-scheme keeps the light theme, even for dark-mode users", async ({ page }) => {
    const bg = () => page.evaluate(() => getComputedStyle(document.getElementById("src")!).backgroundColor);
    await page.emulateMedia({ colorScheme: "light" });
    const light = await bg();
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await bg()).toBe(light);
  });

  test("no CSP violations and no errors without a policy", async ({ page }) => {
    await expect.poll(() => page.evaluate(() => (window as any).__events)).toEqual(expect.arrayContaining(["src:load", "inline:load"]));
    expect((await page.evaluate(() => (window as any).__events)).filter((e: string) => e.includes(":error"))).toEqual([]);
    expect(await page.evaluate(() => (window as any).__violations)).toEqual([]);
  });
});

test.describe("<scxml-view> layout", () => {
  const zoom = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const d = document.querySelector("#view")!.shadowRoot!.querySelector(".diagram") as HTMLElement;
      return Number(d.dataset.scale ?? 1);
    });

  test("390px: a wide chart is scaled down, but not below --scxml-min-scale (0.65), and the page never scrolls sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/element");
    await expect(page.locator("#view [data-state=idle]")).toBeVisible();
    await expect.poll(() => zoom(page)).toBeLessThan(1);
    expect(await zoom(page)).toBeGreaterThanOrEqual(0.65);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // `fit` scales all the way down; --scxml-min-scale: 1 turns scaling off
    await page.evaluate(() => document.querySelector("#view")!.setAttribute("fit", ""));
    await expect.poll(() => zoom(page)).toBeLessThan(0.65);
    await page.evaluate(() => {
      const v = document.querySelector("#view") as HTMLElement;
      v.removeAttribute("fit");
      v.style.setProperty("--scxml-min-scale", "1");
      window.dispatchEvent(new Event("resize"));
    });
    await page.setViewportSize({ width: 391, height: 844 }); // nudge the ResizeObserver
    await expect.poll(() => zoom(page)).toBe(1);
  });

  test("zoom with Ctrl + wheel around the pointer, pan by dragging, fold, and read a state's help", async ({ page }) => {
    await page.goto("/fixtures/view.html");
    await ready(page);
    await expect.poll(() => activeStates(page, "#src")).toEqual(["on", "red"]);
    const view = page.locator("#src");
    const scale = () => view.evaluate((v) => (v as HTMLElement & { zoom: number }).zoom);
    const canvas = view.locator(".canvas");
    const box = (await canvas.boundingBox())!;
    const start = await scale();
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.keyboard.down("Control");
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect.poll(scale).toBeGreaterThan(start * 1.5);
    // the canvas keeps its height; dragging the background pans
    const before = await canvas.evaluate((c) => ({ left: c.scrollLeft, top: c.scrollTop }));
    await page.mouse.move(box.x + 6, box.y + 6);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 50, { steps: 5 });
    await page.mouse.up();
    const after = await canvas.evaluate((c) => ({ left: c.scrollLeft, top: c.scrollTop }));
    expect(after.left + after.top).toBeLessThan(before.left + before.top);
    await view.locator(".zoom-reset").click();
    await expect.poll(scale).toBeLessThanOrEqual(1);

    // fold the compound state "on", then unfold it
    await view.locator("[data-state=on] .toggle").click();
    await expect(view.locator("[data-state=red]")).toHaveCount(0);
    await view.locator("[data-state=on] .toggle").click();
    await expect(view.locator("[data-state=red]")).toHaveCount(1);

    const help = view.locator("[data-state=red] button.help");
    await help.click();
    const pop = view.locator(".help-popover");
    await expect(pop).toBeVisible();
    await expect(pop).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(pop).toBeHidden();
    await expect(help).toBeFocused();
  });

  test("right-to-left pages: the diagram stays anchored at the start of its canvas", async ({ page }) => {
    await page.goto("/fixtures/view.html?dir=rtl");
    await ready(page);
    await expect.poll(() => activeStates(page, "#host")).toEqual(["on", "red"]);
    const offset = await page.evaluate(() => {
      const root = document.querySelector("#host")!.shadowRoot!;
      const canvas = root.querySelector(".canvas")!.getBoundingClientRect();
      const diagram = root.querySelector(".diagram")!.getBoundingClientRect();
      return diagram.left - canvas.left;
    });
    expect(offset).toBeLessThan(80);
  });
});
