import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quickadd";

// Tuesday 2026-10-20 18:00 in Manila (UTC+8, no DST).
const ctx = { now: new Date("2026-10-20T10:00:00Z"), timeZone: "Asia/Manila" };
const iso = (d: Date | undefined | null) => d?.toISOString() ?? null;

describe("parseQuickAdd: plain tokens", () => {
  it("leaves a plain title untouched", () => {
    expect(parseQuickAdd("Buy milk", ctx)).toEqual({
      title: "Buy milk",
      priority: null,
      project: null,
      labels: [],
      due: null,
      rrule: null,
      recurAfterCompletion: false,
    });
  });

  it("extracts priority, project and labels", () => {
    const r = parseQuickAdd("Call mom p1 #family @phone @urgent", ctx);
    expect(r.title).toBe("Call mom");
    expect(r.priority).toBe(1);
    expect(r.project).toBe("family");
    expect(r.labels).toEqual(["phone", "urgent"]);
  });

  it("accepts uppercase priority and tokens at the start", () => {
    const r = parseQuickAdd("P2 #work Send invoice", ctx);
    expect(r.priority).toBe(2);
    expect(r.project).toBe("work");
    expect(r.title).toBe("Send invoice");
  });

  it("only treats tokens as tokens when they stand alone", () => {
    const r = parseQuickAdd("Read example.com/#anchor and note p5 or xp1", ctx);
    expect(r.title).toBe("Read example.com/#anchor and note p5 or xp1");
    expect(r.priority).toBeNull();
    expect(r.project).toBeNull();
  });

  it("collapses leftover whitespace", () => {
    expect(parseQuickAdd("  Buy   milk   p3  ", ctx).title).toBe("Buy milk");
  });

  it("returns an empty title when only tokens were typed", () => {
    const r = parseQuickAdd("p1 #work", ctx);
    expect(r.title).toBe("");
    expect(r.priority).toBe(1);
  });

  it("deduplicates repeated labels", () => {
    expect(parseQuickAdd("Task @a @b @a", ctx).labels).toEqual(["a", "b"]);
  });
});

describe("parseQuickAdd: dates", () => {
  it("parses a date with a time", () => {
    const r = parseQuickAdd("Submit report tomorrow at 5pm", ctx);
    expect(r.title).toBe("Submit report");
    expect(r.due).toEqual({ at: new Date("2026-10-21T09:00:00Z"), allDay: false });
  });

  it("treats a date without a time as all-day (local midnight)", () => {
    const r = parseQuickAdd("Dentist friday", ctx);
    expect(r.title).toBe("Dentist");
    expect(r.due).toEqual({ at: new Date("2026-10-22T16:00:00Z"), allDay: true });
  });
});

