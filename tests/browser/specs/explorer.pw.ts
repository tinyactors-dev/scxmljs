import { expect, type Page, test } from "@playwright/test";
import { ready } from "./helpers";

const explorer = (page: Page, id = "wide") => page.locator(`#${id}`);
const title = (page: Page, id = "wide") => explorer(page, id).locator("[part~=focus-pane] [part~=title]").first();

test.describe("<scxml-explorer> with the sample systems (playground, paused clock)", () => {
  for (const [sample, minMachines] of [
    ["gatekeeper", 1],
    ["fulfillment", 1],
    ["support-desk", 12],
  ] as const) {
    test(`${sample}: tree, stepping, System level`, async ({ page }) => {
      await page.goto(`/explorer?sample=${sample}&paused=1&theme=neutral`);
      const x = page.locator("scxml-explorer");
      await expect(x.locator("[part~=tree-row]").first()).toBeVisible();
      // stepping is deterministic: the clock doesn't move on its own
      const lastStep = x.locator("[part~=last-step]");
      const before = await lastStep.textContent();
      for (let i = 0; i < 12 && (await lastStep.textContent()) === before; i++) await x.locator("[part~=step]").click();
      await expect(lastStep).not.toHaveText(before ?? "");
      await x.locator("[part~=levels] button", { hasText: "System" }).click();
      await expect(x.locator("[part~=system]")).toBeVisible();
      expect(await x.locator("[part~=machine]").count()).toBeGreaterThanOrEqual(minMachines);
    });
  }
});

test.describe("<scxml-explorer> (built package, import map)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/fixtures/explorer.html");
    await ready(page);
  });

  test("keyboard: the tree follows the ARIA tree pattern", async ({ page }) => {
    const x = explorer(page);
    await x.locator("[part~=tree-row]").first().focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown"); // stopped → playing
    await page.keyboard.press("Enter");
    await expect(title(page)).toHaveText(/playing/);
    await page.keyboard.press("ArrowRight"); // expand
    await page.keyboard.press("ArrowRight"); // first child
    await expect(x.locator("[part~=tree-row]:focus")).toContainText("audio");
  });

  test("sending from the events pane queues on the paused clock; Step delivers it", async ({ page }) => {
    const x = explorer(page);
    await x.getByRole("button", { name: "Send play", exact: true }).click();
    expect(await page.evaluate(() => (window as any).__session.activeStateIds())).toEqual(["stopped"]);
    await x.locator("[part~=step]").click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__session.activeStateIds()))
      .toEqual(["playing", "audio", "normal", "video", "sd"]);
  });

  test("a list row sends the events of its active leaf; Step delivers them", async ({ page }) => {
    const x = explorer(page);
    await x.locator("[part~=focus-pane]").getByRole("button", { name: "List", exact: true }).click();
    const row = x.locator("[part~=list-row]", { has: page.getByRole("button", { name: "stopped, atomic, active" }) });
    await row.getByRole("button", { name: "Send play → playing" }).click();
    await x.locator("[part~=step]").click();
    await expect.poll(() => page.evaluate(() => (window as any).__session.isActive("playing"))).toBe(true);
    // following moved the focus into "playing"; back to the top level: the row of the state just
    // left says so, and marks the transition taken
    await x.locator("[part~=tree-row]", { hasText: "stopped" }).click();
    await x.getByRole("button", { name: "stopped, atomic, last visited" }).click(); // opens it in place
    await expect(x.locator("[part~=list-row][part~=visited] [part~=row-event][part~=fired]")).toContainText("play");
  });

  test("levels: System shows the machine", async ({ page }) => {
    const x = explorer(page);
    await x.locator("[part~=levels] button", { hasText: "System" }).click();
    await expect(x.locator("[part~=machine]")).toHaveCount(1);
  });

  test("container queries: a 400px container gets the tabbed layout, a wide one doesn't", async ({ page }) => {
    await expect(explorer(page, "small").locator("[part~=tabs]")).toBeVisible();
    await expect(explorer(page, "wide").locator("[part~=tabs]")).toBeHidden();
  });

  test("a 390px viewport: tabs, and the explorer's contents never overflow it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const x = explorer(page);
    await expect(x.locator("[part~=tabs]")).toBeVisible();
    const box = (await x.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(() => {
      const shell = document.getElementById("wide")!.shadowRoot!.querySelector(".shell") as HTMLElement;
      return shell.scrollWidth - shell.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("themes: dark when the page supports it and the user prefers it", async ({ page }) => {
    const bg = () => page.evaluate(() => getComputedStyle(document.getElementById("wide")!).backgroundColor);
    await page.emulateMedia({ colorScheme: "light" });
    const light = await bg();
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await bg()).not.toBe(light);
  });

  test("reduced motion: navigation doesn't start view transitions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
      (window as any).__vt = 0;
      if (d.startViewTransition) {
        const original = d.startViewTransition.bind(d);
        d.startViewTransition = (cb: () => void) => ((window as any).__vt++, original(cb));
      }
    });
    await explorer(page).locator("[part~=tree-row]", { hasText: "playing" }).click();
    await expect(title(page)).toHaveText(/playing/);
    expect(await page.evaluate(() => (window as any).__vt)).toBe(0);
  });

  test("no CSP violations or errors", async ({ page }) => {
    expect(await page.evaluate(() => (window as any).__violations)).toEqual([]);
  });
});
