import { createRequire } from "node:module";
import { expect, type Page, test } from "@playwright/test";
import { ready } from "./helpers";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

interface AxeResult {
  violations: { id: string; impact: string; help: string; nodes: { target: unknown[] }[] }[];
  passes: unknown[];
}

/** Run axe-core (WCAG 2.2 A/AA + best practices) over the page, shadow roots included. */
async function audit(page: Page, include: string) {
  await page.addScriptTag({ path: axePath });
  const result = (await page.evaluate(
    (sel) =>
      (window as any).axe.run(
        { include: [sel] },
        { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } },
      ),
    include,
  )) as AxeResult;
  const summary = result.violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}× ${JSON.stringify(v.nodes[0]?.target)})`);
  return { summary, passes: result.passes.length };
}

const scenarios: [string, (page: Page) => Promise<void>][] = [
  ["explorer, machine level", async () => {}],
  ["explorer, System level", async (page) => page.locator("#wide [part~=levels] button", { hasText: "System" }).click()],
  ["explorer, state detail", async (page) => page.locator("#wide [part~=tree-row]", { hasText: "stopped" }).click()],
  [
    "explorer, running (parallel lanes)",
    async (page) => page.evaluate(() => (window as any).__session.send("play")).then(() => page.locator("#wide [part~=step]").click()),
  ],
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`accessibility (axe-core), ${scheme}`, () => {
    for (const [name, setup] of scenarios) {
      test(name, async ({ page }, info) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto("/fixtures/explorer.html");
        await ready(page);
        await setup(page);
        const { summary, passes } = await audit(page, "scxml-explorer");
        info.annotations.push({ type: "axe", description: `${passes} rules passed, ${summary.length} violated` });
        expect(summary).toEqual([]);
      });
    }

    test("view, all three data paths", async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/fixtures/view.html");
      await ready(page);
      await expect(page.locator("#src [data-state=red]")).toBeVisible();
      const { summary, passes } = await audit(page, "scxml-view");
      info.annotations.push({ type: "axe", description: `${passes} rules passed, ${summary.length} violated` });
      expect(summary).toEqual([]);
    });

    test("explorer, playground sample with the Tinyactors theme", async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/explorer?sample=fulfillment&paused=1");
      await expect(page.locator("scxml-explorer [part~=tree-row]").first()).toBeVisible();
      const { summary, passes } = await audit(page, "scxml-explorer");
      info.annotations.push({ type: "axe", description: `${passes} rules passed, ${summary.length} violated` });
      expect(summary).toEqual([]);
    });
  });
}
