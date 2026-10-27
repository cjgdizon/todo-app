// Runs the calendar sync for everyone who switched it on. The database's cron job calls this every
// minute with a shared secret (no user is signed in, so `verify_jwt = false` in config.toml).
// For each person: send the tasks that changed to Google, then read what changed in Google.
// Only an integration that is `enabled` is ever touched. Nothing sensitive is logged: counts and
// status codes only, never tokens, titles or event text.
import { createClient } from "npm:@supabase/supabase-js@2";
import { pullChanges, pushTask } from "@todo/core/calendar-engine";
import { sameSecret } from "../_shared/secret.ts";
import { calendarPort, GoogleError, refreshAccessToken } from "../_shared/google.ts";
import { taskStore } from "../_shared/store.ts";

const PEOPLE_PER_RUN = 20;
const TASKS_PER_PERSON = 100;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

interface Integration {
  user_id: string;
  workspace_id: string;
  calendar_id: string | null;
  sync_token: string | null;
}

type Db = ReturnType<typeof createClient>;

async function setStatus(db: Db, userId: string, fields: Record<string, unknown>) {
  await db.from("calendar_integrations").update({ ...fields, updated_at: new Date().toISOString() }).eq("user_id", userId);
}

/** Syncs one person. Returns how many tasks were sent and how many Google changes were applied. */
async function syncPerson(db: Db, person: Integration): Promise<{ sent: number; applied: number }> {
  const { data: refreshToken, error } = await db.rpc("get_calendar_refresh_token", { p_user: person.user_id });
  if (error || typeof refreshToken !== "string" || !person.calendar_id) {
    await setStatus(db, person.user_id, { status: "error", status_detail: "The connection to Google is incomplete. Connect again." });
    return { sent: 0, applied: 0 };
  }

  const accessToken = await refreshAccessToken(refreshToken);
  if (accessToken === "revoked") {
    await setStatus(db, person.user_id, {
      enabled: false,
      status: "revoked",
      status_detail: "Google access was removed. Connect again to resume.",
    });
    return { sent: 0, applied: 0 };
  }

  const calendar = calendarPort(accessToken, person.calendar_id);
  const store = taskStore(db, person.user_id, person.workspace_id);

  // Take the waiting tasks off the queue first; any that fail go back, so none is lost and a
  // change made meanwhile is queued again by the database.
  const { data: waiting } = await db
    .from("calendar_sync_queue")
    .select("id,task_id")
    .eq("user_id", person.user_id)
    .order("id")
    .limit(TASKS_PER_PERSON);
  const rows = waiting ?? [];
  if (rows.length > 0) {
    await db.from("calendar_sync_queue").delete().in("id", rows.map((row) => row.id));
  }
  let sent = 0;
  for (const row of rows) {
    try {
      const outcome = await pushTask(calendar, store, row.task_id);
      if (outcome !== "skipped" && outcome !== "nothing") sent += 1;
    } catch (caught) {
      await db
        .from("calendar_sync_queue")
        .upsert({ user_id: person.user_id, task_id: row.task_id, workspace_id: person.workspace_id }, { onConflict: "user_id,task_id", ignoreDuplicates: true });
      if (caught instanceof GoogleError && (caught.status === 401 || caught.status === 403)) throw caught;
    }
  }

  const { data: profile } = await db.from("profiles").select("timezone").eq("id", person.user_id).single();
  const pulled = await pullChanges(calendar, store, person.sync_token, profile?.timezone ?? "UTC");
  await setStatus(db, person.user_id, {
    sync_token: pulled.nextSyncToken,
    last_synced_at: new Date().toISOString(),
    status: "active",
    status_detail: null,
  });
  return { sent, applied: pulled.applied };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method not allowed" });

  const expected = Deno.env.get("GCAL_CRON_SECRET");
  if (!expected) {
    console.error("gcal-sync: GCAL_CRON_SECRET is not set");
    return json(500, { error: "not configured" });
  }
  if (!(await sameSecret(request.headers.get("x-cron-secret") ?? "", expected))) {
    return json(401, { error: "unauthorized" });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    console.error("gcal-sync: Supabase environment is missing");
    return json(500, { error: "not configured" });
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: people, error } = await db
    .from("calendar_integrations")
    .select("user_id,workspace_id,calendar_id,sync_token")
    .eq("enabled", true)
    .in("status", ["active", "error"])
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(PEOPLE_PER_RUN);
  if (error) {
    console.error("gcal-sync: reading integrations failed", error.code);
    return json(500, { error: "could not read integrations" });
  }

  const totals = { people: 0, sent: 0, applied: 0, failed: 0 };
  for (const person of (people ?? []) as Integration[]) {
    totals.people += 1;
    try {
      const result = await syncPerson(db, person);
      totals.sent += result.sent;
      totals.applied += result.applied;
    } catch (caught) {
      totals.failed += 1;
      const status = caught instanceof GoogleError ? `Google answered ${caught.status}` : "Something went wrong";
      console.error("gcal-sync: a person's sync failed", caught instanceof Error ? caught.name : "unknown");
      await setStatus(db, person.user_id, { status: "error", status_detail: `${status}. It will be tried again.` });
    }
  }
  return json(200, totals);
});
