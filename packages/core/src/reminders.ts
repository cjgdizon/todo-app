import { z } from "zod";
import { instantToLocal } from "./zoned.ts";

/** A reminder that is due now, as the database hands it to the sender (`claim_due_reminders`). */
export interface DueReminder {
  reminderId: string;
  userId: string;
  taskId: string;
  workspaceId: string;
  title: string;
  dueAt: Date;
  dueAllDay: boolean;
  /** The task's zone, else the person's own: the zone the due date is worded in. */
  timeZone: string;
  /** Expo push tokens of the person's devices. */
  tokens: string[];
}

/** One notification for the Expo push service (https://docs.expo.dev/push-notifications/sending-notifications/). */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  sound: "default";
  priority: "high";
  channelId: "reminders";
  data: { taskId: string; workspaceId: string };
}

/** Expo accepts at most this many messages per request. */
export const PUSH_BATCH_SIZE = 100;
const MAX_TITLE_LENGTH = 100;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("chunk size must be at least 1");
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) batches.push(items.slice(start, start + size));
  return batches;
}

function dueText(reminder: DueReminder): string {
  let local: { date: string; time: string };
  try {
    local = instantToLocal(reminder.dueAt, reminder.timeZone);
  } catch {
    local = instantToLocal(reminder.dueAt, "UTC"); // a bad zone must not stop the reminder
  }
  return reminder.dueAllDay ? `Due ${local.date}` : `Due ${local.date} at ${local.time}`;
}

/** One message per device. People without a device get none. */
export function buildReminderMessages(reminders: readonly DueReminder[]): PushMessage[] {
  return reminders.flatMap((reminder) =>
    reminder.tokens.map(
      (token): PushMessage => ({
        to: token,
        title: reminder.title.slice(0, MAX_TITLE_LENGTH),
        body: dueText(reminder),
        sound: "default",
        priority: "high",
        channelId: "reminders",
        data: { taskId: reminder.taskId, workspaceId: reminder.workspaceId },
      }),
    ),
  );
}

// Expo answers a batch with one ticket per message, in order.
const ticketsResponse = z.object({
  data: z.array(
    z.union([
      z.object({ status: z.literal("ok") }),
      z.object({
        status: z.literal("error"),
        details: z.object({ error: z.string().optional() }).optional(),
      }),
    ]),
  ),
});

export interface PushResult {
  sent: number;
  failed: number;
  /** Devices Expo says no longer exist; their tokens should be forgotten. */
  deadTokens: string[];
}

/** Reads Expo's answer for `messages`. An answer that does not fit counts as all failed. */
export function readPushTickets(messages: readonly PushMessage[], response: unknown): PushResult {
  const parsed = ticketsResponse.safeParse(response);
  if (!parsed.success || parsed.data.data.length !== messages.length) {
    return { sent: 0, failed: messages.length, deadTokens: [] };
  }
  const result: PushResult = { sent: 0, failed: 0, deadTokens: [] };
  parsed.data.data.forEach((ticket, index) => {
    if (ticket.status === "ok") {
      result.sent += 1;
      return;
    }
    result.failed += 1;
    const message = messages[index];
    if (message && ticket.details?.error === "DeviceNotRegistered") result.deadTokens.push(message.to);
  });
  return result;
}

const pushData = z.object({ taskId: z.string().uuid() });

/** The task a tapped notification is about. The payload comes from outside, so anything odd gives null. */
export function taskIdFromPush(data: unknown): string | null {
  const parsed = pushData.safeParse(data);
  return parsed.success ? parsed.data.taskId : null;
}
