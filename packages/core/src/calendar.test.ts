import { describe, expect, it } from "vitest";
import { groupTasksByDay, monthGrid, rescheduleToDay, shiftMonth } from "./calendar.ts";

describe("monthGrid", () => {
  it("lays a month out in Monday-first weeks, padded with the neighbouring days", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const weeks = monthGrid(2026, 10);
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(weeks[4]?.[6]).toBe("2026-11-01");
  });

  it("uses only four weeks for a February that fits exactly", () => {
    // February 2027 starts on a Monday and has 28 days.
    const weeks = monthGrid(2027, 2);
    expect(weeks).toHaveLength(4);
    expect(weeks[0]?.[0]).toBe("2027-02-01");
    expect(weeks[3]?.[6]).toBe("2027-02-28");
  });

  it("uses six weeks when the month needs them", () => {
    // August 2026 starts on a Saturday and has 31 days.
    const weeks = monthGrid(2026, 8);
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.[0]).toBe("2026-07-27");
    expect(weeks[5]?.[0]).toBe("2026-08-31");
  });

  it("contains every day of the month exactly once, in order", () => {
    const days = monthGrid(2028, 2).flat();
    const inMonth = days.filter((d) => d.startsWith("2028-02"));
    expect(inMonth).toHaveLength(29); // leap year
    expect([...days].sort()).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
  });
});

describe("shiftMonth", () => {
  it("moves forward and back", () => {
    expect(shiftMonth(2026, 10, 1)).toEqual({ year: 2026, month: 11 });
    expect(shiftMonth(2026, 10, -1)).toEqual({ year: 2026, month: 9 });
  });

  it("rolls over the year in both directions", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("can move several months at once", () => {
    expect(shiftMonth(2026, 11, 14)).toEqual({ year: 2028, month: 1 });
  });
});

describe("groupTasksByDay", () => {
  const task = (id: string, iso: string | null) => ({ id, dueAt: iso === null ? null : new Date(iso) });

  it("groups by the local day in the given zone and skips undated tasks", () => {
    const groups = groupTasksByDay(
      [
        task("a", "2026-10-20T20:00:00Z"), // Oct 21 04:00 in Manila
        task("b", "2026-10-21T01:00:00Z"), // Oct 21 09:00 in Manila
        task("c", "2026-10-20T10:00:00Z"), // Oct 20 18:00 in Manila
        task("none", null),
      ],
      "Asia/Manila",
    );
    expect(groups.get("2026-10-21")?.map((t) => t.id)).toEqual(["a", "b"]);
    expect(groups.get("2026-10-20")?.map((t) => t.id)).toEqual(["c"]);
    expect(groups.size).toBe(2);
  });

  it("reads the same instants as different days in another zone", () => {
    const groups = groupTasksByDay([task("a", "2026-10-20T20:00:00Z")], "UTC");
    expect([...groups.keys()]).toEqual(["2026-10-20"]);
  });
});

describe("rescheduleToDay", () => {
  it("keeps the local time of day when a timed task moves to another day", () => {
    const moved = rescheduleToDay(
      { dueAt: new Date("2026-10-21T01:00:00Z"), dueAllDay: false }, // 09:00 Manila
      "2026-10-23",
      "Asia/Manila",
    );
    expect(moved).toEqual(new Date("2026-10-23T01:00:00Z"));
  });

  it("moves an all-day task to the start of the new local day", () => {
    const moved = rescheduleToDay(
      { dueAt: new Date("2026-10-20T16:00:00Z"), dueAllDay: true }, // Oct 21 00:00 Manila
      "2026-10-23",
      "Asia/Manila",
    );
    expect(moved).toEqual(new Date("2026-10-22T16:00:00Z"));
  });

  it("keeps wall-clock time across a daylight-saving change", () => {
    // 09:00 in New York is 13:00Z before the clocks change (EDT) and 14:00Z after (EST).
    const moved = rescheduleToDay(
      { dueAt: new Date("2026-10-30T13:00:00Z"), dueAllDay: false },
      "2026-11-03",
      "America/New_York",
    );
    expect(moved).toEqual(new Date("2026-11-03T14:00:00Z"));
  });

  it("returns null for text that is not a day", () => {
    expect(
      rescheduleToDay({ dueAt: new Date("2026-10-21T01:00:00Z"), dueAllDay: false }, "tomorrow", "UTC"),
    ).toBeNull();
  });
});
