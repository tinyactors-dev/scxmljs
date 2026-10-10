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
      // stepping is deterministic: the clock doesn't move on its own, Step moves it
      const time = x.locator("[part~=clock]");
      const before = await time.textContent();
      for (let i = 0; i < 12 && (await time.textContent()) === before; i++) await x.locator("[part~=step]").click();
      await expect(time).not.toHaveText(before ?? "");
      await x.locator("[part~=crumb]", { hasText: "System" }).click();
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
    // one panel (this width): the accepted events are its second page
    if (await x.locator("[part~=to-inspector]").isVisible()) await x.locator("[part~=to-inspector]").click();
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
    await x.locator("[part~=crumb]", { hasText: "System" }).click();
    await expect(x.locator("[part~=machine]")).toHaveCount(1);
  });

  test("panels: a 400px container gets the bottom sheet, a wide one floating side panels", async ({ page }) => {
    await expect(explorer(page, "small").locator("[part~=sheet-handle]")).toBeVisible();
    await expect(explorer(page, "wide").locator("[part~=sheet-handle]")).toBeHidden();
    await expect(explorer(page, "wide").locator("[part~=panel]").first()).toBeVisible();
    // the corners: playback bottom left, Follow bottom right, on one line
    const x = explorer(page, "wide");
    const [p, f] = [(await x.locator("[part~=playback]").boundingBox())!, (await x.locator("[part~=follow]").boundingBox())!];
    expect(Math.abs(p.y + p.height - (f.y + f.height))).toBeLessThan(1);
    expect(p.x).toBeLessThan(f.x);
  });

  test("the sheet: drag its handle up and it settles at the nearest height", async ({ page }) => {
    const x = explorer(page, "small");
    const panel = x.locator("[part~=panel]").first();
    await x.locator("[part~=sheet-handle]").scrollIntoViewIfNeeded();
    const low = (await panel.boundingBox())!.height;
    const handle = (await x.locator("[part~=sheet-handle]").boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y - 200, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(low + 100);
    await expect(x.locator("[part~=tree]")).toBeVisible();
  });

  test("a 390px viewport: the sheet, and the explorer's contents never overflow it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const x = explorer(page);
    await expect(x.locator("[part~=sheet-handle]")).toBeVisible();
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
