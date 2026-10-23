// Builds the web app for the e2e tests: same as `next build`, but with the local Supabase address
// from .env.development.local. (Next bakes NEXT_PUBLIC_* values in at build time and would
// otherwise read .env.local, which may point at the hosted project.)
import { spawnSync } from "node:child_process";
import process from "node:process";

process.loadEnvFile(".env.development.local");
const build = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], { stdio: "inherit" });
process.exit(build.status ?? 1);
