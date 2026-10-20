import { parseQuickAdd } from "@todo/core";
import { describe, expect, it } from "vitest";
import { positionAtEnd, taskInputFromQuickAdd } from "./taskInput.ts";

// Tuesday 2026-10-20 18:00 in Manila.
const ctx = { now: new Date("2026-10-20T10:00:00Z"), timeZone: "Asia/Manila" };
const projects = [{ id: "proj-home", name: "Home" }];
const labels = [{ id: "label-bills", name: "bills" }];

describe("taskInputFromQuickAdd", () => {
  it("resolves the project and labels by name, ignoring case", () => {
    const parsed = parseQuickAdd("Pay rent every 1st at 9am #home p2 @Bills", ctx);
    const input = taskInputFromQuickAdd(parsed, { projects, labels, timeZone: ctx.timeZone });
    expect(input).toEqual({
      title: "Pay rent",
      priority: 2,
      projectId: "proj-home",
      labelIds: ["label-bills"],
      newLabelNames: [],
      unknownProject: null,
      dueAt: new Date("2026-11-01T01:00:00Z"),
      dueAllDay: false,
      dueTz: "Asia/Manila",
      rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
      recurAfterCompletion: false,
    });
  });

  it("reports an unknown project instead of creating one", () => {
    const parsed = parseQuickAdd("Call mom #family", ctx);
    const input = taskInputFromQuickAdd(parsed, { projects, labels, timeZone: ctx.timeZone });
    expect(input?.projectId).toBeNull();
    expect(input?.unknownProject).toBe("family");
  });

  it("lists labels that do not exist yet so they can be created", () => {
    const parsed = parseQuickAdd("Call mom @phone @bills", ctx);
    const input = taskInputFromQuickAdd(parsed, { projects, labels, timeZone: ctx.timeZone });
    expect(input?.labelIds).toEqual(["label-bills"]);
    expect(input?.newLabelNames).toEqual(["phone"]);
  });

  it("leaves the due date and zone empty for a plain task", () => {
    const parsed = parseQuickAdd("Buy milk", ctx);
    const input = taskInputFromQuickAdd(parsed, { projects, labels, timeZone: ctx.timeZone });
    expect(input).toMatchObject({
      dueAt: null,
      dueAllDay: false,
      dueTz: null,
      rrule: null,
      priority: 4,
    });
  });

  it("returns null when nothing is left to name the task", () => {
    const parsed = parseQuickAdd("p1 #home", ctx);
    expect(taskInputFromQuickAdd(parsed, { projects, labels, timeZone: ctx.timeZone })).toBeNull();
  });

  it("keeps the due zone for an all-day date", () => {
    const parsed = parseQuickAdd("Dentist friday", ctx);
    const input = taskInputFromQuickAdd(parsed, { projects, labels, timeZone: ctx.timeZone });
    expect(input).toMatchObject({ dueAllDay: true, dueTz: "Asia/Manila" });
  });
});

describe("positionAtEnd", () => {
  const task = (id: string, projectId: string | null, parentId: string | null, position: string) => ({
    id,
    projectId,
    parentId,
    position,
  });

  it("starts a list with a valid first key", () => {
    expect(typeof positionAtEnd([], { projectId: null, parentId: null })).toBe("string");
  });

  it("sorts after every task in the same list and ignores other lists", () => {
    const tasks = [
      task("a", "p1", null, "a0"),
      task("b", "p1", null, "a5"),
      task("c", "p2", null, "zz"),
      task("d", "p1", "a", "zy"),
    ];
    const key = positionAtEnd(tasks, { projectId: "p1", parentId: null });
    expect(key > "a5").toBe(true);
    expect(key < "zy").toBe(true);
  });
});
