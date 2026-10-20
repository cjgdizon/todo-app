# Contributing

A to-do list app: React frontend (not built yet), Node/Express API, SQLite storage.
Today only the API's "add a task" endpoint exists.

## Setup

Prerequisites: Node.js (developed on v24) and npm.

```bash
npm install
```

`better-sqlite3` compiles or downloads a native binary during install. If npm reports
that install scripts were skipped, run `npm install-scripts approve better-sqlite3`.

## Scripts

<!-- AUTO-GENERATED: package.json scripts -->
| Command | Where | Description |
|---------|-------|-------------|
| `npm run dev` | repo root | Starts the API server (delegates to `npm run dev -w server`) |
| `npm run dev` | `server/` | Starts the API with `tsx src/index.ts` on `http://localhost:3000` |
| `npm test` | repo root | Runs the server test suite (delegates to `npm test -w server`) |
| `npm test` | `server/` | Runs all tests once with Vitest |
| `npm run test:coverage` | `server/` | Runs all tests once and prints a V8 coverage report |
<!-- /AUTO-GENERATED -->

The dev server reads two optional environment variables: `PORT` (default `3000`) and
`DB_PATH` (default `todo.db`, created in the directory you run it from; git ignores it).

There is no lint or build script yet.

## Testing

- Tests live next to the code they cover (`foo.ts` and `foo.test.ts`) in `server/src/`.
- API tests use Supertest against `createApp(db)` with an in-memory database
  (`openDb(':memory:')`), so they need no setup and leave no files behind.
- Work test-first: write a failing test, confirm it fails for the right reason, make the
  smallest change that passes, then refactor.
- Keep coverage at 80% or higher: `npm run test:coverage -w server`.
- Typecheck with `npx tsc --noEmit -p server`.

## API reference

<!-- AUTO-GENERATED: server/src/tasks.routes.ts -->
| Method | Path | Request body | Success | Errors |
|--------|------|--------------|---------|--------|
| POST | `/api/tasks` | `{ "title": string }` (1 to 200 characters after trimming) | `201` with the created task | `400` invalid or empty title or malformed JSON, `413` body over 10 KB, `415` unsupported content encoding |
<!-- /AUTO-GENERATED -->

A task looks like:

```json
{
  "id": 1,
  "title": "Buy milk",
  "completed": false,
  "createdAt": "2026-10-20T08:42:41.123Z",
  "updatedAt": "2026-10-20T08:42:41.123Z"
}
```

Every error uses one shape: `{ "error": { "message": "..." } }`. Unknown routes return
`404` in the same shape. Unexpected failures return `500` with a generic message.

## Pull request checklist

- [ ] Tests were written first and pass (`npm test`)
- [ ] Coverage is still 80% or higher
- [ ] `npx tsc --noEmit -p server` is clean
- [ ] User input is validated with zod and SQL uses parameterized queries
- [ ] No secrets or `console.log` debugging left in the code
