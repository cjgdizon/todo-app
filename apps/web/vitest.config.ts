import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Playwright specs in e2e/ run with `pnpm e2e`, not here.
  test: { include: ["src/**/*.test.ts"] },
});
