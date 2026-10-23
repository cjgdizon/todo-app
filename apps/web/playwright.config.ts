import { defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

// A production build has the Supabase address baked in when it is built (from .env.local, which
// may point at the hosted project), so the check above cannot see it. Check the build itself.
if (process.env.E2E_SERVER === "start") {
  const built = join(process.cwd(), ".next", "static");
  const bakedIn =
    existsSync(built) &&
    (readdirSync(built, { recursive: true, encoding: "utf8" }) as string[])
      .filter((file) => file.endsWith(".js"))
      .some((file) => readFileSync(join(built, file), "utf8").includes(supabaseUrl));
  if (!bakedIn) {
    throw new Error(
      "The production build does not point at local Supabase, so the tests would sign up users " +
        "elsewhere. Build it with `pnpm --filter @todo/web build:e2e` first.",
    );
  }
}

const PORT = 3000;

// CI builds the app first and serves it with `next start`: dev mode compiles each route on first
// visit, which is slow on a cold runner. Locally the default is the dev server.
const serverCommand =
  process.env.E2E_SERVER === "start"
    ? `node node_modules/next/dist/bin/next start -p ${PORT}`
    : `node node_modules/next/dist/bin/next dev -p ${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // One worker: the specs share one server and one local database.
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
    command: serverCommand,
    url: `http://localhost:${PORT}/login`,
    // Never reuse a server that is already running: the guard above only sees this process's
    // environment, and a running production build may have a different Supabase address baked in.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    },
  },
});
