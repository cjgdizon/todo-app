import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { RecurrenceError, nextDue, validateRrule } from "./recurrence";

const NY = "America/New_York";
const iso = (d: Date | null) => d?.toISOString() ?? null;
const at = (s: string) => new Date(s);

/** Fixed-schedule helper: completed at the due instant. */
function next(rrule: string, due: string, extra: Partial<Parameters<typeof nextDue>[0]> = {}) {
  return nextDue({
    rrule,
    dueAt: at(due),
    completedAt: at(due),
    timeZone: NY,
    afterCompletion: false,
    ...extra,
  });
}

describe("nextDue: fixed schedules", () => {
  it("repeats daily and keeps local wall time across spring-forward DST", () => {
    // 09:00 EST (UTC-5) on Mar 7 -> 09:00 EDT (UTC-4) on Mar 8.
    expect(iso(next("FREQ=DAILY", "2026-03-07T14:00:00Z"))).toBe("2026-03-08T13:00:00.000Z");
  });

  it("moves a time that does not exist (DST gap) forward instead of failing", () => {
    // 02:30 does not exist on Mar 8 in New York; it becomes 03:30 EDT.
    expect(iso(next("FREQ=DAILY", "2026-03-07T07:30:00Z"))).toBe("2026-03-08T07:30:00.000Z");
  });

  it("keeps local wall time across fall-back DST", () => {
    const result = next("FREQ=DAILY", "2026-10-31T05:30:00Z"); // 01:30 EDT
    const local = DateTime.fromJSDate(result!, { zone: NY });
    expect(local.toISODate()).toBe("2026-11-01");
    expect([local.hour, local.minute]).toEqual([1, 30]);
  });

  it("supports intervals (every 2 weeks)", () => {
    expect(iso(next("FREQ=WEEKLY;INTERVAL=2", "2026-10-05T13:00:00Z"))).toBe("2026-10-19T13:00:00.000Z");
  });

  it("supports multiple weekdays and walks them in order", () => {
    const rule = "FREQ=WEEKLY;BYDAY=TU,TH";
    expect(iso(next(rule, "2026-10-06T13:00:00Z"))).toBe("2026-10-08T13:00:00.000Z"); // Tue -> Thu
    expect(iso(next(rule, "2026-10-08T13:00:00Z"))).toBe("2026-10-13T13:00:00.000Z"); // Thu -> Tue
  });

  it("skips occurrences that were already missed when completed late", () => {
    // Weekly on Thursdays; completed Tue Oct 20 -> next is Thu Oct 22, not Oct 8.
    const result = next("FREQ=WEEKLY", "2026-10-01T13:00:00Z", {
      completedAt: at("2026-10-20T15:00:00Z"),
    });
    expect(iso(result)).toBe("2026-10-22T13:00:00.000Z");
  });

  it("follows RFC 5545 for the 31st: short months are skipped", () => {
    expect(iso(next("FREQ=MONTHLY;BYMONTHDAY=31", "2026-01-31T14:00:00Z"))).toBe(
      "2026-03-31T13:00:00.000Z",
    );
  });

  it("supports the last day of the month via BYMONTHDAY=-1", () => {
    expect(iso(next("FREQ=MONTHLY;BYMONTHDAY=-1", "2026-01-31T14:00:00Z"))).toBe(
      "2026-02-28T14:00:00.000Z",
    );
  });

  it("repeats yearly", () => {
    expect(iso(next("FREQ=YEARLY", "2026-10-20T13:00:00Z"))).toBe("2027-10-20T13:00:00.000Z");
  });

  it("returns null once UNTIL has passed", () => {
    expect(next("FREQ=DAILY;UNTIL=20261005T235959Z", "2026-10-05T13:00:00Z")).toBeNull();
  });

  it("accepts an RRULE: prefix", () => {
    expect(iso(next("RRULE:FREQ=DAILY", "2026-10-05T13:00:00Z"))).toBe("2026-10-06T13:00:00.000Z");
  });

  it("never returns an instant at or before the due date or completion time", () => {
    const due = "2026-10-05T13:00:00Z";
    const completedAt = at("2026-10-05T20:00:00Z");
    const result = next("FREQ=DAILY", due, { completedAt });
    expect(result!.getTime()).toBeGreaterThan(completedAt.getTime());
  });
});

describe("nextDue: after completion", () => {
  it("counts the interval from the completion date and keeps the original time of day", () => {
    // Every 3 days after completion; due 09:00 EDT, completed Oct 20 11:00 EDT.
    const result = nextDue({
      rrule: "FREQ=DAILY;INTERVAL=3",
      dueAt: at("2026-10-01T13:00:00Z"),
      completedAt: at("2026-10-20T15:00:00Z"),
      timeZone: NY,
      afterCompletion: true,
    });
    expect(iso(result)).toBe("2026-10-23T13:00:00.000Z");
  });
});

describe("validateRrule", () => {
  it("accepts common rules", () => {
    expect(() => validateRrule("FREQ=DAILY")).not.toThrow();
    expect(() => validateRrule("FREQ=WEEKLY;BYDAY=MO,WE,FR")).not.toThrow();
    expect(() => validateRrule("RRULE:FREQ=MONTHLY;BYMONTHDAY=1")).not.toThrow();
  });

  it("rejects COUNT, because each next date is computed from the current one", () => {
    expect(() => validateRrule("FREQ=DAILY;COUNT=3")).toThrow(RecurrenceError);
  });

  it("rejects DTSTART, EXDATE, RDATE and multi-line input", () => {
    expect(() => validateRrule("DTSTART:20261005T090000Z\nRRULE:FREQ=DAILY")).toThrow(RecurrenceError);
    expect(() => validateRrule("FREQ=DAILY\nEXDATE:20261006T090000Z")).toThrow(RecurrenceError);
  });

  it("rejects garbage and an empty string", () => {
    expect(() => validateRrule("")).toThrow(RecurrenceError);
    expect(() => validateRrule("every other day")).toThrow(RecurrenceError);
    expect(() => validateRrule("FREQ=SOMETIMES")).toThrow(RecurrenceError);
  });

  it("is enforced by nextDue", () => {
    expect(() => next("FREQ=DAILY;COUNT=2", "2026-10-05T13:00:00Z")).toThrow(RecurrenceError);
  });
});
