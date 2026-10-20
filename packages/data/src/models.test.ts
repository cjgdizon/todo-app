import { describe, expect, it } from "vitest";
import { parseLabel, parseProfile, parseProject, parseTask } from "./models.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const taskRow = {
  assignee_id: null,
  completed_at: null,
  created_at: "2026-10-20T10:00:00+00:00",
  created_by: uuid(9),
  deleted_at: null,
  due_all_day: false,
  due_at: "2026-10-21T01:00:00+00:00",
  due_tz: "Asia/Manila",
  estimate_min: null,
  id: uuid(1),
  notes: "bring cash",
  parent_id: null,
  position: "a0x",
  priority: 2,
  project_id: uuid(2),
  recur_after_completion: false,
  rrule: "FREQ=WEEKLY;BYDAY=MO",
  search: "'bring':3 'rent':1",
  section_id: null,
  title: "Pay rent",
  updated_at: "2026-10-20T10:00:00+00:00",
  updated_by: uuid(9),
  version: 3,
  workspace_id: uuid(5),
};

describe("parseTask", () => {
  it("maps a database row to the app model", () => {
    const task = parseTask(taskRow, [uuid(7)]);
    expect(task).toEqual({
      id: uuid(1),
      workspaceId: uuid(5),
      projectId: uuid(2),
      sectionId: null,
      parentId: null,
      title: "Pay rent",
      notes: "bring cash",
      priority: 2,
      dueAt: new Date("2026-10-21T01:00:00Z"),
      dueAllDay: false,
      dueTz: "Asia/Manila",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      recurAfterCompletion: false,
      position: "a0x",
      completedAt: null,
      labelIds: [uuid(7)],
      version: 3,
    });
  });

  it("parses completed_at into a Date", () => {
    const task = parseTask({ ...taskRow, completed_at: "2026-10-20T11:00:00+00:00" }, []);
    expect(task.completedAt).toEqual(new Date("2026-10-20T11:00:00Z"));
  });

  it("rejects a priority outside 1-4", () => {
    expect(() => parseTask({ ...taskRow, priority: 9 }, [])).toThrow();
  });

  it("rejects a row with a missing title", () => {
    expect(() => parseTask({ ...taskRow, title: undefined }, [])).toThrow();
  });

  it("rejects an unparseable due date", () => {
    expect(() => parseTask({ ...taskRow, due_at: "not a date" }, [])).toThrow();
  });
});

describe("parseProject, parseLabel, parseProfile", () => {
  it("maps a project row", () => {
    expect(
      parseProject({
        id: uuid(2),
        workspace_id: uuid(5),
        name: "Home",
        color: "#3f7d6b",
        position: "a0",
        archived_at: null,
        deleted_at: null,
        created_at: "2026-10-20T10:00:00+00:00",
        updated_at: "2026-10-20T10:00:00+00:00",
        updated_by: null,
        version: 1,
      }),
    ).toEqual({
      id: uuid(2),
      workspaceId: uuid(5),
      name: "Home",
      color: "#3f7d6b",
      position: "a0",
      archived: false,
    });
  });

  it("flags an archived project", () => {
    const project = parseProject({
      id: uuid(2),
      workspace_id: uuid(5),
      name: "Old",
      color: null,
      position: "a0",
      archived_at: "2026-10-01T00:00:00+00:00",
      deleted_at: null,
      created_at: "2026-10-01T00:00:00+00:00",
      updated_at: "2026-10-01T00:00:00+00:00",
      updated_by: null,
      version: 1,
    });
    expect(project.archived).toBe(true);
  });

  it("maps a label row", () => {
    expect(
      parseLabel({
        id: uuid(7),
        workspace_id: uuid(5),
        name: "bills",
        color: null,
        deleted_at: null,
        created_at: "2026-10-20T10:00:00+00:00",
        updated_at: "2026-10-20T10:00:00+00:00",
        updated_by: null,
        version: 1,
      }),
    ).toEqual({ id: uuid(7), workspaceId: uuid(5), name: "bills", color: null });
  });

  it("maps a profile row", () => {
    expect(
      parseProfile({
        id: uuid(9),
        display_name: "Cj",
        avatar_url: null,
        timezone: "Asia/Manila",
        created_at: "2026-10-20T10:00:00+00:00",
      }),
    ).toEqual({ id: uuid(9), displayName: "Cj", timeZone: "Asia/Manila" });
  });
});
