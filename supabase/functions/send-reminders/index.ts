// Sends the reminders that are due. The database's cron job calls this every minute with a shared
// secret (no user is signed in, so there is no JWT: `verify_jwt = false` in config.toml). The
// function claims what is due through `claim_due_reminders` (which marks it sent, so a reminder is
// never sent twice), pushes it to Expo, and forgets the devices Expo says no longer exist.
// Nothing sensitive is logged: counts and error kinds only, never tokens or task titles.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sameSecret } from "../_shared/secret.ts";
import {
  buildReminderMessages,
  chunk,
  PUSH_BATCH_SIZE,
  readPushTickets,
  type DueReminder,
} from "@todo/core/reminders";

// Overridable only so a local test can point it at a stand-in server.
const EXPO_PUSH_URL = Deno.env.get("EXPO_PUSH_URL") ?? "https://exp.host/--/api/v2/push/send";
const CLAIM_BATCH = 200;
const EXPO_TIMEOUT_MS = 10_000;

interface ClaimedRow {
  reminder_id: string;
  user_id: string;
  task_id: string;
  workspace_id: string;
  title: string;
  due_at: string;
  due_all_day: boolean;
  time_zone: string;
  tokens: string[];
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const toDueReminder = (row: ClaimedRow): DueReminder => ({
  reminderId: row.reminder_id,
  userId: row.user_id,
  taskId: row.task_id,
  workspaceId: row.workspace_id,
  title: row.title,
  dueAt: new Date(row.due_at),
  dueAllDay: row.due_all_day,
  timeZone: row.time_zone,
  tokens: row.tokens,
});

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method not allowed" });

  const expected = Deno.env.get("REMINDERS_CRON_SECRET");
  if (!expected) {
    console.error("send-reminders: REMINDERS_CRON_SECRET is not set");
    return json(500, { error: "not configured" });
  }
  if (!(await sameSecret(request.headers.get("x-cron-secret") ?? "", expected))) {
    return json(401, { error: "unauthorized" });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    console.error("send-reminders: Supabase environment is missing");
    return json(500, { error: "not configured" });
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await db.rpc("claim_due_reminders", { batch: CLAIM_BATCH });
  if (error) {
    console.error("send-reminders: claiming failed", error.code);
    return json(500, { error: "could not read reminders" });
  }
  const due = ((data ?? []) as ClaimedRow[]).map(toDueReminder);
  const messages = buildReminderMessages(due);

  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  const totals = { sent: 0, failed: 0 };
  const deadTokens: string[] = [];
  for (const batch of chunk(messages, PUSH_BATCH_SIZE)) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
      });
      const result = readPushTickets(batch, await response.json().catch(() => null));
      totals.sent += result.sent;
      totals.failed += result.failed;
      deadTokens.push(...result.deadTokens);
    } catch (caught) {
      console.error("send-reminders: push request failed", caught instanceof Error ? caught.name : "unknown");
      totals.failed += batch.length;
    }
  }

  if (deadTokens.length > 0) {
    const { error: forgetError } = await db.rpc("forget_push_tokens", { p_tokens: deadTokens });
    if (forgetError) console.error("send-reminders: forgetting tokens failed", forgetError.code);
  }

  return json(200, { claimed: due.length, ...totals, forgotten: deadTokens.length });
});