describe("parseQuickAdd: recurrence", () => {
  it("handles 'every 1st at 9am' with project and priority", () => {
    const r = parseQuickAdd("Pay rent every 1st at 9am #home p2", ctx);
    expect(r.title).toBe("Pay rent");
    expect(r.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
    expect(r.project).toBe("home");
    expect(r.priority).toBe(2);
    expect(r.recurAfterCompletion).toBe(false);
    expect(r.due).toEqual({ at: new Date("2026-11-01T01:00:00Z"), allDay: false });
  });

  it("starts 'every N days' today when no time is given", () => {
    const r = parseQuickAdd("Water plants every 3 days", ctx);
    expect(r.title).toBe("Water plants");
    expect(r.rrule).toBe("FREQ=DAILY;INTERVAL=3");
    expect(r.due).toEqual({ at: new Date("2026-10-19T16:00:00Z"), allDay: true });
  });

  it("rolls a timed recurrence to tomorrow when today's time has passed", () => {
    const r = parseQuickAdd("Standup every weekday at 10am", ctx);
    expect(r.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(iso(r.due?.at)).toBe("2026-10-21T02:00:00.000Z");
    expect(r.due?.allDay).toBe(false);
  });

  it("handles lists of weekdays", () => {
    const r = parseQuickAdd("Gym every mon, wed and fri", ctx);
    expect(r.title).toBe("Gym");
    expect(r.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
    // Today is Tuesday, so the first one is Wednesday.
    expect(iso(r.due?.at)).toBe("2026-10-20T16:00:00.000Z");
  });

  it("handles a single weekday", () => {
    const r = parseQuickAdd("Review every monday", ctx);
    expect(r.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(iso(r.due?.at)).toBe("2026-10-25T16:00:00.000Z");
  });

  it("understands daily/weekly/monthly/yearly shorthands", () => {
    expect(parseQuickAdd("Journal daily", ctx).rrule).toBe("FREQ=DAILY");
    expect(parseQuickAdd("Report weekly", ctx).rrule).toBe("FREQ=WEEKLY");
    expect(parseQuickAdd("Budget monthly", ctx).rrule).toBe("FREQ=MONTHLY");
    expect(parseQuickAdd("Checkup yearly", ctx).rrule).toBe("FREQ=YEARLY");
  });

  it("marks 'every!' as repeating after completion", () => {
    const r = parseQuickAdd("Stretch every! 2 days", ctx);
    expect(r.title).toBe("Stretch");
    expect(r.rrule).toBe("FREQ=DAILY;INTERVAL=2");
    expect(r.recurAfterCompletion).toBe(true);
  });

  it("does not throw or recur when a recurrence phrase has an out-of-range interval", () => {
    // The unsupported rule is dropped instead of surfacing a RecurrenceError.
    const r = parseQuickAdd("Walk every 5000 days", ctx);
    expect(r.rrule).toBeNull();
    expect(r.recurAfterCompletion).toBe(false);
  });

  it("does not treat ordinary uses of 'every' as recurrence", () => {
    const r = parseQuickAdd("Review every pull request", ctx);
    expect(r.rrule).toBeNull();
    expect(r.title).toBe("Review every pull request");
  });
});

describe("parseQuickAdd: recurrence with a start date", () => {
  it("anchors on a weekday written before the recurrence", () => {
    const r = parseQuickAdd("Meet friday at 3pm every week", ctx);
    expect(r.title).toBe("Meet");
    expect(r.rrule).toBe("FREQ=WEEKLY");
    expect(r.due).toEqual({ at: new Date("2026-10-23T07:00:00Z"), allDay: false });
  });

  it("anchors a monthly rule on 'the 15th'", () => {
    const r = parseQuickAdd("Pay rent every month on the 15th", ctx);
    expect(r.title).toBe("Pay rent");
    expect(r.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=15");
    expect(r.due).toEqual({ at: new Date("2026-11-14T16:00:00Z"), allDay: true });
  });

  it("anchors a yearly rule on a month and day", () => {
    const r = parseQuickAdd("File taxes every year on april 15", ctx);
    expect(r.title).toBe("File taxes");
    expect(r.rrule).toBe("FREQ=YEARLY");
    expect(r.due).toEqual({ at: new Date("2027-04-14T16:00:00Z"), allDay: true });
  });

  it("starts at the date after 'starting'", () => {
    const r = parseQuickAdd("Report every week starting tomorrow", ctx);
    expect(r.title).toBe("Report");
    expect(r.rrule).toBe("FREQ=WEEKLY");
    expect(r.due).toEqual({ at: new Date("2026-10-20T16:00:00Z"), allDay: true });
  });

  it("combines 'from <weekday>' with a time", () => {
    const r = parseQuickAdd("Standup every weekday from monday at 9am", ctx);
    expect(r.title).toBe("Standup");
    expect(r.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(r.due).toEqual({ at: new Date("2026-10-26T01:00:00Z"), allDay: false });
  });

  it("keeps every weekday of a list that has a time in the middle", () => {
    const r = parseQuickAdd("Backup every monday at 9am and friday", ctx);
    expect(r.title).toBe("Backup");
    expect(r.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,FR");
    expect(r.due).toEqual({ at: new Date("2026-10-23T01:00:00Z"), allDay: false });
  });

  it("leaves a word like 'on' alone when no date follows it", () => {
    const r = parseQuickAdd("Check on the dog every day", ctx);
    expect(r.title).toBe("Check on the dog");
  });
});
