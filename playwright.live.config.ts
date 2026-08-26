import { defineConfig, devices } from "@playwright/test";

/**
 * Live-API Playwright suite: drives the real Greenroom stack (API
 * server + harness bridge + built web app + temp git repo) with no route
 * mocking. The stack is booted by tests/live/stack.ts inside the suite, so
 * there is no Playwright-managed webServer here. Run `bun run web:build`
 * first, or use `bun run test:ui:live` which does both.
 *
 * The mocked browser suite stays on playwright.config.ts (`bun run test:ui`)
 * and is unaffected by this config.
 */
export default defineConfig({
  testDir: "./tests/live",
  testMatch: "*.playwright.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium-live",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
