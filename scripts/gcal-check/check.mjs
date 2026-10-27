/* global console, fetch, setTimeout, URL */
// End-to-end check of the calendar sync, with no real Google involved. It starts a stand-in Google
// (mock-google.mjs), serves the real `gcal-sync` Edge Function in the local Supabase runtime,
// seeds a throwaway user in the LOCAL database, and walks through the plan's scenario:
// connect -> tasks become events -> edit either side -> cancel/complete -> disable -> revoke.
//
// Needs Docker Desktop and `pnpm db:start`. Run:  node scripts/gcal-check/check.mjs
// It refuses to run against anything but the local stack (it talks to 127.0.0.1 only).
import { execFileSync, spawn } from "node:child_process";
import process from "node:process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startMockGoogle } from "./mock-google.mjs";

const PORT = 9922;
const SECRET = `check-${randomBytes(16).toString("hex")}`;
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/gcal-sync";
const MOCK = `http://127.0.0.1:${PORT}`;
const MOCK_FROM_DOCKER = `http://host.docker.internal:${PORT}`;
const repoRoot = resolve(import.meta.dirname, "..", "..");

const dbContainer = execFileSync("docker", ["ps", "--filter", "name=supabase_db", "--format", "{{.Names}}"])
  .toString()
  .trim()
  .split("\n")[0];
if (!dbContainer) throw new Error("The local Supabase database is not running (pnpm db:start).");
const psql = (sql) => execFileSync("docker", ["exec", dbContainer, "psql", "-U", "postgres", "-tA", "-c", sql]).toString().trim();

let failures = 0;
function expect(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures += 1;
}

const run = async (secret = SECRET) => {
  const response = await fetch(FUNCTION_URL, { method: "POST", headers: { "x-cron-secret": secret } });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};
