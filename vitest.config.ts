import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const sourcePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Workspace-source aliases shared by the unit and CLI-acceptance configs. */
export const greenroomTestAliases = [
  { find: /^@greenroom\/core\/(.+)$/u, replacement: sourcePath("./packages/core/src/$1.ts") },
  { find: "@greenroom/core", replacement: sourcePath("./packages/core/src/index.ts") },
  { find: /^@greenroom\/git\/(.+)$/u, replacement: sourcePath("./packages/git/src/$1.ts") },
  { find: "@greenroom/git", replacement: sourcePath("./packages/git/src/index.ts") },
  { find: /^@greenroom\/mcp\/(.+)$/u, replacement: sourcePath("./packages/mcp/src/$1.ts") },
  { find: "@greenroom/mcp", replacement: sourcePath("./packages/mcp/src/index.ts") },
  {
    find: /^@greenroom\/schemas\/(.+)$/u,
    replacement: sourcePath("./packages/schemas/src/$1.ts"),
  },
  { find: "@greenroom/schemas", replacement: sourcePath("./packages/schemas/src/index.ts") },
  { find: /^@greenroom\/server\/(.+)$/u, replacement: sourcePath("./apps/server/src/$1.ts") },
  { find: "@greenroom/server", replacement: sourcePath("./apps/server/src/index.ts") },
  {
    find: /^@greenroom\/supervisor\/(.+)$/u,
    replacement: sourcePath("./packages/supervisor/src/$1.ts"),
  },
  {
    find: "@greenroom/supervisor",
    replacement: sourcePath("./packages/supervisor/src/index.ts"),
  },
];

export default defineConfig({
  resolve: {
    alias: greenroomTestAliases,
  },
  test: {
    coverage: {
      exclude: [
        "**/*.config.*",
        "**/*.d.ts",
        "**/*.{test,spec}.{ts,tsx}",
        "coverage/**",
        "dist/**",
        "node_modules/**",
      ],
      include: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "tests/support/**/*.{ts,tsx}"],
      provider: "istanbul",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
    },
    environment: "node",
    globals: false,
    include: [
      "apps/**/*.{test,spec}.{ts,tsx}",
      "packages/**/*.{test,spec}.{ts,tsx}",
      "tests/**/*.{test,spec}.{ts,tsx}",
    ],
    // The CLI acceptance test spawns the real `greenroom up` process
    // tree and may build the web app once; it runs via `bun run test:cli`
    // (vitest.cli.config.ts) instead of the default unit suite.
    exclude: [...configDefaults.exclude, "tests/cli.acceptance.test.ts"],
  },
});
