import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // index.ts only re-exports; the tests import the modules directly.
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
