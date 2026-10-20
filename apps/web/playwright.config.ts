import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

// `pnpm e2e` runs from apps/web. The dev env file points the app at local Supabase.
const envFile = join(process.cwd(), ".env.development.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

// These tests sign up real users, so they must never reach the hosted project.
const host = supabaseUrl ? new URL(supabaseUrl).hostname : "";
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(
    "The e2e tests create users and only run against local Supabase. " +
      "Start it with `pnpm db:start` and keep apps/web/.env.development.local pointing at it.",
  );
}

const PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  // One worker: the specs share one dev server and one local database.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node node_modules/next/dist/bin/next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    },
  },
});
