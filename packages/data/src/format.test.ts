import { describe, expect, it } from "vitest";
import { formatDue } from "./format.ts";

// Tuesday 2026-10-20 18:00 in Manila (UTC+8).
const ctx = { now: new Date("2026-10-20T10:00:00Z"), timeZone: "Asia/Manila" };

describe("formatDue", () => {
  it("says Today for an all-day task due today", () => {
    expect(formatDue({ dueAt: new Date("2026-10-19T16:00:00Z"), dueAllDay: true }, ctx)).toEqual({
      label: "Today",
      overdue: false,
    });
  });

  it("adds the time for a timed task and uses Tomorrow", () => {
    expect(formatDue({ dueAt: new Date("2026-10-21T01:00:00Z"), dueAllDay: false }, ctx)).toEqual({
      label: "Tomorrow, 9:00 AM",
      overdue: false,
    });
  });

  it("flags a timed task whose time has passed as overdue", () => {
    expect(formatDue({ dueAt: new Date("2026-10-20T09:00:00Z"), dueAllDay: false }, ctx)).toEqual({
      label: "Today, 5:00 PM",
      overdue: true,
    });
  });

  it("says Yesterday and flags an all-day task from yesterday", () => {
    expect(formatDue({ dueAt: new Date("2026-10-18T16:00:00Z"), dueAllDay: true }, ctx)).toEqual({
      label: "Yesterday",
      overdue: true,
    });
  });

  it("uses the weekday and date within this year", () => {
    expect(formatDue({ dueAt: new Date("2026-10-22T16:00:00Z"), dueAllDay: true }, ctx).label).toBe(
      "Fri, Oct 23",
    );
  });

  it("includes the year for another year", () => {
    expect(formatDue({ dueAt: new Date("2027-02-28T16:00:00Z"), dueAllDay: true }, ctx).label).toBe(
      "Mar 1, 2027",
    );
  });

  it("reads the day in the viewer's zone, not UTC", () => {
    // 2026-10-20T20:00Z is already Oct 21 in Manila.
    expect(formatDue({ dueAt: new Date("2026-10-20T20:00:00Z"), dueAllDay: false }, ctx).label).toBe(
      "Tomorrow, 4:00 AM",
    );
  });
});
