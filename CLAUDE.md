# To-Do app

Production-grade to-do app: Next.js PWA + Expo mobile, Supabase backend (Postgres, Auth, Realtime, Edge Functions), opt-in Google Calendar sync. Full plan: `C:\Users\Cj\.claude\plans\i-want-to-build-virtual-quilt.md`.

## Layout
- `apps/web` Next.js (App Router), `apps/mobile` Expo
- `packages/core` pure TypeScript domain logic (Zod schemas, recurrence, NLP quick-add parser, ordering, filters, task↔calendar-event mapping). No I/O, no framework imports.
- `packages/data` Supabase client, generated DB types, TanStack Query hooks, offline outbox
- `packages/ui-tokens` design tokens shared by web and mobile
- `supabase/` migrations, RLS, seed, Edge Functions

## Design
- Read `DESIGN.md` (calm minimal direction, tokens, motion, a11y) before writing any UI.

## Commands
- `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`

## Conventions
- Domain logic only in `packages/core`; components and Edge Functions call it, never reimplement it.
- TDD: failing test first (`/ecc:tdd-workflow`). Core coverage target 90%+, overall 80%+.
- Strict TypeScript, no `any`, no `console.log` in `packages/core`. Validate all external input with Zod.
- Every table has RLS keyed on workspace membership. Run the Supabase advisors after each migration.
- Migrations: edit in place only while they have never been applied to a hosted database. After that, add a new migration file; never rewrite an applied one.
- Synced tables are soft-deleted (`deleted_at`) and have no DELETE policy; `private.purge_deleted()` removes old tombstones. Clients cannot set `version`, timestamps or `updated_by` (the `sync_columns` trigger owns them). Order lists by `position, id`.
- Nobody is added to a workspace by a client insert (no policy on purpose): members join through the server-side invite flow. Ownership changes only via `transfer_workspace()`; a project moves workspaces only via `move_project()`.
- Account deletion must delete or transfer owned workspaces first (`workspaces.owner_id` is RESTRICT); authorship columns become NULL so shared work survives.
- Policy helpers live in the `private` schema and are used as `workspace_id in (select private.my_workspace_ids())`.
- `packages/core` uses explicit `.ts` extensions in relative imports so Deno (Edge Functions) can import it; apps import subpaths like `@todo/core/recurrence` when they need only part of it.
- DB tests (`packages/db-tests`) run migrations in PGlite; they do not replace running the advisors and a smoke test on the hosted project.
- Secrets never in client code or git. Google refresh tokens live in Supabase Vault, server-side only.
- Google Calendar sync is opt-in; `calendar_integrations.enabled` is checked first by every `gcal-*` function.
- Conventional commits; one milestone per PR (M0–M7, see plan).
