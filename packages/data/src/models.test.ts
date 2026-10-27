import { describe, expect, it } from "vitest";
import {
  parseActivity,
  parseAttachment,
  parseComment,
  parseInvite,
  parseLabel,
  parseMember,
  parseMembership,
  parseProfile,
  parseReminder,
  parseProject,
  parseSavedFilter,
  parseSection,
  parseTask,
  parseTimeEntry,
} from "./models.ts";

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
      assigneeId: null,
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

  it("keeps the assignee", () => {
    expect(parseTask({ ...taskRow, assignee_id: uuid(8) }, []).assigneeId).toBe(uuid(8));
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

  it("maps a section row", () => {
    expect(
      parseSection({
        id: uuid(11),
        workspace_id: uuid(5),
        project_id: uuid(2),
        name: "Doing",
        position: "a1",
        deleted_at: null,
        created_at: "2026-10-20T10:00:00+00:00",
        updated_at: "2026-10-20T10:00:00+00:00",
        updated_by: null,
        version: 1,
      }),
    ).toEqual({ id: uuid(11), workspaceId: uuid(5), projectId: uuid(2), name: "Doing", position: "a1" });
  });

  it("rejects a section without a project", () => {
    expect(() =>
      parseSection({ id: uuid(11), workspace_id: uuid(5), project_id: null, name: "Doing", position: "a1" }),
    ).toThrow();
  });

  it("maps a saved filter row", () => {
    expect(
      parseSavedFilter({
        id: uuid(8),
        workspace_id: uuid(5),
        owner_id: uuid(9),
        name: "Urgent work",
        query: "p1 & #work",
        deleted_at: null,
        created_at: "2026-10-20T10:00:00+00:00",
        updated_at: "2026-10-20T10:00:00+00:00",
        updated_by: null,
        version: 1,
      }),
    ).toEqual({ id: uuid(8), workspaceId: uuid(5), name: "Urgent work", query: "p1 & #work" });
  });

  it("rejects a saved filter with an empty query", () => {
    expect(() =>
      parseSavedFilter({ id: uuid(8), workspace_id: uuid(5), name: "Empty", query: "" }),
    ).toThrow();
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

describe("collaboration rows", () => {
  it("maps a membership with its workspace, for the workspace switcher", () => {
    expect(
      parseMembership({ role: "admin", workspaces: { id: uuid(5), name: "Team", owner_id: uuid(9) } }),
    ).toEqual({ id: uuid(5), name: "Team", role: "admin" });
  });

  it("maps a member with the display name from the profile", () => {
    expect(
      parseMember({ user_id: uuid(9), role: "member", profiles: { display_name: "Ana" } }),
    ).toEqual({ userId: uuid(9), role: "member", displayName: "Ana" });
  });

  it("falls back to a placeholder when a member has no display name", () => {
    expect(parseMember({ user_id: uuid(9), role: "member", profiles: { display_name: "" } }).displayName).toBe(
      "Unnamed member",
    );
  });

  it("maps a pending invite", () => {
    expect(
      parseInvite({
        id: uuid(3),
        role: "member",
        expires_at: "2026-10-31T10:00:00+00:00",
        created_at: "2026-10-24T10:00:00+00:00",
      }),
    ).toEqual({
      id: uuid(3),
      role: "member",
      expiresAt: new Date("2026-10-31T10:00:00Z"),
      createdAt: new Date("2026-10-24T10:00:00Z"),
    });
  });

  it("rejects an invite for the owner role", () => {
    expect(() =>
      parseInvite({ id: uuid(3), role: "owner", expires_at: "2026-10-31T10:00:00+00:00", created_at: "2026-10-24T10:00:00+00:00" }),
    ).toThrow();
  });

  it("maps a comment", () => {
    expect(
      parseComment({
        id: uuid(4),
        task_id: uuid(1),
        author_id: uuid(9),
        body: "On it",
        edited_at: null,
        mentions: [uuid(8)],
        created_at: "2026-10-24T10:00:00+00:00",
      }),
    ).toEqual({
      id: uuid(4),
      taskId: uuid(1),
      authorId: uuid(9),
      body: "On it",
      editedAt: null,
      mentions: [uuid(8)],
      createdAt: new Date("2026-10-24T10:00:00Z"),
    });
  });

  it("keeps a comment whose author was deleted", () => {
    const comment = parseComment({
      id: uuid(4),
      task_id: uuid(1),
      author_id: null,
      body: "Left behind",
      edited_at: "2026-10-24T11:00:00+00:00",
      mentions: [],
      created_at: "2026-10-24T10:00:00+00:00",
    });
    expect(comment.authorId).toBeNull();
    expect(comment.editedAt).toEqual(new Date("2026-10-24T11:00:00Z"));
  });
});

describe('parseActivity', () => {
  const row = {
    id: 7,
    task_id: uuid(1),
    actor_id: uuid(9),
    action: 'task_assigned',
    meta: { title: 'Pay rent', assignee_id: uuid(8) },
    created_at: '2026-10-26T10:00:00+00:00',
    profiles: { display_name: 'Ana' },
  };

  it('maps an entry with the actor name and details from meta', () => {
    expect(parseActivity(row)).toEqual({
      id: 7,
      action: 'task_assigned',
      actorId: uuid(9),
      actorName: 'Ana',
      taskId: uuid(1),
      title: 'Pay rent',
      assigneeId: uuid(8),
      mentionedId: null,
      createdAt: new Date('2026-10-26T10:00:00Z'),
    });
  });

  it('reads who was mentioned', () => {
    const entry = parseActivity({ ...row, action: 'mentioned', meta: { title: 'Pay rent', user_id: uuid(7) } });
    expect(entry.mentionedId).toBe(uuid(7));
  });

  it('copes with a deleted actor and with missing or odd meta', () => {
    const entry = parseActivity({ ...row, actor_id: null, profiles: null, meta: 'odd', task_id: null });
    expect(entry).toMatchObject({ actorId: null, actorName: null, taskId: null, title: null, assigneeId: null, mentionedId: null });
  });
});

describe('parseReminder', () => {
  const row = {
    task_id: uuid(1),
    offset_min: 60,
    remind_at: '2030-03-15T09:00:00+00:00',
    sent_at: null,
  };

  it('maps a reminder that has not fired yet', () => {
    expect(parseReminder(row)).toEqual({
      taskId: uuid(1),
      offsetMin: 60,
      remindAt: new Date('2030-03-15T09:00:00Z'),
      sent: false,
    });
  });

  it('knows when it has fired', () => {
    expect(parseReminder({ ...row, sent_at: '2030-03-15T09:00:05+00:00' }).sent).toBe(true);
  });

  it('rejects a negative offset', () => {
    expect(() => parseReminder({ ...row, offset_min: -1 })).toThrow();
  });
});

describe('parseTimeEntry', () => {
  const row = { id: uuid(6), task_id: uuid(1), started_at: '2026-10-26T09:00:00+00:00', ended_at: null };

  it('maps a running timer', () => {
    expect(parseTimeEntry(row)).toEqual({
      id: uuid(6),
      taskId: uuid(1),
      startedAt: new Date('2026-10-26T09:00:00Z'),
      endedAt: null,
    });
  });

  it('maps a finished one', () => {
    expect(parseTimeEntry({ ...row, ended_at: '2026-10-26T09:25:00+00:00' }).endedAt).toEqual(
      new Date('2026-10-26T09:25:00Z'),
    );
  });

  it('rejects a row without a start', () => {
    expect(() => parseTimeEntry({ ...row, started_at: undefined })).toThrow();
  });
});

describe("parseAttachment", () => {
  const row = {
    id: uuid(6),
    task_id: uuid(1),
    storage_path: `${uuid(1)}/${uuid(6)}-report.pdf`,
    file_name: "report.pdf",
    mime_type: "application/pdf",
    size_bytes: 2048,
    created_by: uuid(9),
    created_at: "2026-10-27T09:00:00+00:00",
  };

  it("maps an attachment row", () => {
    expect(parseAttachment(row)).toEqual({
      id: uuid(6),
      taskId: uuid(1),
      storagePath: `${uuid(1)}/${uuid(6)}-report.pdf`,
      fileName: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      createdBy: uuid(9),
      createdAt: new Date("2026-10-27T09:00:00Z"),
    });
  });

  it("keeps a file whose type or uploader is unknown", () => {
    const attachment = parseAttachment({ ...row, mime_type: null, created_by: null });
    expect(attachment.mimeType).toBeNull();
    expect(attachment.createdBy).toBeNull();
  });

  it("rejects a negative size", () => {
    expect(() => parseAttachment({ ...row, size_bytes: -1 })).toThrow();
  });
});
