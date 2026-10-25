import type { Priority } from "@todo/core";
import { z } from "zod";

/**
 * App models and the parsers that build them from database rows. Rows come from
 * the network, so they are validated with Zod before the rest of the app sees
 * them; a malformed row throws instead of leaking `undefined` into the UI.
 */

export interface Task {
  id: string;
  workspaceId: string;
  projectId: string | null;
  sectionId: string | null;
  parentId: string | null;
  /** A member of the task's workspace; null when nobody is assigned. */
  assigneeId: string | null;
  title: string;
  notes: string | null;
  priority: Priority;
  dueAt: Date | null;
  dueAllDay: boolean;
  dueTz: string | null;
  rrule: string | null;
  recurAfterCompletion: boolean;
  position: string;
  completedAt: Date | null;
  labelIds: string[];
  version: number;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  color: string | null;
  position: string;
  archived: boolean;
}

/** A column of a project's board. Tasks without a section sit in the project's first, unnamed column. */
export interface Section {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  position: string;
}

export interface Label {
  id: string;
  workspaceId: string;
  name: string;
  color: string | null;
}

/** A search the user saved by name. Only the owner can see it (row-level security). */
export interface SavedFilter {
  id: string;
  workspaceId: string;
  name: string;
  query: string;
}

export interface Profile {
  id: string;
  displayName: string;
  timeZone: string;
}

export interface Workspace {
  id: string;
  name: string;
}

export type WorkspaceRole = "owner" | "admin" | "member";

/** A workspace the user belongs to, with their role in it (for the workspace switcher). */
export interface Membership extends Workspace {
  role: WorkspaceRole;
}

export interface Member {
  userId: string;
  role: WorkspaceRole;
  displayName: string;
}

/** A pending invite. The link token itself is never readable after it is created. */
export interface Invite {
  id: string;
  role: Exclude<WorkspaceRole, "owner">;
  expiresAt: Date;
  createdAt: Date;
}

export interface Comment {
  id: string;
  taskId: string;
  /** Null once the author's account is deleted; the comment stays. */
  authorId: string | null;
  body: string;
  editedAt: Date | null;
  createdAt: Date;
}

// Postgres returns offsets like "+00:00".
const timestamp = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const id = z.string().uuid();
const priority = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const taskRow = z.object({
  id,
  workspace_id: id,
  project_id: id.nullable(),
  section_id: id.nullable(),
  parent_id: id.nullable(),
  assignee_id: id.nullable(),
  title: z.string().min(1),
  notes: z.string().nullable(),
  priority,
  due_at: timestamp.nullable(),
  due_all_day: z.boolean(),
  due_tz: z.string().nullable(),
  rrule: z.string().nullable(),
  recur_after_completion: z.boolean(),
  position: z.string(),
  completed_at: timestamp.nullable(),
  version: z.number().int(),
});

export function parseTask(row: unknown, labelIds: readonly string[]): Task {
  const r = taskRow.parse(row);
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    sectionId: r.section_id,
    parentId: r.parent_id,
    assigneeId: r.assignee_id,
    title: r.title,
    notes: r.notes,
    priority: r.priority,
    dueAt: r.due_at,
    dueAllDay: r.due_all_day,
    dueTz: r.due_tz,
    rrule: r.rrule,
    recurAfterCompletion: r.recur_after_completion,
    position: r.position,
    completedAt: r.completed_at,
    labelIds: [...labelIds],
    version: r.version,
  };
}

const projectRow = z.object({
  id,
  workspace_id: id,
  name: z.string().min(1),
  color: z.string().nullable(),
  position: z.string(),
  archived_at: z.string().nullable(),
});

export function parseProject(row: unknown): Project {
  const r = projectRow.parse(row);
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    color: r.color,
    position: r.position,
    archived: r.archived_at !== null,
  };
}

const sectionRow = z.object({
  id,
  workspace_id: id,
  project_id: id,
  name: z.string().min(1),
  position: z.string(),
});

export function parseSection(row: unknown): Section {
  const r = sectionRow.parse(row);
  return { id: r.id, workspaceId: r.workspace_id, projectId: r.project_id, name: r.name, position: r.position };
}

const labelRow = z.object({
  id,
  workspace_id: id,
  name: z.string().min(1),
  color: z.string().nullable(),
});

export function parseLabel(row: unknown): Label {
  const r = labelRow.parse(row);
  return { id: r.id, workspaceId: r.workspace_id, name: r.name, color: r.color };
}

const savedFilterRow = z.object({
  id,
  workspace_id: id,
  name: z.string().min(1),
  query: z.string().min(1),
});

export function parseSavedFilter(row: unknown): SavedFilter {
  const r = savedFilterRow.parse(row);
  return { id: r.id, workspaceId: r.workspace_id, name: r.name, query: r.query };
}

const profileRow = z.object({
  id,
  display_name: z.string(),
  timezone: z.string().min(1),
});

export function parseProfile(row: unknown): Profile {
  const r = profileRow.parse(row);
  return { id: r.id, displayName: r.display_name, timeZone: r.timezone };
}

const workspaceRow = z.object({ id, name: z.string().min(1) });

export function parseWorkspace(row: unknown): Workspace {
  return workspaceRow.parse(row);
}

const role = z.enum(["owner", "admin", "member"]);

const membershipRow = z.object({ role, workspaces: workspaceRow });

export function parseMembership(row: unknown): Membership {
  const r = membershipRow.parse(row);
  return { id: r.workspaces.id, name: r.workspaces.name, role: r.role };
}

const memberRow = z.object({
  user_id: id,
  role,
  profiles: z.object({ display_name: z.string() }),
});

export function parseMember(row: unknown): Member {
  const r = memberRow.parse(row);
  return { userId: r.user_id, role: r.role, displayName: r.profiles.display_name.trim() || "Unnamed member" };
}

const inviteRow = z.object({
  id,
  role: z.enum(["admin", "member"]),
  expires_at: timestamp,
  created_at: timestamp,
});

export function parseInvite(row: unknown): Invite {
  const r = inviteRow.parse(row);
  return { id: r.id, role: r.role, expiresAt: r.expires_at, createdAt: r.created_at };
}

const commentRow = z.object({
  id,
  task_id: id,
  author_id: id.nullable(),
  body: z.string().min(1),
  edited_at: timestamp.nullable(),
  created_at: timestamp,
});

export function parseComment(row: unknown): Comment {
  const r = commentRow.parse(row);
  return {
    id: r.id,
    taskId: r.task_id,
    authorId: r.author_id,
    body: r.body,
    editedAt: r.edited_at,
    createdAt: r.created_at,
  };
}
