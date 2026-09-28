/**
 * Smoke tests for the website built into _site/ (run with `mise run site:test`, which builds
 * first). Chromium only: the library itself is tested in three engines by tests/browser.
 */
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.SITE_TEST_PORT ?? 4401);

export default defineConfig({
  testDir: ".",
  // *.pw.ts, not *.spec.ts / *.test.ts: `bun test` must not pick these up
  testMatch: /.*\.pw\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["line"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun scripts/site/serve.ts --port ${port}`,
    cwd: "../..",
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
