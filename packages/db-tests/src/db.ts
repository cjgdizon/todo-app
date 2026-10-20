import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

/**
 * Minimal stand-in for the parts of Supabase the migrations depend on: the API
 * roles, the `auth` schema, `auth.uid()` (driven by a request-scoped setting,
 * like PostgREST does) and Supabase's default grants on `public`.
 */
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

/** Fresh in-memory database with every migration applied, in filename order. */
export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(MIGRATIONS_DIR + file, "utf8"));
  }
  return db;
}

/** Creates an auth user (as superuser) and returns its id. The sign-up trigger runs. */
export async function signUp(db: PGlite, email: string, fullName?: string): Promise<string> {
  const meta = fullName ? { full_name: fullName } : {};
  const res = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id",
    [email, JSON.stringify(meta)],
  );
  const row = res.rows[0];
  if (!row) throw new Error("sign-up returned no row");
  return row.id;
}

async function withRole<T>(db: PGlite, role: string, uid: string | null, fn: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

/** Runs `fn` as the `authenticated` API role acting as user `uid` (RLS applies). */
export function asUser<T>(db: PGlite, uid: string, fn: () => Promise<T>): Promise<T> {
  return withRole(db, "authenticated", uid, fn);
}

/** Runs `fn` as the `anon` API role (no signed-in user). */
export function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  return withRole(db, "anon", null, fn);
}

let emailCounter = 0;
/** A unique test email address. */
export const uniqueEmail = (prefix: string) => `${prefix}-${++emailCounter}@example.com`;

/**
 * Adds a member the way the server-side invite flow will (as superuser). Clients
 * cannot insert memberships themselves; that is deliberate.
 */
export async function addMember(
  db: PGlite,
  workspaceId: string,
  userId: string,
  role: "admin" | "member" = "member",
): Promise<void> {
  await db.query(
    "insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, $3)",
    [workspaceId, userId, role],
  );
}

/** Inserts a task as `uid` into workspace `ws` and returns its id. */
export async function addTask(
  db: PGlite,
  uid: string,
  ws: string,
  title = "Buy milk",
  position = "a0",
): Promise<string> {
  return asUser(db, uid, async () => {
    const res = await db.query<{ id: string }>(
      `insert into public.tasks (workspace_id, title, position, created_by)
       values ($1, $2, $3, $4) returning id`,
      [ws, title, position, uid],
    );
    return res.rows[0]!.id;
  });
}

/** The id of the "Personal" workspace created at sign-up. */
export async function personalWorkspace(db: PGlite, uid: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    "select id from public.workspaces where owner_id = $1 and name = 'Personal'",
    [uid],
  );
  const row = res.rows[0];
  if (!row) throw new Error("no personal workspace");
  return row.id;
}
