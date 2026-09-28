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

// ── playground ──────────────────────────────────────────────────────────
type PlaygroundHandle = { getText(): string; setText(t: string): void; session?: { configuration: { id: string }[] } };
const pg = (page: Page) => ({
  states: () =>
    page.evaluate(() => ((window as any).__playground as PlaygroundHandle).session?.configuration.map((s) => s.id).join(",") ?? ""),
  edit: (fn: (text: string) => string) =>
    page.evaluate((src) => {
      const p = (window as any).__playground as PlaygroundHandle;
      p.setText(new Function("t", `return (${src})(t)`)(p.getText()));
    }, fn.toString()),
});

test("playground: runs an example, re-runs edits, shows problems", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/playground/?example=traffic-light");
  await expect(page.locator("#pg-status")).toHaveText("Running");
  await expect(page.locator("#pg-editor .cm-editor")).toBeVisible(); // CodeMirror replaced the textarea
  const { states, edit } = pg(page);
  await expect.poll(states).toContain("red");
  // an edit re-runs the chart: start in yellow instead
  await edit((t) => t.replace('initial="red"', 'initial="yellow"'));
  await expect.poll(states).toContain("yellow");
  // a parse error: a diagnostic in the list and the editor, the last good run stays up
  await edit((t) => t.replace('<state id="green">', '<state id="green"'));
  await expect(page.locator("#pg-status")).toHaveText("Not well-formed XML");
  const problem = page.locator("#pg-problems button[data-severity=error]");
  await expect(problem).toHaveCount(1);
  await expect(page.locator("#pg-editor .cm-lintRange-error")).toHaveCount(1);
  await problem.click();
  await expect(page.locator("#pg-editor .cm-content")).toBeFocused();
  // a validation problem (unknown target) is reported too
  await edit((t) => t.replace('<state id="green"', '<state id="green">').replace('target="green"', 'target="nowhere"'));
  await expect(page.locator("#pg-status")).toContainText("Invalid");
  await expect(page.locator("#pg-problems")).toContainText("nowhere");
  expect(errors).toEqual([]);
});

test("playground: sending events, and the fake services of the gatekeeper", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/playground/?example=login");
  const { states } = pg(page);
  await expect.poll(states).toContain("signed-out");
  await page.locator("#pg-suggestions button", { hasText: "login as ada" }).click();
  await expect.poll(states).toContain("signed-in");
  await page.fill("#pg-send-name", "logout");
  await page.click("#pg-send button[type=submit]");
  await expect.poll(states).toContain("signed-out");

  await page.selectOption("#pg-example", "gatekeeper");
  await expect(page.locator("#pg-status")).toHaveText("Running");
  await page.locator("#pg-suggestions button", { hasText: "issue by mallory" }).click();
  await expect(page.locator("#pg-log")).toContainText("closed: #1", { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test("playground: a runaway script is stopped", async ({ page }) => {
  await page.goto("/playground/?example=blank");
  await expect(page.locator("#pg-status")).toHaveText("Running");
  await pg(page).edit((t) => t.replace('<assign location="count" expr="count + 1"/>', "<script>while (true) {}</script>"));
  await expect(page.locator("#pg-status")).toHaveText("Running");
  await page.locator("#pg-suggestions button", { hasText: "go" }).click();
  await expect(page.locator("#pg-notice")).toContainText("was stopped");
  await expect(page.locator("#pg-log")).toContainText("interrupted");
});

test("playground: share links round-trip; broken ones fall back to an example", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/playground/?example=microwave");
  await expect(page.locator("#pg-status")).toHaveText("Running");
  await pg(page).edit((t) => t.replace('name="microwave"', 'name="shared-oven"'));
  await page.click("#pg-share");
  await expect(page).toHaveURL(/#example=microwave&chart=[\w-]+$/);
  const url = page.url();
  await page.evaluate(() => localStorage.clear());
  await page.goto("about:blank");
  await page.goto(url);
  await expect(page.locator("#pg-notice")).toContainText("shared link");
  expect(await page.evaluate(() => ((window as any).__playground as PlaygroundHandle).getText())).toContain("shared-oven");

  await page.goto("about:blank");
  await page.goto("/playground/#example=login&chart=AAAA");
  await expect(page.locator("#pg-notice")).toContainText("couldn't be opened");
  await expect(page.locator("#pg-example")).toHaveValue("login");
  await expect(page.locator("#pg-status")).toHaveText("Running");
});

test.describe("playground at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("Edit / Diagram / Explorer tabs", async ({ page }) => {
    await page.goto("/playground/");
    await expect(page.locator("#pg-view")).toBeVisible();
    await expect(page.locator("#pg-editor")).toBeHidden();
    await page.click("[data-pg-tab=edit]");
    await expect(page.locator("#pg-editor")).toBeVisible();
    await expect(page.locator("#pg-view")).toBeHidden();
    await page.click("[data-pg-tab=explore]");
    await expect(page.locator("#pg-explorer")).toBeVisible();
  });
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
