/* global console, fetch, setTimeout */
// End-to-end check of account deletion against the LOCAL Supabase stack (real sign-ups, real
// Storage, the real `delete-account` Edge Function). Walks through: refused without a login or the
// typed confirmation, refused while a shared workspace is still owned, then allowed after handing it
// over, with the person's own files and data gone and the shared work left in place.
//
// Needs Docker Desktop and `pnpm db:start`. Run:  node scripts/account-check/check.mjs
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const API = "http://127.0.0.1:54321";
const FUNCTION_URL = `${API}/functions/v1/delete-account`;
const repoRoot = resolve(import.meta.dirname, "..", "..");

const dbContainer = execFileSync("docker", ["ps", "--filter", "name=supabase_db", "--format", "{{.Names}}"]).toString().trim().split("\n")[0];
if (!dbContainer) throw new Error("The local Supabase database is not running (pnpm db:start).");
const psql = (sql) => execFileSync("docker", ["exec", dbContainer, "psql", "-U", "postgres", "-tA", "-c", sql]).toString().trim();
const keys = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], { cwd: repoRoot, shell: true }).toString());
const apikey = keys.PUBLISHABLE_KEY ?? keys.ANON_KEY;

let failures = 0;
function expect(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures += 1;
}

async function signUp(label) {
  const response = await fetch(`${API}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `acct-${label}-${randomBytes(4).toString("hex")}@example.test`, password: `pw-${randomBytes(12).toString("hex")}` }),
  }).then((r) => r.json());
  return { id: response.user.id, jwt: response.access_token };
}

const upload = (jwt, path, text) =>
  fetch(`${API}/storage/v1/object/attachments/${path}`, {
    method: "POST",
    headers: { apikey, Authorization: `Bearer ${jwt}`, "Content-Type": "text/plain" },
    body: text,
  });
const objectExists = (path) => psql(`select count(*) from storage.objects where bucket_id = 'attachments' and name = '${path}'`) === "1";
const call = (jwt, body) =>
  fetch(FUNCTION_URL, { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }).then(
    async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }),
  );

const envFile = join(mkdtempSync(join(tmpdir(), "account-check-")), "functions.env");
writeFileSync(envFile, "WEB_APP_URL=http://localhost:3000\n");
const serve = spawn("pnpm", ["exec", "supabase", "functions", "serve", "--env-file", envFile], { cwd: repoRoot, shell: true, stdio: "ignore" });
const cleanup = () => {
  try {
    execFileSync("taskkill", ["/pid", String(serve.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    serve.kill();
  }
};

try {
  for (let waited = 0; ; waited += 3) {
    const status = await call(null, {}).then((r) => r.status, () => 0);
    if (status === 401) break;
    if (waited > 150) throw new Error("The function did not start in time.");
    await new Promise((r) => setTimeout(r, 3000));
  }

  const me = await signUp("me");
  const colleague = await signUp("colleague");
  const personal = psql(`select id from public.workspaces where owner_id = '${me.id}'`);
  const task = (ws, owner, title) =>
    psql(`insert into public.tasks (workspace_id, title, position, created_by) values ('${ws}', '${title}', 'a0', '${owner}') returning id`).split("\n")[0];
  const attach = async (jwt, ws, taskId, userId, name) => {
    const path = `${taskId}/${randomUUID()}-${name}`;
    const stored = await upload(jwt, path, `contents of ${name}`);
    psql(`insert into public.attachments (workspace_id, task_id, created_by, storage_path, file_name, size_bytes) values ('${ws}', '${taskId}', '${userId}', '${path}', '${name}', 10)`);
    return { path, ok: stored.ok };
  };

  const mine = task(personal, me.id, "My private task");
  const myFile = await attach(me.jwt, personal, mine, me.id, "mine.txt");
  const team = psql(`insert into public.workspaces (name, owner_id) values ('Team', '${me.id}') returning id`).split("\n")[0];
  psql(`insert into public.workspace_members (workspace_id, user_id, role) values ('${team}', '${colleague.id}', 'member')`);
  const teamTask = task(team, me.id, "Shared task");
  const teamFile = await attach(me.jwt, team, teamTask, me.id, "team.txt");
  expect("the test files were stored", myFile.ok && teamFile.ok && objectExists(myFile.path) && objectExists(teamFile.path));

  expect("deleting needs a login", (await call(null, { confirm: "delete my account" })).status === 401);
  expect("and the exact typed confirmation", (await call(me.jwt, { confirm: "yes" })).status === 400 && (await call(me.jwt, {})).status === 400);

  const blocked = await call(me.jwt, { confirm: "delete my account" });
  expect("a shared workspace still owned blocks it", blocked.status === 409, JSON.stringify(blocked));
  expect(
    "and nothing was deleted by the refusal",
    psql(`select count(*) from auth.users where id = '${me.id}'`) === "1" && psql(`select count(*) from public.workspaces where id = '${personal}'`) === "1" && objectExists(myFile.path),
  );

  const blockers = await fetch(`${API}/rest/v1/rpc/account_deletion_blockers`, { method: "POST", headers: { apikey, Authorization: `Bearer ${me.jwt}`, "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
  expect("the app can list what must be handed over", Array.isArray(blockers) && blockers.length === 1 && blockers[0].name === "Team", JSON.stringify(blockers));

  const handed = await fetch(`${API}/rest/v1/rpc/transfer_workspace`, { method: "POST", headers: { apikey, Authorization: `Bearer ${me.jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ ws: team, new_owner: colleague.id }) });
  expect("the workspace can be handed over", handed.ok, String(handed.status));

  const done = await call(me.jwt, { confirm: "delete my account" });
  expect("after that the account is deleted", done.status === 200 && done.body.deleted === true, JSON.stringify(done));
  expect("the login is gone", psql(`select count(*) from auth.users where id = '${me.id}'`) === "0");
  expect("their unshared workspace and its task are gone", psql(`select count(*) from public.workspaces where id = '${personal}'`) === "0" && psql(`select count(*) from public.tasks where id = '${mine}'`) === "0");
  expect("their private file is removed from Storage", !objectExists(myFile.path) && done.body.filesRemoved === 1, JSON.stringify(done.body));
  expect("the shared workspace lives on, owned by the colleague", psql(`select owner_id from public.workspaces where id = '${team}'`) === colleague.id);
  expect("the shared task stays, without their name", psql(`select count(*) from public.tasks where id = '${teamTask}' and created_by is null`) === "1");
  expect("and the shared file stays in Storage", objectExists(teamFile.path) && psql(`select count(*) from public.attachments where storage_path = '${teamFile.path}' and created_by is null`) === "1");
  expect("the colleague is untouched", psql(`select count(*) from auth.users where id = '${colleague.id}'`) === "1");
} finally {
  cleanup();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
