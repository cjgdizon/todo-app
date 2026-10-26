import { describe, expect, it } from "vitest";
import { formatBytes, formatClock, formatDue, formatMinutes } from "./format.ts";

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

describe("formatClock", () => {
  it.each([
    [0, "0:00"],
    [5_000, "0:05"],
    [65_000, "1:05"],
    [3_599_000, "59:59"],
    [3_600_000, "1:00:00"],
    [3_725_000, "1:02:05"],
    [-4_000, "0:00"],
  ])("shows %i ms as %s", (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });
});

describe("formatMinutes", () => {
  it.each([
    [0, "0m"],
    [5, "5m"],
    [60, "1h"],
    [80, "1h 20m"],
    [605, "10h 5m"],
  ])("shows %i minutes as %s", (minutes, text) => {
    expect(formatMinutes(minutes)).toBe(text);
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024, "1 MB"],
    [10 * 1024 * 1024, "10 MB"],
    [-5, "0 B"],
  ])("shows %i bytes as %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
