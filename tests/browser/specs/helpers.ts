import type { Page } from "@playwright/test";

/** Wait until a fixture page's module script has finished its setup. */
export async function ready(page: Page) {
  await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 15_000 });
}

/** Ids of the states `<scxml-view>` shows as active (document order); `reached` after termination. */
export function activeStates(page: Page, selector: string, mark = "active") {
  return page.evaluate(
    ([sel, mark]) => {
      const root = document.querySelector(sel)?.shadowRoot;
      if (!root) return [];
      return [...root.querySelectorAll("[data-state]")]
        .filter((el) => (el.getAttribute("part") ?? "").split(/\s+/).includes(mark))
        .map((el) => el.getAttribute("data-state"));
    },
    [selector, mark] as const,
  );
}

export function stateBox(page: Page, selector: string, id: string) {
  return page.locator(selector).locator(`[data-state="${id}"]`);
}
