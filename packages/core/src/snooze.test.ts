import { describe, expect, it } from "vitest";
import { snoozeTarget } from "./snooze.ts";

// Tuesday 2026-10-20 18:00 in Manila (UTC+8).
const now = new Date("2026-10-20T10:00:00Z");
const zone = "Asia/Manila";

describe("snoozeTarget", () => {
  it("moves a task with no date to tomorrow, all day", () => {
    const result = snoozeTarget({ dueAt: null, dueAllDay: false }, now, zone);
    expect(result).toEqual({ dueAt: new Date("2026-10-20T16:00:00Z"), dueAllDay: true, dueTz: zone });
  });

  it("keeps the time of day of a timed task", () => {
    const result = snoozeTarget({ dueAt: new Date("2026-11-03T07:30:00Z"), dueAllDay: false }, now, zone);
    expect(result).toEqual({ dueAt: new Date("2026-10-21T07:30:00Z"), dueAllDay: false, dueTz: zone });
  });

  it("brings an overdue task forward to tomorrow, not to the day after its old date", () => {
    const result = snoozeTarget({ dueAt: new Date("2026-10-01T01:00:00Z"), dueAllDay: false }, now, zone);
    expect(result.dueAt).toEqual(new Date("2026-10-21T01:00:00Z")); // 09:00 Manila, as before
  });

  it("keeps an all-day task all-day", () => {
    const result = snoozeTarget({ dueAt: new Date("2026-10-18T16:00:00Z"), dueAllDay: true }, now, zone);
    expect(result).toEqual({ dueAt: new Date("2026-10-20T16:00:00Z"), dueAllDay: true, dueTz: zone });
  });

  it("lands on a real time when tomorrow's time does not exist (spring-forward gap)", () => {
    const ny = "America/New_York";
    const saturday = new Date("2026-03-07T20:00:00Z");
    const result = snoozeTarget({ dueAt: new Date("2026-03-01T07:30:00Z"), dueAllDay: false }, saturday, ny);
    expect(Number.isNaN(result.dueAt.getTime())).toBe(false);
    expect(result.dueAt.toISOString().slice(0, 10)).toBe("2026-03-08");
  });
});
