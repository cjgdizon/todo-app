# To-Do app

Production-grade to-do app: Next.js PWA + Expo mobile, Supabase backend (Postgres, Auth, Realtime, Edge Functions), opt-in Google Calendar sync. Full plan: `C:\Users\Cj\.claude\plans\i-want-to-build-virtual-quilt.md`.

## Layout
- `apps/web` Next.js (App Router), `apps/mobile` Expo
- `packages/core` pure TypeScript domain logic (Zod schemas, recurrence, NLP quick-add parser, ordering, filters, task↔calendar-event mapping). No I/O, no framework imports.
- `packages/data` generated DB types (`database.types.ts`), Zod row parsers (`models.ts`), typed queries, TanStack Query hooks with optimistic updates; offline outbox comes in M4. Takes a Supabase client as input and never reads env itself.
- `packages/ui-tokens` design tokens shared by web and mobile. `tokens.ts` is the source; `tokens.css` is generated (`pnpm --filter @todo/ui-tokens generate`) and a test fails if it is stale. A test also checks WCAG AA contrast for every pair.
- `supabase/` migrations, RLS, seed, Edge Functions

## Design
- Read `DESIGN.md` (calm minimal direction, tokens, motion, a11y) before writing any UI.

## Commands
- `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
- Local Supabase (Docker Desktop must be running): `pnpm db:start`, `pnpm db:status` (prints the keys), `pnpm db:reset` (re-applies every migration to an empty database), `pnpm db:stop`. API `http://127.0.0.1:54321`, Postgres `127.0.0.1:54322`, mail catcher `http://127.0.0.1:54324`. Email confirmation is off locally. `apps/web/.env.development.local` (gitignored) points `next dev` at it; delete that file to use the hosted project. Local credentials and test users are fine to create here; never do so against the hosted project. The stack keeps running after `db:start` until `db:stop`.

## Conventions
- Domain logic only in `packages/core`; components and Edge Functions call it, never reimplement it.
- TDD: failing test first (`/ecc:tdd-workflow`). Core coverage target 90%+, overall 80%+.
- Strict TypeScript, no `any`, no `console.log` in `packages/core`. Validate all external input with Zod.
- Every table has RLS keyed on workspace membership. Run the Supabase advisors after each migration.
- Migrations: edit in place only while they have never been applied to a hosted database. After that, add a new migration file; never rewrite an applied one. **The first three migrations were applied to the hosted `todo-app` project on 2026-10-20, so every schema change from now on is a new file.** Hosted versions are timestamped at apply time, so they differ from the local filenames; run `supabase migration repair` once if the CLI is adopted. After a migration, regenerate `packages/data/src/database.types.ts`.
- Synced tables are soft-deleted (`deleted_at`) and have no DELETE policy; `private.purge_deleted()` removes old tombstones. Clients cannot set `version`, timestamps or `updated_by` (the `sync_columns` trigger owns them). Order lists by `position, id`.
- Nobody is added to a workspace by a client insert (no policy on purpose): members join through the server-side invite flow. Ownership changes only via `transfer_workspace()`; a project moves workspaces only via `move_project()`.
- Account deletion must delete or transfer owned workspaces first (`workspaces.owner_id` is RESTRICT); authorship columns become NULL so shared work survives.
- Policy helpers live in the `private` schema and are used as `workspace_id in (select private.my_workspace_ids())`.
- `packages/core` uses explicit `.ts` extensions in relative imports so Deno (Edge Functions) can import it; apps import subpaths like `@todo/core/recurrence` when they need only part of it.
- Recurrence rules are untrusted input: only FREQ, INTERVAL (capped per frequency), BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS, UNTIL and WKST are accepted (`validateRrule`), and searches are bounded. Never call `rrule` directly; go through `recurrence.ts`. Import `rrule` only via `rrule-compat.ts` (its named export is missing in plain Node/Deno).
- `packages/core` uses erasable TypeScript syntax only (no enums, namespaces or constructor parameter properties) so Node and Deno can run it; `esm-compat.test.ts` loads it in a plain Node process.
- Time zones are IANA names (`Asia/Manila`, `UTC`), validated by trigger in the database and by luxon in core. Text columns have length caps; add one to any new free-text column.
- Attachment files live under `<task_id>/...` (enforced by a CHECK). `anon` has no table privileges; `authenticated` has no TRUNCATE/REFERENCES/TRIGGER.
- DB tests (`packages/db-tests`) run migrations in PGlite; they do not replace running the advisors and a smoke test on the hosted project.
- Web (Next 16, `cacheComponents` on): layouts stay static. The session is read in the browser by `components/providers.tsx`; `src/proxy.ts` is only an early redirect, and row-level security is the real gate. Never read `cookies()` in a layout. `apps/web/AGENTS.md` says to read `node_modules/next/dist/docs/` before using a Next API.
- E2E: `pnpm --filter @todo/web e2e` (Playwright + axe accessibility scans, Chromium). Needs `pnpm db:start`; it starts `next dev` itself, signs up throwaway users through the real form, and refuses to run unless the Supabase URL is local. It is not in CI yet (CI has no Supabase stack). Unit tests are `src/**/*.test.ts`; the `e2e/` folder is excluded from Vitest.
- Next keeps pages you visited earlier mounted but hidden. Never rely on a fixed element `id` or `getElementById` for per-page UI (use `useId` and a visible-element lookup like `focusQuickAdd`), and scope Playwright locators to visible elements (`taskRows`, `getByRole`). The `(app)` group sets `export const instant = false` because its content only renders once the browser session is known.
- Views are pure functions of the task list (`selectView` in the web app, `dueBucket`, `groupUpcoming`, `buildTaskTree`, `planCompletion` in core). Writes go through the `@todo/data` hooks so they stay optimistic and undoable.
- Never write a `\uXXXX` escape through the editing tools: it is converted to the literal character. Build such strings from character codes.
- Secrets never in client code or git. Google refresh tokens live in Supabase Vault, server-side only.
- Google Calendar sync is opt-in; `calendar_integrations.enabled` is checked first by every `gcal-*` function.
- Conventional commits; one milestone per PR (M0–M7, see plan).
