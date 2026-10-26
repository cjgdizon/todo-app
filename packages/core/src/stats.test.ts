import { describe, expect, it } from "vitest";
import { countByDay, currentStreak, lastDays, minutesByDay } from "./stats.ts";

// 18:00 on Monday 26 October 2026 in Manila (UTC+8).
const now = new Date("2026-10-26T10:00:00Z");
const zone = "Asia/Manila";

describe("lastDays", () => {
  it("lists the days up to and including today, oldest first, in the person's zone", () => {
    expect(lastDays(now, zone, 3)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  });

  it("uses the local date even when UTC is still on the previous day", () => {
    expect(lastDays(new Date("2026-10-25T17:30:00Z"), zone, 1)).toEqual(["2026-10-26"]);
  });

  it("refuses a count below one", () => {
    expect(() => lastDays(now, zone, 0)).toThrow();
  });
});

describe("countByDay", () => {
  it("counts events on the day they happened locally and ignores the rest", () => {
    const counts = countByDay(
      [
        new Date("2026-10-25T17:00:00Z"), // 01:00 on the 26th in Manila
        new Date("2026-10-26T02:00:00Z"),
        new Date("2026-10-24T03:00:00Z"),
        new Date("2026-10-20T03:00:00Z"), // before the window
        new Date("2026-10-27T03:00:00Z"), // after it
      ],
      now,
      zone,
      3,
    );
    expect(counts).toEqual([
      { date: "2026-10-24", count: 1 },
      { date: "2026-10-25", count: 0 },
      { date: "2026-10-26", count: 2 },
    ]);
  });
});

describe("minutesByDay", () => {
  it("splits time that runs past midnight between the two days", () => {
    const counts = minutesByDay(
      [{ startedAt: new Date("2026-10-25T15:30:00Z"), endedAt: new Date("2026-10-25T16:30:00Z") }], // 23:30 to 00:30
      now,
      zone,
      2,
    );
    expect(counts).toEqual([
      { date: "2026-10-25", count: 30 },
      { date: "2026-10-26", count: 30 },
    ]);
  });

  it("counts a running timer up to now", () => {
    const counts = minutesByDay([{ startedAt: new Date("2026-10-26T09:15:00Z"), endedAt: null }], now, zone, 1);
    expect(counts).toEqual([{ date: "2026-10-26", count: 45 }]);
  });

  it("adds up several entries and rounds to whole minutes", () => {
    const counts = minutesByDay(
      [
        { startedAt: new Date("2026-10-26T08:00:00Z"), endedAt: new Date("2026-10-26T08:10:20Z") },
        { startedAt: new Date("2026-10-26T09:00:00Z"), endedAt: new Date("2026-10-26T09:05:00Z") },
      ],
      now,
      zone,
      1,
    );
    expect(counts).toEqual([{ date: "2026-10-26", count: 15 }]);
  });
});

describe("currentStreak", () => {
  const days = (counts: number[]) => counts.map((count, i) => ({ date: `d${i}`, count }));

  it("counts consecutive days that ended today", () => {
    expect(currentStreak(days([0, 2, 3, 1]))).toBe(3);
  });

  it("keeps the streak alive while today has nothing yet", () => {
    expect(currentStreak(days([2, 3, 0]))).toBe(2);
  });

  it("is zero when yesterday and today are both empty", () => {
    expect(currentStreak(days([4, 0, 0]))).toBe(0);
    expect(currentStreak([])).toBe(0);
  });

  it("stops at the first empty day", () => {
    expect(currentStreak(days([1, 0, 2]))).toBe(1);
  });
});
