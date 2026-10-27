import {
  eventToTaskChange,
  taskToEvent,
  type GoogleEvent,
  type SyncTask,
  type TaskPatchFromEvent,
} from "./calendar-sync.ts";

/**
 * The calendar sync, with every outside call handed in as a port. The Edge Functions pass real
 * ones (Google's API, the database); the tests pass in-memory ones. Nothing here does I/O itself.
 *
 * What keeps changes from bouncing between the app and Google:
 * - a link remembers the task version it last matched; a task at or below it is not sent again;
 * - a link remembers Google's etag from our last write; an event with that etag is our own echo;
 * so a change made on either side reaches the other exactly once. If both sides change the same
 * item before a sync, the one seen last wins.
 */

export interface LinkRecord {
  googleEventId: string;
  etag: string | null;
  lastSyncedVersion: number;
}

export interface ChangedEvent extends GoogleEvent {
  id: string;
  etag: string;
}

/** One person's Google calendar. */
export interface CalendarPort {
  createEvent(event: GoogleEvent): Promise<{ id: string; etag: string }>;
  /** "gone" when the event no longer exists in Google. */
  updateEvent(eventId: string, event: GoogleEvent): Promise<{ etag: string } | "gone">;
  /** Deleting an event that is already gone counts as done. */
  deleteEvent(eventId: string): Promise<void>;
  /** Changes since `syncToken` (everything when null). "token-expired" when Google no longer knows the token. */
  listChanges(syncToken: string | null): Promise<{ events: ChangedEvent[]; nextSyncToken: string } | "token-expired">;
}

export type InboundApplied = { kind: "update"; patch: TaskPatchFromEvent } | { kind: "cleared" };

/** The database side, for one person's integration. */
export interface TaskStorePort {
  getTask(taskId: string): Promise<SyncTask | null>;
  getLink(taskId: string): Promise<LinkRecord | null>;
  getLinkByEvent(eventId: string): Promise<(LinkRecord & { taskId: string }) | null>;
  saveLink(taskId: string, link: LinkRecord): Promise<void>;
  deleteLink(taskId: string): Promise<void>;
  /** Applies a change that came from Google to the task and returns the task's version afterwards. */
  applyInbound(taskId: string, change: InboundApplied): Promise<number>;
}

export type PushOutcome = "created" | "updated" | "recreated" | "deleted" | "skipped" | "nothing";

/** Brings Google in line with one task. */
export async function pushTask(calendar: CalendarPort, store: TaskStorePort, taskId: string): Promise<PushOutcome> {
  const task = await store.getTask(taskId);
  const link = await store.getLink(taskId);

  if (link && task && task.version <= link.lastSyncedVersion) return "skipped";

  const event = task ? taskToEvent(task) : null;
  if (!task || !event) {
    if (!link) return "nothing";
    await calendar.deleteEvent(link.googleEventId);
    await store.deleteLink(taskId);
    return "deleted";
  }
  if (link) {
    const updated = await calendar.updateEvent(link.googleEventId, event);
    if (updated !== "gone") {
      await store.saveLink(taskId, { ...link, etag: updated.etag, lastSyncedVersion: task.version });
      return "updated";
    }
  }
  const created = await calendar.createEvent(event);
  await store.saveLink(taskId, { googleEventId: created.id, etag: created.etag, lastSyncedVersion: task.version });
  return link ? "recreated" : "created";
}

export interface PullResult {
  nextSyncToken: string;
  applied: number;
  ignored: number;
  /** True when the saved token had expired and the whole calendar was read again. */
  reset: boolean;
}

/**
 * Reads what changed in Google and applies it to the linked tasks. Events with no linked task
 * (made in Google, not from a task) are left alone: the calendar is not turned into a task list.
 */
export async function pullChanges(
  calendar: CalendarPort,
  store: TaskStorePort,
  syncToken: string | null,
  fallbackZone: string,
): Promise<PullResult> {
  let reset = false;
  let changes = await calendar.listChanges(syncToken);
  if (changes === "token-expired") {
    reset = true;
    changes = await calendar.listChanges(null);
    if (changes === "token-expired") throw new Error("Google refused a full read of the calendar");
  }

  let applied = 0;
  let ignored = 0;
  for (const event of changes.events) {
    const link = await store.getLinkByEvent(event.id);
    if (!link || (link.etag !== null && link.etag === event.etag)) {
      ignored += 1;
      continue;
    }
    const change = eventToTaskChange(event, fallbackZone);
    if (change.kind === "ignore") {
      ignored += 1;
      continue;
    }
    const version = await store.applyInbound(link.taskId, change);
    if (change.kind === "cleared") await store.deleteLink(link.taskId);
    else await store.saveLink(link.taskId, { googleEventId: link.googleEventId, etag: event.etag, lastSyncedVersion: version });
    applied += 1;
  }
  return { nextSyncToken: changes.nextSyncToken, applied, ignored, reset };
}
