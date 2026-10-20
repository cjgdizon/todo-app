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

export interface Label {
  id: string;
  workspaceId: string;
  name: string;
  color: string | null;
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
