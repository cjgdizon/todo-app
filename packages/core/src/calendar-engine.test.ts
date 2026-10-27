import { beforeEach, describe, expect, it } from "vitest";
import {
  pullChanges,
  pushTask,
  type CalendarPort,
  type ChangedEvent,
  type InboundApplied,
  type LinkRecord,
  type TaskStorePort,
} from "./calendar-engine.ts";
import type { GoogleEvent, SyncTask } from "./calendar-sync.ts";

type StoredTask = SyncTask;

/** Google, in memory: events with etags, and a change feed behind a sync token. */
class FakeCalendar implements CalendarPort {
  events = new Map<string, ChangedEvent>();
  log: string[] = [];
  private counter = 0;
  private feed: ChangedEvent[] = [];
  tokenExpired = false;

  private stamp(event: GoogleEvent, id: string): ChangedEvent {
    this.counter += 1;
    return { ...event, id, etag: `etag-${this.counter}` };
  }

  async createEvent(event: GoogleEvent) {
    const created = this.stamp(event, `evt-${this.counter + 1}`);
    this.events.set(created.id, created);
    this.log.push(`create ${created.id}`);
    return { id: created.id, etag: created.etag };
  }

  async updateEvent(eventId: string, event: GoogleEvent) {
    if (!this.events.has(eventId)) return "gone" as const;
    const updated = this.stamp(event, eventId);
    this.events.set(eventId, updated);
    this.log.push(`update ${eventId}`);
    return { etag: updated.etag };
  }

  async deleteEvent(eventId: string) {
    this.events.delete(eventId);
    this.log.push(`delete ${eventId}`);
  }

  /** Something done in Google itself (the person editing or cancelling an event). */
  editInGoogle(eventId: string, changes: Partial<GoogleEvent>) {
    const edited = this.stamp({ ...this.events.get(eventId), ...changes }, eventId);
    this.events.set(eventId, edited);
    this.feed.push(edited);
  }

  async listChanges(syncToken: string | null) {
    if (syncToken === "stale" || this.tokenExpired) {
      if (syncToken !== null) return "token-expired" as const;
    }
    const events = syncToken === null ? [...this.events.values()] : this.feed.splice(0);
    return { events, nextSyncToken: `token-${this.counter}` };
  }
}

/** The database side, in memory. */
class FakeStore implements TaskStorePort {
  tasks = new Map<string, StoredTask>();
  links = new Map<string, LinkRecord>();
  applied: { taskId: string; kind: string }[] = [];

  async getTask(taskId: string) {
    return this.tasks.get(taskId) ?? null;
  }
  async getLink(taskId: string) {
    return this.links.get(taskId) ?? null;
  }
  async getLinkByEvent(eventId: string) {
    for (const [taskId, link] of this.links) if (link.googleEventId === eventId) return { ...link, taskId };
    return null;
  }
  async saveLink(taskId: string, link: LinkRecord) {
    this.links.set(taskId, link);
  }
  async deleteLink(taskId: string) {
    this.links.delete(taskId);
  }
  async applyInbound(taskId: string, change: InboundApplied) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("no such task");
    this.applied.push({ taskId, kind: change.kind });
    const next: StoredTask =
      change.kind === "cleared"
        ? { ...task, dueAt: null, dueAllDay: false, dueTz: null, rrule: null, version: task.version + 1 }
        : { ...task, ...change.patch, rrule: change.patch.rrule === undefined ? task.rrule : change.patch.rrule, version: task.version + 1 };
    this.tasks.set(taskId, next);
    return next.version;
  }
  edit(taskId: string, changes: Partial<StoredTask>) {
    const task = this.tasks.get(taskId)!;
    this.tasks.set(taskId, { ...task, ...changes, version: task.version + 1 });
  }
}

const TASK = "task-1";
const baseTask = (): StoredTask => ({
  id: TASK,
  title: "Call the bank",
  notes: null,
  dueAt: new Date("2030-03-15T02:30:00Z"),
  dueAllDay: false,
  dueTz: "Asia/Manila",
  rrule: null,
  completedAt: null,
  deletedAt: null,
  estimateMin: null,
  version: 1,
});

let calendar: FakeCalendar;
let store: FakeStore;

beforeEach(() => {
  calendar = new FakeCalendar();
  store = new FakeStore();
  store.tasks.set(TASK, baseTask());
});

