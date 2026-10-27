/* global console, fetch, setTimeout */
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
} finally {
  cleanup();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
