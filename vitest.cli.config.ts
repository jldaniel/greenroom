import { defineConfig } from "vitest/config";

import { greenroomTestAliases } from "./vitest.config";

/**
 * Config for the end-to-end CLI acceptance test, which spawns the
 * real `greenroom up` process tree against a temp data dir. Kept out of the
 * default unit run (see the exclude in vitest.config.ts); run it with
 * `bun run test:cli`.
 */
export default defineConfig({
  resolve: {
    alias: greenroomTestAliases,
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/cli.acceptance.test.ts"],
    // Startup may build the web app once on a clean checkout.
    testTimeout: 300_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