describe("pushTask", () => {
  it("creates an event for a task with a due date, once", async () => {
    expect(await pushTask(calendar, store, TASK)).toBe("created");
    expect(calendar.log).toEqual(["create evt-1"]);
    expect(store.links.get(TASK)).toMatchObject({ googleEventId: "evt-1", lastSyncedVersion: 1 });

    expect(await pushTask(calendar, store, TASK)).toBe("skipped");
    expect(calendar.log).toEqual(["create evt-1"]);
  });

  it("updates the event when the task changes", async () => {
    await pushTask(calendar, store, TASK);
    store.edit(TASK, { title: "Call the bank today" });
    expect(await pushTask(calendar, store, TASK)).toBe("updated");
    expect(calendar.events.get("evt-1")?.summary).toBe("Call the bank today");
    expect(store.links.get(TASK)?.lastSyncedVersion).toBe(2);
  });

  it("takes the event off the calendar when the task is finished, loses its due date or is deleted", async () => {
    for (const change of [
      { completedAt: new Date("2030-03-15T03:00:00Z") },
      { dueAt: null, dueTz: null },
      { deletedAt: new Date("2030-03-15T03:00:00Z") },
    ]) {
      store.tasks.set(TASK, baseTask());
      store.links.clear();
      calendar.events.clear();
      await pushTask(calendar, store, TASK);
      store.edit(TASK, change);
      expect(await pushTask(calendar, store, TASK)).toBe("deleted");
      expect(calendar.events.size).toBe(0);
      expect(store.links.has(TASK)).toBe(false);
    }
  });

  it("does nothing for a task that has no due date and no event", async () => {
    store.edit(TASK, { dueAt: null, dueTz: null });
    expect(await pushTask(calendar, store, TASK)).toBe("nothing");
    expect(calendar.log).toEqual([]);
  });

  it("removes the event of a task that no longer exists", async () => {
    await pushTask(calendar, store, TASK);
    store.tasks.delete(TASK);
    expect(await pushTask(calendar, store, TASK)).toBe("deleted");
    expect(calendar.events.size).toBe(0);
  });

  it("makes a new event when the old one was deleted in Google", async () => {
    await pushTask(calendar, store, TASK);
    calendar.events.clear();
    store.edit(TASK, { title: "Changed" });
    expect(await pushTask(calendar, store, TASK)).toBe("recreated");
    expect(store.links.get(TASK)?.googleEventId).toBe("evt-2");
  });
});

describe("pullChanges", () => {
  it("applies a change made in Google to the task, and does not send it back", async () => {
    await pushTask(calendar, store, TASK);
    calendar.editInGoogle("evt-1", { summary: "Call the bank (moved)", start: { dateTime: "2030-03-16T03:00:00Z", timeZone: "Asia/Manila" } });

    const result = await pullChanges(calendar, store, "token-1", "Asia/Manila");
    expect(result).toMatchObject({ applied: 1, ignored: 0, reset: false });
    expect(store.tasks.get(TASK)).toMatchObject({ title: "Call the bank (moved)", dueAt: new Date("2030-03-16T03:00:00Z") });
    // The version this produced is already known to the link, so the next push has nothing to do.
    expect(await pushTask(calendar, store, TASK)).toBe("skipped");
  });

  it("ignores the echo of its own writes, and events that are not linked to a task", async () => {
    await pushTask(calendar, store, TASK);
    const own = calendar.events.get("evt-1")!;
    calendar.editInGoogle("stranger", { summary: "Dinner", start: { date: "2030-03-20" } });
    const feedOwn: ChangedEvent[] = [own, calendar.events.get("stranger")!];

    const echoCalendar = { ...calendar, listChanges: async () => ({ events: feedOwn, nextSyncToken: "t" }) } as unknown as CalendarPort;
    const result = await pullChanges(echoCalendar, store, "t0", "Asia/Manila");
    expect(result).toMatchObject({ applied: 0, ignored: 2 });
    expect(store.applied).toEqual([]);
  });

  it("removes the due date when the event is cancelled in Google", async () => {
    await pushTask(calendar, store, TASK);
    calendar.editInGoogle("evt-1", { status: "cancelled" });
    const result = await pullChanges(calendar, store, "token-1", "Asia/Manila");
    expect(result.applied).toBe(1);
    expect(store.tasks.get(TASK)).toMatchObject({ dueAt: null, title: "Call the bank" });
    expect(store.links.has(TASK)).toBe(false);
    expect(await pushTask(calendar, store, TASK)).toBe("nothing");
  });

  it("skips events it cannot read", async () => {
    await pushTask(calendar, store, TASK);
    calendar.editInGoogle("evt-1", { start: {} });
    const result = await pullChanges(calendar, store, "token-1", "Asia/Manila");
    expect(result).toMatchObject({ applied: 0, ignored: 1 });
    expect(store.tasks.get(TASK)?.dueAt).toEqual(baseTask().dueAt);
  });

  it("starts again from the full calendar when Google says the sync token is too old", async () => {
    await pushTask(calendar, store, TASK);
    calendar.editInGoogle("evt-1", { summary: "Edited while we were away" });
    const result = await pullChanges(calendar, store, "stale", "Asia/Manila");
    expect(result.reset).toBe(true);
    expect(store.tasks.get(TASK)?.title).toBe("Edited while we were away");
    expect(result.nextSyncToken).toMatch(/^token-/);
  });
});
