/**
 * Browser tests for @tinyactors/scxmljs (run with `mise run test:browser`).
 *
 * Functional tests run in Chromium, Firefox and WebKit (Playwright's WebKit stands in for
 * Safari). Screenshot comparisons (tests tagged @visual) only run inside the pinned Playwright
 * Docker image (`mise run test:visual`), so the baselines don't depend on the host's fonts.
 */
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.SCXML_TEST_PORT ?? 4390);
const visual = process.env.SCXML_VISUAL === "1";

export default defineConfig({
  testDir: "./specs",
  // *.pw.ts, not *.spec.ts / *.test.ts: `bun test` must not pick these up
  testMatch: /.*\.pw\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["line"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" } },
  grep: visual ? /@visual/ : undefined,
  grepInvert: visual ? undefined : /@visual/,
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `bun tests/browser/server.ts`,
    cwd: "../..",
    env: { PORT: String(port) },
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
