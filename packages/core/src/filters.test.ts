import { describe, expect, it } from "vitest";
import { FilterParseError, matchesFilter, parseFilter, type FilterTask } from "./filters";

// Tuesday 2026-10-20 18:00 in Manila (UTC+8). Local week is Mon Oct 19 - Sun Oct 25.
const ctx = { now: new Date("2026-10-20T10:00:00Z"), timeZone: "Asia/Manila" };

function task(over: Partial<FilterTask> = {}): FilterTask {
  return {
    title: "Buy milk",
    notes: null,
    priority: 4,
    projectName: null,
    labelNames: [],
    dueAt: null,
    dueAllDay: false,
    completedAt: null,
    ...over,
  };
}
const m = (query: string, t: FilterTask) => matchesFilter(parseFilter(query), t, ctx);

describe("filters: simple terms", () => {
  it("matches priority", () => {
    expect(m("p1", task({ priority: 1 }))).toBe(true);
    expect(m("p1", task({ priority: 2 }))).toBe(false);
  });

  it("matches project and label names case-insensitively", () => {
    expect(m("#work", task({ projectName: "Work" }))).toBe(true);
    expect(m("#work", task({ projectName: "Home" }))).toBe(false);
    expect(m("#work", task({ projectName: null }))).toBe(false);
    expect(m("@urgent", task({ labelNames: ["Urgent", "x"] }))).toBe(true);
    expect(m("@urgent", task({ labelNames: ["x"] }))).toBe(false);
  });

  it("matches text in title or notes, including quoted phrases", () => {
    expect(m("milk", task())).toBe(true);
    expect(m("MILK", task())).toBe(true);
    expect(m("bread", task({ notes: "Also get bread" }))).toBe(true);
    expect(m('"buy milk"', task())).toBe(true);
    expect(m('"milk buy"', task())).toBe(false);
  });
});

describe("filters: boolean logic", () => {
  const urgentWork = task({ priority: 1, projectName: "work", labelNames: ["urgent"] });

  it("supports & and implicit AND", () => {
    expect(m("p1 & #work", urgentWork)).toBe(true);
    expect(m("p1 #work", urgentWork)).toBe(true);
    expect(m("p1 & #home", urgentWork)).toBe(false);
  });

  it("supports | and !", () => {
    expect(m("p2 | p1", urgentWork)).toBe(true);
    expect(m("!p1", urgentWork)).toBe(false);
    expect(m("!p2", urgentWork)).toBe(true);
  });

  it("gives & higher precedence than |", () => {
    // p1 | (p2 & @x): urgentWork is p1, so it matches even without @x.
    expect(m("p1 | p2 & @x", urgentWork)).toBe(true);
    // (p2 | p1) & @x: needs @x, which urgentWork lacks.
    expect(m("(p2 | p1) & @x", urgentWork)).toBe(false);
    expect(m("(p2 | p1) & @urgent", urgentWork)).toBe(true);
  });

  it("supports nested negation and parentheses", () => {
    expect(m("!(p2 | p3)", urgentWork)).toBe(true);
    expect(m("!!p1", urgentWork)).toBe(true);
  });
});

describe("filters: due dates (local time, week starts Monday)", () => {
  // Local-time helpers expressed as UTC instants for Manila.
  const todayMorning = new Date("2026-10-20T00:00:00Z"); // 08:00 local, already past
  const todayEvening = new Date("2026-10-20T14:00:00Z"); // 22:00 local, still ahead
  const tomorrow = new Date("2026-10-21T01:00:00Z"); // 09:00 local Wed
  const nextMonday = new Date("2026-10-26T01:00:00Z");

  it("matches today and tomorrow", () => {
    expect(m("due:today", task({ dueAt: todayMorning }))).toBe(true);
    expect(m("due:today", task({ dueAt: tomorrow }))).toBe(false);
    expect(m("due:tomorrow", task({ dueAt: tomorrow }))).toBe(true);
  });

  it("treats a timed task earlier today as overdue but an all-day task today as not yet", () => {
    expect(m("due:overdue", task({ dueAt: todayMorning }))).toBe(true);
    expect(m("due:overdue", task({ dueAt: todayEvening }))).toBe(false);
    // All-day: stored as local midnight today; overdue only after the day ends.
    expect(m("due:overdue", task({ dueAt: new Date("2026-10-19T16:00:00Z"), dueAllDay: true }))).toBe(false);
    expect(m("due:overdue", task({ dueAt: new Date("2026-10-18T16:00:00Z"), dueAllDay: true }))).toBe(true);
  });

  it("never reports completed tasks as overdue", () => {
    expect(m("due:overdue", task({ dueAt: todayMorning, completedAt: new Date("2026-10-20T01:00:00Z") }))).toBe(false);
  });

  it("matches this week, next week, and the next 7 days", () => {
    expect(m("due:this week", task({ dueAt: tomorrow }))).toBe(true);
    expect(m("due:this week", task({ dueAt: nextMonday }))).toBe(false);
    expect(m("due:next week", task({ dueAt: nextMonday }))).toBe(true);
    expect(m("due:next 7 days", task({ dueAt: tomorrow }))).toBe(true);
    expect(m("due:next 7 days", task({ dueAt: new Date("2026-10-27T01:00:00Z") }))).toBe(false); // day 8
  });

  it("matches an exact local date", () => {
    expect(m("due:2026-10-21", task({ dueAt: tomorrow }))).toBe(true);
    expect(m("due:2026-10-22", task({ dueAt: tomorrow }))).toBe(false);
  });

  it("matches tasks without a date", () => {
    expect(m("no date", task())).toBe(true);
    expect(m("due:none", task())).toBe(true);
    expect(m("no date", task({ dueAt: tomorrow }))).toBe(false);
  });

  it("combines with other terms after a multi-word due value", () => {
    expect(m("due:this week & p1", task({ dueAt: tomorrow, priority: 1 }))).toBe(true);
    expect(m("due:this week p1", task({ dueAt: tomorrow, priority: 2 }))).toBe(false);
  });
});

describe("filters: errors", () => {
  it("rejects an empty query", () => {
    expect(() => parseFilter("   ")).toThrow(FilterParseError);
  });

  it("rejects dangling operators and unbalanced parentheses", () => {
    expect(() => parseFilter("p1 &")).toThrow(FilterParseError);
    expect(() => parseFilter("| p1")).toThrow(FilterParseError);
    expect(() => parseFilter("(p1 | p2")).toThrow(FilterParseError);
    expect(() => parseFilter("p1 )")).toThrow(FilterParseError);
  });

  it("rejects an unknown due value and names it", () => {
    expect(() => parseFilter("due:someday")).toThrow(/someday/);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseFilter('"buy milk')).toThrow(FilterParseError);
  });
});
