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

  test("controls sit on the diagram's bottom edge: playback left, zoom right, one line, inset alike", async ({ page }) => {
    await page.clock.install();
    await page.goto("/fixtures/view.html");
    await ready(page);
    const host = page.locator("#host");
    const canvas = (await host.locator("[part~=canvas]").boundingBox())!;
    const controls = host.locator("[part~=controls]");
    const fit = host.locator("[part~=fit]");
    await expect(controls).toBeVisible();
    await expect(fit).toBeHidden();
    // zoom in: Fit appears in the corner
    await host.locator("[part~=canvas]").hover();
    await host.locator("[part~=zoom-in]").click();
    await expect(fit).toBeVisible();
    const [c, f] = [(await controls.boundingBox())!, (await fit.boundingBox())!];
    // the same line, the same height, the same inset from their sides
    expect(Math.abs(c.y + c.height - (f.y + f.height))).toBeLessThan(1);
    expect(Math.abs(c.height - f.height)).toBeLessThan(1);
    expect(Math.abs(c.x - canvas.x - (canvas.x + canvas.width - (f.x + f.width)))).toBeLessThan(2);
    // the pointer leaves: −/level/+ go, Fit stays where it was
    await page.mouse.move(0, 0);
    await expect(host.locator("[part~=zoom-in]")).toBeHidden();
    expect((await fit.boundingBox())!.x).toBeCloseTo(f.x, 0);
    // playing untouched: the controls shrink to the play button; movement brings them back
    await host.locator("[part~=play]").click();
    await expect(host.locator("[part~=step]")).toBeHidden();
    await page.mouse.move(0, 0);
    await page.clock.runFor(4000);
    await expect(controls).toHaveClass(/idle/);
    await expect(host.locator("[part~=speeds]")).toBeHidden();
    await host.locator("[part~=canvas]").hover();
    await expect(controls).not.toHaveClass(/idle/);
    await host.locator("[part~=play]").click();
    await expect(host.locator("[part~=step]")).toBeVisible();
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

  test("a chart taller than its element follows the active state; touch pinch zooms the diagram", async ({ page, browserName }) => {
    await page.goto("/fixtures/view.html");
    await ready(page);
    const chain = Array.from(
      { length: 16 },
      (_, i) => `<state id="s${i}"><transition event="next" target="s${(i + 1) % 16}"/></state>`,
    ).join("");
    await page.evaluate((states) => {
      const v = document.querySelector("#inline") as HTMLElement & { source: string };
      v.style.setProperty("--scxml-height", "320px");
      v.source = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="s0">${states}</scxml>`;
    }, chain);
    const view = page.locator("#inline");
    await expect(view.locator("[data-state=s15]")).toHaveCount(1);
    const visible = (id: string) =>
      view.evaluate((v, id) => {
        const r = v.shadowRoot!;
        const c = r.querySelector(".canvas")!.getBoundingClientRect();
        const b = r.querySelector(`[data-state="${id}"]`)!.getBoundingClientRect();
        return b.top >= c.top && b.bottom <= c.bottom;
      }, id);
    expect(await visible("s0")).toBe(true);
    expect(await visible("s12")).toBe(false);
    await page.evaluate(() => {
      const v = document.querySelector("#inline") as HTMLElement & { session: { send(n: string): void } };
      for (let i = 0; i < 12; i++) v.session.send("next");
    });
    await expect.poll(() => visible("s12")).toBe(true);

    test.skip(browserName !== "chromium", "synthetic Touch objects: Chromium");
    const zoom = () => view.evaluate((v) => (v as HTMLElement & { zoom: number }).zoom);
    const before = await zoom();
    await view.evaluate((v) => {
      const canvas = v.shadowRoot!.querySelector(".canvas")!;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const touches = (d: number) =>
        [0, 1].map((i) => new Touch({ identifier: i, target: canvas, clientX: cx + (i ? d : -d), clientY: cy }));
      const fire = (type: string, d: number) => {
        const t = touches(d);
        canvas.dispatchEvent(new TouchEvent(type, { touches: t, targetTouches: t, changedTouches: t, bubbles: true, cancelable: true }));
      };
      fire("touchstart", 40);
      fire("touchmove", 60);
      fire("touchmove", 80);
      canvas.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true }));
    });
    expect(await zoom()).toBeCloseTo(before * 2, 1);

    // double tap: zoomed in → back to fit; again → zoom in on that spot
    const doubleTap = () =>
      view.evaluate((v) => {
        const canvas = v.shadowRoot!.querySelector(".canvas")!;
        const r = canvas.getBoundingClientRect();
        const t = () => [new Touch({ identifier: 7, target: canvas, clientX: r.left + 30, clientY: r.top + 30 })];
        for (let i = 0; i < 2; i++) {
          const touches = t();
          canvas.dispatchEvent(
            new TouchEvent("touchstart", { touches, targetTouches: touches, changedTouches: touches, bubbles: true, composed: true }),
          );
          canvas.dispatchEvent(
            new TouchEvent("touchend", { touches: [], changedTouches: touches, bubbles: true, composed: true, cancelable: true }),
          );
        }
      });
    await doubleTap();
    expect(await zoom()).toBeCloseTo(before, 2);
    await doubleTap();
    expect(await zoom()).toBeGreaterThanOrEqual(Math.max(1, before * 2) - 0.01);
  });

  test("an inline-block element sizes to its diagram (nothing in it zeroes its intrinsic width)", async ({ page }) => {
    await page.goto("/fixtures/layout.html?chart=traffic-light.scxml");
    await page.waitForSelector("body[data-ready]");
    const { host, diagram } = await page.evaluate(() => {
      const v = document.querySelector("scxml-view")!;
      v.style.display = "inline-block";
      v.style.width = "";
      return { host: v.getBoundingClientRect().width, diagram: v.shadowRoot!.querySelector(".diagram")!.getBoundingClientRect().width };
    });
    expect(diagram).toBeGreaterThan(100);
    expect(host).toBeGreaterThanOrEqual(diagram);
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
