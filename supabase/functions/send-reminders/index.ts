// Sends the reminders that are due. The database's cron job calls this every minute with a shared
// secret (no user is signed in, so there is no JWT: `verify_jwt = false` in config.toml). The
// function claims what is due through `claim_due_reminders` (which marks it sent, so a reminder is
// never sent twice), pushes it to Expo, and forgets the devices Expo says no longer exist.
// Nothing sensitive is logged: counts and error kinds only, never tokens or task titles.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sameSecret } from "../_shared/secret.ts";
import {
  buildReminderMessages,
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
  // A reminder's messages (one per device) always travel in the same request, so a request that
  // fails cannot make some devices get a reminder twice, and it can be put back as a whole.
  const batches: { reminderId: string; messages: ReturnType<typeof buildReminderMessages> }[][] = [];
  let current: (typeof batches)[number] = [];
  let size = 0;
  for (const reminder of due) {
    const messages = buildReminderMessages([reminder]);
    if (messages.length === 0) continue;
    if (current.length > 0 && size + messages.length > PUSH_BATCH_SIZE) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push({ reminderId: reminder.reminderId, messages });
    size += messages.length;
  }
  if (current.length > 0) batches.push(current);

  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  const totals = { sent: 0, failed: 0 };
  const deadTokens: string[] = [];
  const retryIds = new Set<string>();
  let pushDown = false;
  for (const batch of batches) {
    // After a failure the push service is not answering: put the rest back instead of waiting 10 s per batch.
    if (pushDown) {
      for (const item of batch) retryIds.add(item.reminderId);
      continue;
    }
    const messages = batch.flatMap((item) => item.messages);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
      });
      // The push service being down or busy is worth another try next minute; a 4xx would fail the same way again.
      if (response.status >= 500 || response.status === 429) {
        for (const item of batch) retryIds.add(item.reminderId);
        pushDown = true;
      }
      const result = readPushTickets(messages, await response.json().catch(() => null));
      totals.sent += result.sent;
      totals.failed += result.failed;
      deadTokens.push(...result.deadTokens);
    } catch (caught) {
      console.error("send-reminders: push request failed", caught instanceof Error ? caught.name : "unknown");
      totals.failed += messages.length;
      for (const item of batch) retryIds.add(item.reminderId);
      pushDown = true;
    }
  }

  if (retryIds.size > 0) {
    const { error: putBackError } = await db.rpc("unclaim_reminders", { p_ids: [...retryIds] });
    if (putBackError) console.error("send-reminders: putting reminders back failed", putBackError.code);
  }

  if (deadTokens.length > 0) {
    const { error: forgetError } = await db.rpc("forget_push_tokens", { p_tokens: deadTokens });
    if (forgetError) console.error("send-reminders: forgetting tokens failed", forgetError.code);
  }

  return json(200, { claimed: due.length, ...totals, forgotten: deadTokens.length });
});
