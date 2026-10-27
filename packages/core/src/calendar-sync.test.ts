import { describe, expect, it } from "vitest";
import { DEFAULT_EVENT_MINUTES, eventToTaskChange, taskToEvent, type SyncTask } from "./calendar-sync.ts";

const task = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  id: "6f1c1d0e-3b1f-4c55-9a53-0a6c7a1c2d3e",
  title: "Call the bank",
  notes: "Ask about the fee",
  dueAt: new Date("2030-03-15T02:30:00Z"), // 10:30 in Manila
  dueAllDay: false,
  dueTz: "Asia/Manila",
  rrule: null,
  completedAt: null,
  deletedAt: null,
  estimateMin: null,
  version: 1,
  ...overrides,
});

describe("taskToEvent", () => {
  it("makes a timed event in the task's own time zone, 30 minutes long by default", () => {
    expect(taskToEvent(task())).toEqual({
      summary: "Call the bank",
      description: "Ask about the fee",
      start: { dateTime: "2030-03-15T02:30:00.000Z", timeZone: "Asia/Manila" },
      end: { dateTime: "2030-03-15T03:00:00.000Z", timeZone: "Asia/Manila" },
      extendedProperties: { private: { todoTaskId: "6f1c1d0e-3b1f-4c55-9a53-0a6c7a1c2d3e" } },
    });
    expect(DEFAULT_EVENT_MINUTES).toBe(30);
  });

  it("uses the estimate as the length", () => {
    expect(taskToEvent(task({ estimateMin: 90 }))?.end).toEqual({
      dateTime: "2030-03-15T04:00:00.000Z",
      timeZone: "Asia/Manila",
    });
  });

  it("makes an all-day event on the task's local day, ending the next day as Google expects", () => {
    const event = taskToEvent(task({ dueAllDay: true, dueAt: new Date("2030-03-14T16:00:00Z") }));
    expect(event?.start).toEqual({ date: "2030-03-15" });
    expect(event?.end).toEqual({ date: "2030-03-16" });
  });

  it("carries a repeat rule and works across a month end", () => {
    const event = taskToEvent(
      task({ rrule: "FREQ=WEEKLY;BYDAY=MO", dueAllDay: true, dueAt: new Date("2030-02-27T16:00:00Z") }),
    );
    expect(event?.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
    expect(event?.start).toEqual({ date: "2030-02-28" });
    expect(event?.end).toEqual({ date: "2030-03-01" });
  });

  it("falls back to UTC when the task has no zone, and clears an empty description", () => {
    const event = taskToEvent(task({ dueTz: null, notes: null }));
    expect(event?.start).toMatchObject({ timeZone: "UTC" });
    expect(event?.description).toBe("");
  });

  it("has no event for a task without a due date or one that is done", () => {
    expect(taskToEvent(task({ dueAt: null }))).toBeNull();
    expect(taskToEvent(task({ completedAt: new Date("2030-03-15T05:00:00Z") }))).toBeNull();
    expect(taskToEvent(task({ deletedAt: new Date("2030-03-15T05:00:00Z") }))).toBeNull();
  });

  it("keeps text within Google's limits", () => {
    const event = taskToEvent(task({ notes: "n".repeat(20_000) }));
    expect(event?.description).toHaveLength(8_000);
  });
});

describe("eventToTaskChange", () => {
  const zone = "Asia/Manila";

  it("reads a timed event in its own time zone", () => {
    expect(
      eventToTaskChange(
        {
          summary: "Dentist",
          description: "Bring the card",
          start: { dateTime: "2030-03-15T10:00:00+01:00", timeZone: "Europe/Paris" },
          end: { dateTime: "2030-03-15T11:00:00+01:00", timeZone: "Europe/Paris" },
        },
        zone,
      ),
    ).toEqual({
      kind: "update",
      patch: {
        title: "Dentist",
        notes: "Bring the card",
        dueAt: new Date("2030-03-15T09:00:00Z"),
        dueAllDay: false,
        dueTz: "Europe/Paris",
        rrule: null,
      },
      warnings: [],
    });
  });

  it("reads an all-day event as local midnight in the person's zone", () => {
    const change = eventToTaskChange({ summary: "Holiday", start: { date: "2030-03-15" }, end: { date: "2030-03-16" } }, zone);
    expect(change).toMatchObject({
      kind: "update",
      patch: { dueAt: new Date("2030-03-14T16:00:00Z"), dueAllDay: true, dueTz: zone },
    });
  });

  it("treats a cancelled event as the due date being removed", () => {
    expect(eventToTaskChange({ status: "cancelled" }, zone)).toEqual({ kind: "cleared" });
  });

  it("takes a supported repeat rule and says when it cannot", () => {
    const supported = eventToTaskChange(
      { summary: "Standup", start: { date: "2030-03-15" }, recurrence: ["EXDATE:20300322", "RRULE:FREQ=WEEKLY;BYDAY=FR"] },
      zone,
    );
    expect(supported).toMatchObject({ kind: "update", patch: { rrule: "FREQ=WEEKLY;BYDAY=FR" }, warnings: [] });

    const unsupported = eventToTaskChange(
      { summary: "Odd", start: { date: "2030-03-15" }, recurrence: ["RRULE:FREQ=SECONDLY"] },
      zone,
    );
    expect(unsupported.kind).toBe("update");
    if (unsupported.kind === "update") {
      expect("rrule" in unsupported.patch).toBe(false);
      expect(unsupported.warnings).toEqual(["The repeat rule is not supported, so it was left as it was."]);
    }
  });

  it("leaves the title alone when it is blank, and cuts text to the database's limits", () => {
    const blank = eventToTaskChange({ summary: "   ", start: { date: "2030-03-15" } }, zone);
    expect(blank.kind === "update" && "title" in blank.patch).toBe(false);

    const long = eventToTaskChange({ summary: "t".repeat(900), description: "d".repeat(60_000), start: { date: "2030-03-15" } }, zone);
    expect(long.kind === "update" && long.patch.title).toHaveLength(500);
    expect(long.kind === "update" && long.patch.notes).toHaveLength(50_000);
  });

  it("falls back to the person's zone when the event's zone is unknown", () => {
    const change = eventToTaskChange(
      { summary: "x", start: { dateTime: "2030-03-15T02:00:00Z", timeZone: "Not/AZone" } },
      zone,
    );
    expect(change).toMatchObject({ kind: "update", patch: { dueTz: zone } });
  });

  it("ignores events it cannot make sense of", () => {
    expect(eventToTaskChange({ summary: "No start" }, zone).kind).toBe("ignore");
    expect(eventToTaskChange({ summary: "Bad", start: { dateTime: "not a date" } }, zone).kind).toBe("ignore");
    expect(eventToTaskChange({ summary: "Bad", start: { date: "2030-13-45" } }, zone).kind).toBe("ignore");
  });
});