const googleState = async () => (await (await fetch(`${MOCK}/_state`)).json());
const googleRequests = async () => (await (await fetch(`${MOCK}/_requests`)).json());
const editInGoogle = (id, changes) => fetch(`${MOCK}/_edit/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(changes) });

// --- set up -----------------------------------------------------------------------------------
const { server } = await startMockGoogle(PORT);
const envFile = join(mkdtempSync(join(tmpdir(), "gcal-check-")), "functions.env");
writeFileSync(
  envFile,
  [
    `GCAL_CRON_SECRET=${SECRET}`,
    "GOOGLE_CLIENT_ID=check-client",
    "GOOGLE_CLIENT_SECRET=check-secret",
    `GOOGLE_API_BASE=${MOCK_FROM_DOCKER}/calendar/v3`,
    `GOOGLE_TOKEN_URL=${MOCK_FROM_DOCKER}/token`,
    `GOOGLE_REVOKE_URL=${MOCK_FROM_DOCKER}/revoke`,
    `GOOGLE_AUTH_URL=${MOCK}/auth`,
    "GCAL_RETURN_URL=http://localhost:3000/settings",
    "GCAL_REDIRECT_URI=http://127.0.0.1:54321/functions/v1/gcal-connect",
    `GCAL_STATE_SECRET=${randomBytes(24).toString("hex")}`,
  ].join("\n"),
);
const serve = spawn("pnpm", ["exec", "supabase", "functions", "serve", "--env-file", envFile], { cwd: repoRoot, shell: true, stdio: "ignore" });
const cleanup = () => {
  server.close();
  try {
    execFileSync("taskkill", ["/pid", String(serve.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    serve.kill();
  }
};

try {
  for (let waited = 0; ; waited += 2) {
    const ready = await fetch(FUNCTION_URL).then((r) => r.status === 405 || r.status === 401, () => false);
    if (ready) break;
    if (waited > 150) throw new Error("The function did not start in time.");
    await new Promise((r) => setTimeout(r, 2000));
  }

  // The first request can arrive while the runtime is still fetching its libraries and fail with a
  // gateway error; wait for a real answer before the scenario starts.
  for (let waited = 0; ; waited += 3) {
    const warm = await run().catch(() => ({ status: 0 }));
    if (warm.status === 200) break;
    if (waited > 150) throw new Error("The function never answered properly.");
    await new Promise((r) => setTimeout(r, 3000));
  }

  const userId = randomUUID();
  psql(`insert into auth.users (id, email) values ('${userId}', 'gcal-check-${randomBytes(4).toString("hex")}@example.test')`);
  const ws = psql(`select id from public.workspaces where owner_id = '${userId}'`);
  const task = (title, extra) =>
    psql(`insert into public.tasks (workspace_id, title, position, created_by, ${extra.columns}) values ('${ws}', '${title}', 'a0', '${userId}', ${extra.values}) returning id`).split("\n")[0];
  const timed = task("Timed task", { columns: "due_at, due_tz", values: "'2030-03-15T02:30:00Z', 'Asia/Manila'" });
  const allDay = task("All-day task", { columns: "due_at, due_all_day, due_tz", values: "'2030-03-14T16:00:00Z', true, 'Asia/Manila'" });
  const weekly = task("Weekly task", { columns: "due_at, due_tz, rrule", values: "'2030-03-18T01:00:00Z', 'UTC', 'FREQ=WEEKLY;BYDAY=MO'" });
  task("Task without a date", { columns: "notes", values: "null" });
  const connect = (token) => psql(`select public.save_calendar_connection('${userId}', '${ws}', '${token}', 'cal-check')`);
  const link = (taskId) => psql(`select google_event_id from public.task_calendar_links where task_id = '${taskId}' and user_id = '${userId}'`);
  const field = (taskId, column) => psql(`select ${column} from public.tasks where id = '${taskId}'`);
  connect("good-refresh-token");

  // --- the scenario ---------------------------------------------------------------------------
  expect("a wrong secret is refused", (await run("nope")).status === 401);

  let result = await run();
  const events = await googleState();
  expect("tasks with a due date become events, the one without does not", events.length === 3, `got ${events.length}`);
  expect("a timed task is a timed event in its own zone", events.some((e) => e.summary === "Timed task" && e.start?.timeZone === "Asia/Manila" && e.start?.dateTime === "2030-03-15T02:30:00.000Z"));
  expect("an all-day task is an all-day event", events.some((e) => e.summary === "All-day task" && e.start?.date === "2030-03-15" && e.end?.date === "2030-03-16"));
  expect("a repeating task keeps its rule", events.some((e) => e.summary === "Weekly task" && e.recurrence?.[0] === "RRULE:FREQ=WEEKLY;BYDAY=MO"));
  expect("the first run sent them and applied nothing back", result.body.sent === 3 && result.body.applied === 0, JSON.stringify(result.body));
  expect("each event is linked to its task", [timed, allDay, weekly].every((id) => link(id) !== ""));

  result = await run();
  expect("running again does nothing (no echo)", result.body.sent === 0 && result.body.applied === 0, JSON.stringify(result.body));

  psql(`update public.tasks set title = 'Timed task renamed' where id = '${timed}'`);
  result = await run();
  expect("a change in the app reaches Google", (await googleState()).some((e) => e.summary === "Timed task renamed") && result.body.sent === 1, JSON.stringify(result.body));

  await editInGoogle(link(timed), { summary: "Renamed in Google", start: { dateTime: "2030-03-16T03:00:00Z", timeZone: "Asia/Manila" } });
  result = await run();
  expect("a change in Google reaches the task", field(timed, "title") === "Renamed in Google" && field(timed, "due_at").includes("2030-03-16 03:00:00"), `${field(timed, "title")} / ${field(timed, "due_at")}`);
  expect("and is applied once", result.body.applied === 1, JSON.stringify(result.body));
  result = await run();
  expect("without bouncing back", result.body.sent === 0 && result.body.applied === 0, JSON.stringify(result.body));

  await editInGoogle(link(allDay), { status: "cancelled" });
  result = await run();
  expect("cancelling an event removes the task's due date, not the task", field(allDay, "due_at") === "" && field(allDay, "title") === "All-day task");
  expect("and unlinks it", link(allDay) === "");

  const weeklyEvent = link(weekly);
  psql(`update public.tasks set completed_at = now() where id = '${weekly}'`);
  await run();
  expect("finishing a task removes its event", (await googleState()).find((e) => e.id === weeklyEvent)?.status === "cancelled" && link(weekly) === "");

  await googleRequests();
  psql(`update public.calendar_integrations set enabled = false where user_id = '${userId}'`);
  psql(`update public.tasks set title = 'Changed while off' where id = '${timed}'`);
  result = await run();
  const calls = (await googleRequests()).filter((request) => request.includes("/calendar/"));
  expect("with sync switched off nothing is sent to Google", result.body.people === 0 && calls.length === 0, `${JSON.stringify(result.body)} ${calls.join(",")}`);
  expect("and nothing is queued while it is off", psql(`select count(*) from public.calendar_sync_queue where user_id = '${userId}'`) === "0");

  connect("good-refresh-token");
  psql(`update public.calendar_integrations set sync_token = 'expired' where user_id = '${userId}'`);
  result = await run();
  expect("an expired sync token is recovered from", result.body.failed === 0 && psql(`select sync_token from public.calendar_integrations where user_id = '${userId}'`).startsWith("sync-"), JSON.stringify(result.body));

  connect("revoked-token");
  result = await run();
  const after = psql(`select enabled::text || ',' || status || ',' || coalesce(status_detail, '') from public.calendar_integrations where user_id = '${userId}'`);
  expect("a revoked grant switches sync off with a clear status", after.startsWith("false,revoked"), `${after} / ${JSON.stringify(result.body)}`);

  psql(`select public.disconnect_calendar('${userId}')`);
  expect("disconnecting removes the integration and its stored token", psql(`select count(*) from public.calendar_integrations where user_id = '${userId}'`) === "0");
  // --- connecting and disconnecting through the real functions ----------------------------------
  const keys = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], { cwd: repoRoot, shell: true }).toString());
  const publishable = keys.PUBLISHABLE_KEY ?? keys.ANON_KEY;
  const email = `gcal-connect-${randomBytes(4).toString("hex")}@example.test`;
  const signUp = await fetch("http://127.0.0.1:54321/auth/v1/signup", {
    method: "POST",
    headers: { apikey: publishable, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: `pw-${randomBytes(12).toString("hex")}` }),
  }).then((r) => r.json());
  const jwt = signUp.access_token;
  const person = signUp.user?.id;
  const personWs = psql(`select id from public.workspaces where owner_id = '${person}'`);
  const CONNECT_URL = "http://127.0.0.1:54321/functions/v1/gcal-connect";
  const DISCONNECT_URL = "http://127.0.0.1:54321/functions/v1/gcal-disconnect";
  const post = (url, body, token = jwt) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const integration = () => psql(`select count(*) from public.calendar_integrations where user_id = '${person}'`);
  const callback = (query) => fetch(`${CONNECT_URL}?${query}`, { redirect: "manual" });
  const startFlow = async () => new URL((await (await post(CONNECT_URL, { workspaceId: personWs })).json()).url);

  expect("a signed-in test user exists", Boolean(jwt && person && personWs));
  expect("starting the flow needs a login", (await post(CONNECT_URL, { workspaceId: personWs }, null)).status === 401);
  expect("and a workspace the person belongs to", (await post(CONNECT_URL, { workspaceId: ws })).status === 403);
  expect("and a valid workspace id", (await post(CONNECT_URL, { workspaceId: "not-a-uuid" })).status === 400);

  const consent = await startFlow();
  expect("it returns Google's consent address, asking for the calendar and a refresh token",
    consent.origin + consent.pathname === `${MOCK}/auth` && consent.searchParams.get("scope")?.includes("calendar") && consent.searchParams.get("access_type") === "offline" && consent.searchParams.get("client_id") === "check-client",
    consent.toString());
  const state = consent.searchParams.get("state") ?? "";

  expect("a tampered state is refused", (await callback(`code=good-code&state=${state.slice(0, -3)}AAA`)).status === 400);
  expect("a missing state is refused", (await callback("code=good-code")).status === 400);
  expect("nothing was connected by those", integration() === "0");

  const denied = await callback(`error=access_denied&state=${state}`);
  expect("declining on Google's screen returns to the app with a clear outcome", denied.status === 302 && denied.headers.get("location")?.includes("calendar=denied") === true);
  const badCode = await callback(`code=bad-code&state=${(await startFlow()).searchParams.get("state")}`);
  expect("a code Google rejects fails safely", badCode.status === 302 && badCode.headers.get("location")?.includes("calendar=failed") === true && integration() === "0");

  await googleRequests();
  const done = await callback(`code=good-code&state=${(await startFlow()).searchParams.get("state")}`);
  const target = done.headers.get("location") ?? "";
  expect("a good return connects and goes back to the app at the configured address", done.status === 302 && target.startsWith("http://localhost:3000/settings") && target.includes("calendar=connected"), target);
  expect("the dedicated calendar was made and the person is connected", integration() === "1" && psql(`select calendar_id || ',' || enabled::text from public.calendar_integrations where user_id = '${person}'`) === "cal-created,true");
  const created = (await googleRequests()).filter((r) => r === "POST /calendar/v3/calendars").length;
  expect("exactly one calendar was created", created === 1, String(created));

  psql(`insert into public.tasks (workspace_id, title, position, created_by, due_at, due_tz) values ('${personWs}', 'After connecting', 'a0', '${person}', '2030-04-01T01:00:00Z', 'UTC')`);
  await run();
  expect("after connecting, the person's tasks are synced", (await googleState()).some((e) => e.summary === "After connecting"));

  await googleRequests();
  await callback(`code=good-code&state=${(await startFlow()).searchParams.get("state")}`);
  expect("connecting again keeps the same calendar", (await googleRequests()).filter((r) => r === "POST /calendar/v3/calendars").length === 0 && integration() === "1");

  expect("disconnecting needs a login", (await post(DISCONNECT_URL, { removeEvents: false }, null)).status === 401);
  const kept = await (await post(DISCONNECT_URL, { removeEvents: false })).json();
  expect("disconnecting can keep the events in Google", kept.disconnected === true && kept.removedEvents === false && integration() === "0" && (await googleRequests()).every((r) => !r.startsWith("DELETE /calendar/v3/calendars/cal-created") || r.includes("/events")));

  await callback(`code=good-code&state=${(await startFlow()).searchParams.get("state")}`);
  await googleRequests();
  const removed = await (await post(DISCONNECT_URL, { removeEvents: true })).json();
  const removalCalls = await googleRequests();
  expect("or remove them, by deleting the dedicated calendar and revoking access", removed.removedEvents === true && removalCalls.includes("DELETE /calendar/v3/calendars/cal-created") && removalCalls.includes("POST /revoke") && integration() === "0", removalCalls.join(","));
  expect("and no token is left behind", psql("select count(*) from vault.secrets where description = 'Google Calendar refresh token'") === "0");
} finally {
  cleanup();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
