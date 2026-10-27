import { isValidRrule } from "./recurrence.ts";
import { instantToLocal, localToInstant, zoned } from "./zoned.ts";

/**
 * Mapping between a task and a Google Calendar event, in both directions. Pure: the Edge Functions
 * do the talking to Google and the database, and call these to decide what to send or store.
 *
 * Rules (the defaults of the plan):
 * - A task is an event only while it has a due date and is neither done nor deleted; finishing or
 *   deleting it removes its event.
 * - A task with no estimate is a 30-minute event; an all-day task is an all-day event.
 * - An event cancelled in Google removes the task's due date (the task itself is never deleted).
 * - Everything that comes back from Google is untrusted: it is cut to the database's limits and
 *   a repeat rule is accepted only if it passes the same check as one typed by a person.
 */

export const DEFAULT_EVENT_MINUTES = 30;
const MAX_DESCRIPTION_LENGTH = 8_000; // below Google's own limit, so a long note never gets refused
const MAX_TITLE_LENGTH = 500; // the database's limits
const MAX_NOTES_LENGTH = 50_000;
const MS_PER_MINUTE = 60_000;
const RRULE_PREFIX = "RRULE:";

export interface SyncTask {
  id: string;
  title: string;
  notes: string | null;
  dueAt: Date | null;
  dueAllDay: boolean;
  dueTz: string | null;
  rrule: string | null;
  completedAt: Date | null;
  deletedAt: Date | null;
  estimateMin: number | null;
  /** The task's row version; it goes up with every change. */
  version: number;
}

/** The parts of a Google event this app reads or writes. */
export interface GoogleEvent {
  id?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  extendedProperties?: { private?: Record<string, string> };
}

/** The event to create or update for a task, or null when the task should have no event. */
export function taskToEvent(task: SyncTask): GoogleEvent | null {
  if (!task.dueAt || task.completedAt || task.deletedAt) return null;
  const zone = task.dueTz ?? "UTC";
  const event: GoogleEvent = {
    summary: task.title,
    description: (task.notes ?? "").slice(0, MAX_DESCRIPTION_LENGTH),
    extendedProperties: { private: { todoTaskId: task.id } },
    ...(task.rrule ? { recurrence: [`${RRULE_PREFIX}${task.rrule}`] } : {}),
  };

  if (task.dueAllDay) {
    // Google's all-day end date is the day after the last day.
    return {
      ...event,
      start: { date: instantToLocal(task.dueAt, zone).date },
      end: { date: zoned(task.dueAt, zone).plus({ days: 1 }).toFormat("yyyy-MM-dd") },
    };
  }
  const minutes = task.estimateMin ?? DEFAULT_EVENT_MINUTES;
  return {
    ...event,
    start: { dateTime: task.dueAt.toISOString(), timeZone: zone },
    end: { dateTime: new Date(task.dueAt.getTime() + minutes * MS_PER_MINUTE).toISOString(), timeZone: zone },
  };
}

export interface TaskPatchFromEvent {
  title?: string;
  notes: string | null;
  dueAt: Date;
  dueAllDay: boolean;
  dueTz: string;
  /** Absent when the event's repeat rule cannot be used, so the task keeps what it had. */
  rrule?: string | null;
}

export type InboundChange =
  | { kind: "update"; patch: TaskPatchFromEvent; warnings: string[] }
  | { kind: "cleared" }
  | { kind: "ignore"; reason: string };

function knownZone(zone: string | undefined): string | null {
  if (!zone) return null;
  try {
    return zoned(new Date(), zone).isValid ? zone : null;
  } catch {
    return null;
  }
}

/** What an event changed in Google means for its task. `fallbackZone` is the person's own zone. */
export function eventToTaskChange(event: GoogleEvent, fallbackZone: string): InboundChange {
  if (event.status === "cancelled") return { kind: "cleared" };
  const start = event.start;
  if (!start) return { kind: "ignore", reason: "The event has no start." };

  const zone = knownZone(start.timeZone) ?? fallbackZone;
  let dueAt: Date | null;
  let dueAllDay: boolean;
  if (start.date) {
    dueAt = localToInstant(start.date, null, zone);
    dueAllDay = true;
  } else if (start.dateTime) {
    const parsed = new Date(start.dateTime);
    dueAt = Number.isNaN(parsed.getTime()) ? null : parsed;
    dueAllDay = false;
  } else {
    return { kind: "ignore", reason: "The event has no start." };
  }
  if (!dueAt) return { kind: "ignore", reason: "The event's start is not a valid date." };

  const warnings: string[] = [];
  const patch: TaskPatchFromEvent = {
    notes: event.description ? event.description.slice(0, MAX_NOTES_LENGTH) : null,
    dueAt,
    dueAllDay,
    dueTz: zone,
  };
  const title = event.summary?.trim();
  if (title) patch.title = title.slice(0, MAX_TITLE_LENGTH);

  const line = event.recurrence?.find((item) => item.startsWith(RRULE_PREFIX));
  if (!line) {
    patch.rrule = null;
  } else if (isValidRrule(line.slice(RRULE_PREFIX.length))) {
    patch.rrule = line.slice(RRULE_PREFIX.length);
  } else {
    warnings.push("The repeat rule is not supported, so it was left as it was.");
  }
  return { kind: "update", patch, warnings };
}
