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
- Secrets never in client code or git. Google refresh tokens live in Supabase Vault, server-side only.
- Google Calendar sync is opt-in; `calendar_integrations.enabled` is checked first by every `gcal-*` function.
- Conventional commits; one milestone per PR (M0–M7, see plan).
