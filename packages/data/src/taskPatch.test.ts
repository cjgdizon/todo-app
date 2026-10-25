import { describe, expect, it } from "vitest";
import type { Task } from "./models.ts";
import { applyTaskChange } from "./taskPatch.ts";

const task: Task = {
  id: "t1",
  workspaceId: "w1",
  projectId: "p1",
  sectionId: null,
  parentId: null,
  assigneeId: null,
  title: "Pay rent",
  notes: null,
  priority: 4,
  dueAt: new Date("2026-10-21T01:00:00Z"),
  dueAllDay: false,
  dueTz: "Asia/Manila",
  rrule: null,
  recurAfterCompletion: false,
  position: "a0",
  completedAt: null,
  labelIds: ["l1"],
  version: 1,
};

describe("applyTaskChange", () => {
  it("applies only the fields that are present", () => {
    const next = applyTaskChange(task, { title: "Pay the rent", priority: 1 });
    expect(next).toEqual({ ...task, title: "Pay the rent", priority: 1 });
  });

  it("can clear nullable fields", () => {
    const next = applyTaskChange(task, { dueAt: null, projectId: null, notes: null });
    expect(next).toMatchObject({ dueAt: null, projectId: null, notes: null });
  });

  it("sets and clears the section", () => {
    const placed = applyTaskChange(task, { sectionId: "s1" });
    expect(placed?.sectionId).toBe("s1");
    expect(applyTaskChange(placed as Task, { sectionId: null })?.sectionId).toBeNull();
  });

  it("assigns and unassigns a member", () => {
    const assigned = applyTaskChange(task, { assigneeId: "u1" });
    expect(assigned?.assigneeId).toBe("u1");
    expect(applyTaskChange(assigned as Task, { assigneeId: null })?.assigneeId).toBeNull();
  });

  it("moves to another project and out of its section in one change", () => {
    const inSection = { ...task, sectionId: "s1" };
    expect(applyTaskChange(inSection, { projectId: "p2", sectionId: null })).toMatchObject({
      projectId: "p2",
      sectionId: null,
    });
  });

  it("replaces the label ids", () => {
    expect(applyTaskChange(task, { labelIds: ["l2", "l3"] })?.labelIds).toEqual(["l2", "l3"]);
  });

  it("sets completedAt and clears it again", () => {
    const done = applyTaskChange(task, { completedAt: new Date("2026-10-20T10:00:00Z") });
    expect(done?.completedAt).toEqual(new Date("2026-10-20T10:00:00Z"));
    expect(applyTaskChange(done as Task, { completedAt: null })?.completedAt).toBeNull();
  });

  it("returns null when the task is moved to the trash", () => {
    expect(applyTaskChange(task, { deletedAt: new Date("2026-10-20T10:00:00Z") })).toBeNull();
  });

  it("keeps the task when deletedAt is null (restore)", () => {
    expect(applyTaskChange(task, { deletedAt: null })).toEqual(task);
  });

  it("does not mutate the original task", () => {
    applyTaskChange(task, { title: "Changed", labelIds: [] });
    expect(task.title).toBe("Pay rent");
    expect(task.labelIds).toEqual(["l1"]);
  });
});
