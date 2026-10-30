# To-Do

A to-do app that works offline: a Next.js web app (installable as a PWA) and an Expo mobile app, on a Supabase backend. English only. Calendar sync with Google is opt-in.

- Tasks, subtasks, projects, sections, labels, saved filters, recurring tasks, quick-add in plain language
- Today, Upcoming, Calendar, Board, Search, Stats
- Shared workspaces (invite links, assignees, comments with @mentions, activity), reminders as push notifications, attachments, time tracking and focus sessions
- Works offline: edits are queued and sent when the connection returns
- Import and export (JSON, CSV), account deletion

Conventions and how each part works: [CLAUDE.md](CLAUDE.md). Look and feel: [DESIGN.md](DESIGN.md).

## Layout

| Folder | What it holds |
| --- | --- |
| `apps/web` | Next.js app (App Router) |
| `apps/mobile` | Expo app (Expo Go compatible) |
| `packages/core` | Domain logic with no I/O: recurrence, quick-add parser, ordering, filters, calendar mapping |
| `packages/data` | Database types, typed queries, TanStack Query hooks, offline write queue |
| `packages/ui-tokens` | Design tokens shared by web and mobile |
| `packages/db-tests` | Database and row-level-security tests (run in PGlite) |
| `supabase/` | Migrations, seed, Edge Functions |
| `scripts/` | End-to-end checks of the Edge Functions against the local stack |

## Run it locally

Needs Node 22 or newer, pnpm, and Docker Desktop (for the local Supabase).

```bash
pnpm install
pnpm db:start          # local Supabase; prints the keys with `pnpm db:status`
```

Create `apps/web/.env.development.local` (it is gitignored) with the local address and publishable key from `pnpm db:status`, using the variable names in `apps/web/.env.example`. Then:

```bash
pnpm --filter @todo/web dev
```

For the mobile app copy `apps/mobile/.env.example`; a phone needs your computer's network address instead of `127.0.0.1`.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @todo/web e2e      # Playwright and accessibility scans; needs pnpm db:start and nothing on port 3000
pnpm --filter @todo/mobile build # bundles Android, a quick compile check
```

CI (`.github/workflows`) runs typecheck, lint, tests and the build on every push, and a separate workflow runs the e2e against a local Supabase in a production build.

## Going live

Nothing below is done by code in this repository; each step needs your own accounts and keys. Secrets are never committed.

1. **Database.** The hosted project has only the first three migrations. Apply the rest in order, then run the Supabase advisors and a smoke test. Regenerate `packages/data/src/database.types.ts` after any migration.
2. **Edge Functions.** Deploy `delete-account`, `gcal-connect`, `gcal-disconnect`, `gcal-sync` and `send-reminders`. Set their secrets (names are listed in [CLAUDE.md](CLAUDE.md): `REMINDERS_CRON_SECRET`, `GCAL_*`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and the Vault entries the two cron jobs read. Generate each secret with at least 32 random bytes.
3. **Google Calendar (optional).** Create an OAuth client in Google Cloud and register the `gcal-connect` address as its redirect. The scope is `calendar.app.created`. Test it with a real account before telling anyone it works.
4. **Web.** Deploy `apps/web` (for example on Vercel) with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The service-role key never goes into either app.
5. **Mobile.** Builds go through `apps/mobile/eas.json`; push notifications need an EAS project id (`eas init`) and a development build. App ids are `com.cjgdizon.todo` and cannot change once published.
6. **Backups and error tracking.** Turn on database backups for the hosted project; error tracking (such as Sentry) is not set up yet.

## Not built yet

Webhooks from Google Calendar (changes are polled each minute), importing events made in Google, mobile attachments, mobile live updates. Unverified: the mobile app on a real device, and Google sync with a real account.
