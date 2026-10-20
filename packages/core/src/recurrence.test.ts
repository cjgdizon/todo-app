import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { RecurrenceError, isValidRrule, nextDue, validateRrule } from "./recurrence";

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

describe("validateRrule: hostile or unsupported rules", () => {
  it.each([
    ["a negative interval (used to hang rrule forever)", "FREQ=DAILY;INTERVAL=-3"],
    ["a zero interval", "FREQ=DAILY;INTERVAL=0"],
    ["a non-numeric interval", "FREQ=DAILY;INTERVAL=abc"],
    ["a daily interval above 999", "FREQ=DAILY;INTERVAL=1000"],
    ["a weekly interval above 520", "FREQ=WEEKLY;INTERVAL=521"],
    ["a monthly interval above 120", "FREQ=MONTHLY;INTERVAL=121"],
    ["a yearly interval above 100", "FREQ=YEARLY;INTERVAL=101"],
    ["BYHOUR", "FREQ=DAILY;BYHOUR=9"],
    ["BYMINUTE", "FREQ=DAILY;BYMINUTE=30"],
    ["BYSECOND", "FREQ=DAILY;BYSECOND=1,2,3"],
    ["BYWEEKNO", "FREQ=YEARLY;BYWEEKNO=20"],
    ["BYYEARDAY", "FREQ=YEARLY;BYYEARDAY=100"],
    ["BYEASTER", "FREQ=YEARLY;BYEASTER=0"],
    ["month day 0", "FREQ=MONTHLY;BYMONTHDAY=0"],
    ["month day 32", "FREQ=MONTHLY;BYMONTHDAY=32"],
    ["month 13", "FREQ=YEARLY;BYMONTH=13"],
    ["set position 400", "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=400"],
    ["a repeated part", "FREQ=DAILY;FREQ=WEEKLY"],
    ["an invalid UNTIL", "FREQ=DAILY;UNTIL=notadate"],
    ["an hourly frequency", "FREQ=HOURLY"],
  ])("rejects %s", (_name, rule) => {
    expect(() => validateRrule(rule)).toThrow(RecurrenceError);
    expect(isValidRrule(rule)).toBe(false);
  });

  it("accepts rules at the documented limits", () => {
    for (const rule of [
      "FREQ=DAILY;INTERVAL=999",
      "FREQ=WEEKLY;INTERVAL=520;BYDAY=MO,WE",
      "FREQ=MONTHLY;INTERVAL=120",
      "FREQ=YEARLY;INTERVAL=100",
      "FREQ=MONTHLY;BYDAY=1MO,-1FR",
      "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1",
      "FREQ=MONTHLY;BYMONTHDAY=-1,15",
      "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29",
      "FREQ=WEEKLY;BYDAY=MO;WKST=SU;UNTIL=20271231T235959Z",
    ]) {
      expect(isValidRrule(rule), rule).toBe(true);
    }
  });
});

describe("nextDue: bounded work", () => {
  it("returns null quickly for rules that can never match", () => {
    for (const rule of ["FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", "FREQ=MONTHLY;BYMONTHDAY=31;BYMONTH=2"]) {
      const started = performance.now();
      expect(next(rule, "2026-10-20T01:00:00Z"), rule).toBeNull();
      // Unbounded, this scan takes many seconds; bounded it runs in a few hundred ms, which can
      // double when other packages' tests share the machine. The budget catches the former only.
      expect(performance.now() - started, rule).toBeLessThan(2000);
    }
  });

  it("still finds the next occurrence of a valid rule at the interval limit", () => {
    expect(iso(next("FREQ=YEARLY;INTERVAL=100", "2026-10-20T13:00:00Z"))).toBe("2126-10-20T13:00:00.000Z");
  });
});
