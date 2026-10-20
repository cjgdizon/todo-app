import { describe, expect, it } from "vitest";
import type { Label, Project, Section, Task } from "./models.ts";
import { importContextFrom, toExchangeData } from "./transfer.ts";

const task = (overrides: Partial<Task> & { id: string; title: string }): Task => ({
  workspaceId: "w",
  projectId: null,
  sectionId: null,
  parentId: null,
  notes: null,
  priority: 4,
  dueAt: null,
  dueAllDay: false,
  dueTz: null,
  rrule: null,
  recurAfterCompletion: false,
  position: "a0",
  completedAt: null,
  labelIds: [],
  version: 1,
  ...overrides,
});

const project = (id: string, name: string, position: string, archived = false): Project => ({
  id,
  workspaceId: "w",
  name,
  color: null,
  position,
  archived,
});
const section = (id: string, projectId: string, name: string, position: string): Section => ({
  id,
  workspaceId: "w",
  projectId,
  name,
  position,
});
const label = (id: string, name: string): Label => ({ id, workspaceId: "w", name, color: "#123456" });

describe("toExchangeData", () => {
  it("turns app models into the export shape, in display order", () => {
    const data = toExchangeData({
      projects: [project("p2", "Later", "a1"), project("p1", "Now", "a0", true)],
      sections: [section("s2", "p1", "Done", "a1"), section("s1", "p1", "Doing", "a0")],
      labels: [label("l1", "bills")],
      tasks: [
        task({ id: "t2", title: "second", position: "a1", priority: 2 }),
        task({
          id: "t1",
          title: "first",
          position: "a0",
          projectId: "p1",
          sectionId: "s1",
          dueAt: new Date("2026-11-01T01:00:00Z"),
          dueAllDay: true,
          dueTz: "Asia/Manila",
          rrule: "FREQ=DAILY",
          recurAfterCompletion: true,
          completedAt: new Date("2026-10-20T10:00:00Z"),
          labelIds: ["l1"],
          notes: "n",
        }),
      ],
    });

    expect(data.projects.map((p) => [p.id, p.name, p.archived])).toEqual([
      ["p1", "Now", true],
      ["p2", "Later", false],
    ]);
    expect(data.sections.map((s) => s.name)).toEqual(["Doing", "Done"]);
    expect(data.labels).toEqual([{ id: "l1", name: "bills", color: "#123456" }]);
    expect(data.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(data.tasks[0]).toEqual({
      id: "t1",
      parentId: null,
      projectId: "p1",
      sectionId: "s1",
      title: "first",
      notes: "n",
      priority: 4,
      dueAt: "2026-11-01T01:00:00.000Z",
      dueAllDay: true,
      dueTz: "Asia/Manila",
      rrule: "FREQ=DAILY",
      recurAfterCompletion: true,
      completedAt: "2026-10-20T10:00:00.000Z",
      labelIds: ["l1"],
    });
  });

  it("exports an empty workspace as empty lists", () => {
    expect(toExchangeData({ projects: [], sections: [], labels: [], tasks: [] })).toEqual({
      projects: [],
      sections: [],
      labels: [],
      tasks: [],
    });
  });
});

describe("importContextFrom", () => {
  const now = new Date("2026-10-21T00:00:00Z");

  it("passes through what exists and the user's time zone", () => {
    const ctx = importContextFrom({
      projects: [project("p1", "Home", "a3")],
      sections: [section("s1", "p1", "Doing", "a2")],
      labels: [label("l1", "bills")],
      tasks: [],
      timeZone: "Asia/Manila",
      now,
    });
    expect(ctx).toMatchObject({
      timeZone: "Asia/Manila",
      now,
      existingProjects: [{ id: "p1", name: "Home" }],
      existingSections: [{ id: "s1", projectId: "p1", name: "Doing", position: "a2" }],
      existingLabels: [{ id: "l1", name: "bills" }],
      projectsEnd: "a3",
    });
  });

  it("finds the last top-level position in each project and in the Inbox, ignoring subtasks", () => {
    const ctx = importContextFrom({
      projects: [],
      sections: [],
      labels: [],
      tasks: [
        task({ id: "a", title: "a", position: "a1" }),
        task({ id: "b", title: "b", position: "a7" }),
        task({ id: "c", title: "c", position: "a3", projectId: "p1" }),
        task({ id: "d", title: "d", position: "zz", parentId: "a" }),
      ],
      timeZone: "UTC",
      now,
    });
    expect(ctx.topLevelEnd.get("")).toBe("a7");
    expect(ctx.topLevelEnd.get("p1")).toBe("a3");
    expect(ctx.topLevelEnd.size).toBe(2);
    expect(ctx.projectsEnd).toBeNull();
  });
});
