import type { Priority } from "@todo/core";
import type { TodoClient } from "./client.ts";
import type { Database } from "./database.types.ts";
import {
  parseLabel,
  parseProfile,
  parseProject,
  parseTask,
  parseWorkspace,
  type Label,
  type Profile,
  type Project,
  type Task,
  type Workspace,
} from "./models.ts";

/**
 * Thin, typed wrappers over the Supabase tables. Rows are always filtered by
 * workspace and soft-deleted rows are never returned. Clients cannot set
 * `version`, timestamps or `updated_by` (a trigger owns them), so none of those
 * are sent. Lists are ordered `position, id`.
 */

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

function check(error: { message: string } | null): void {
  if (error) throw new DataError(error.message);
}

// PostgREST returns at most 1000 rows per request.
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

async function fetchAll(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
    const { data, error } = await page(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE - 1);
    check(error);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

// Explicit column lists: `search` (a tsvector) is large and never needed by the app.
const TASK_COLUMNS =
  "id,workspace_id,project_id,section_id,parent_id,title,notes,priority,due_at,due_all_day,due_tz,rrule,recur_after_completion,position,completed_at,version";
const PROJECT_COLUMNS = "id,workspace_id,name,color,position,archived_at";
const LABEL_COLUMNS = "id,workspace_id,name,color";

export interface Bootstrap {
  profile: Profile;
  workspace: Workspace;
}

/** The signed-in user's profile and their first (oldest) workspace, "Personal" after sign-up. */
export async function fetchBootstrap(client: TodoClient, userId: string): Promise<Bootstrap> {
  const [profile, workspaces] = await Promise.all([
    client.from("profiles").select("id,display_name,timezone").eq("id", userId).single(),
    client.from("workspaces").select("id,name").order("created_at").order("id").limit(1),
  ]);
  check(profile.error);
  check(workspaces.error);
  const workspace = workspaces.data?.[0];
  if (!workspace) throw new DataError("No workspace found for this account");
  return { profile: parseProfile(profile.data), workspace: parseWorkspace(workspace) };
}

export async function updateProfileTimeZone(client: TodoClient, userId: string, timeZone: string): Promise<void> {
  const { error } = await client.from("profiles").update({ timezone: timeZone }).eq("id", userId);
  check(error);
}

export async function fetchProjects(client: TodoClient, workspaceId: string): Promise<Project[]> {
  const rows = await fetchAll((from, to) =>
    client
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("position")
      .order("id")
      .range(from, to),
  );
  return rows.map(parseProject);
}

export async function fetchLabels(client: TodoClient, workspaceId: string): Promise<Label[]> {
  const rows = await fetchAll((from, to) =>
    client
      .from("labels")
      .select(LABEL_COLUMNS)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows.map(parseLabel);
}

/** Every non-deleted task (open and completed) with its label ids. */
export async function fetchTasks(client: TodoClient, workspaceId: string): Promise<Task[]> {
  const [taskRows, linkRows] = await Promise.all([
    fetchAll((from, to) =>
      client
        .from("tasks")
        .select(TASK_COLUMNS)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("position")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      client
        .from("task_labels")
        .select("task_id,label_id")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("task_id")
        .order("label_id")
        .range(from, to),
    ),
  ]);
  const labelsByTask = new Map<string, string[]>();
  for (const link of linkRows as { task_id: string; label_id: string }[]) {
    const ids = labelsByTask.get(link.task_id) ?? [];
    ids.push(link.label_id);
    labelsByTask.set(link.task_id, ids);
  }
  return taskRows.map((row) => parseTask(row, labelsByTask.get((row as { id: string }).id) ?? []));
}

export interface NewTask {
  /** Chosen by the client so the row can be shown before the server confirms it. */
  id: string;
  workspaceId: string;
  createdBy: string;
  title: string;
  notes?: string | null;
  priority: Priority;
  projectId: string | null;
  parentId: string | null;
  dueAt: Date | null;
  dueAllDay: boolean;
  dueTz: string | null;
  rrule: string | null;
  recurAfterCompletion: boolean;
  position: string;
}

export async function insertTask(client: TodoClient, task: NewTask): Promise<void> {
  const { error } = await client.from("tasks").insert({
    id: task.id,
    workspace_id: task.workspaceId,
    created_by: task.createdBy,
    title: task.title,
    notes: task.notes ?? null,
    priority: task.priority,
    project_id: task.projectId,
    parent_id: task.parentId,
    due_at: task.dueAt?.toISOString() ?? null,
    due_all_day: task.dueAllDay,
    due_tz: task.dueTz,
    rrule: task.rrule,
    recur_after_completion: task.recurAfterCompletion,
    position: task.position,
  });
  check(error);
}

/** Fields the app edits. `deletedAt` moves a task to the trash (null restores it). */
export interface TaskPatch {
  title?: string;
  notes?: string | null;
  priority?: Priority;
  projectId?: string | null;
  parentId?: string | null;
  dueAt?: Date | null;
  dueAllDay?: boolean;
  dueTz?: string | null;
  rrule?: string | null;
  recurAfterCompletion?: boolean;
  position?: string;
  completedAt?: Date | null;
  deletedAt?: Date | null;
}

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function toTaskUpdate(patch: TaskPatch): TaskUpdate {
  const update: TaskUpdate = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.priority !== undefined) update.priority = patch.priority;
  if (patch.projectId !== undefined) update.project_id = patch.projectId;
  if (patch.parentId !== undefined) update.parent_id = patch.parentId;
  if (patch.dueAt !== undefined) update.due_at = iso(patch.dueAt);
  if (patch.dueAllDay !== undefined) update.due_all_day = patch.dueAllDay;
  if (patch.dueTz !== undefined) update.due_tz = patch.dueTz;
  if (patch.rrule !== undefined) update.rrule = patch.rrule;
  if (patch.recurAfterCompletion !== undefined) update.recur_after_completion = patch.recurAfterCompletion;
  if (patch.position !== undefined) update.position = patch.position;
  if (patch.completedAt !== undefined) update.completed_at = iso(patch.completedAt);
  if (patch.deletedAt !== undefined) update.deleted_at = iso(patch.deletedAt);
  return update;
}

/**
 * Applies `patch` to one task or to several in a single statement. Moving a task
 * with subtasks to another project needs the single statement: the database
 * checks the hierarchy once per statement and rejects a half-moved tree.
 */
export async function updateTask(
  client: TodoClient,
  id: string | readonly string[],
  patch: TaskPatch,
): Promise<void> {
  const update = toTaskUpdate(patch);
  if (Object.keys(update).length === 0) return;
  const ids = typeof id === "string" ? [id] : [...id];
  const { error } = await client.from("tasks").update(update).in("id", ids);
  check(error);
}

/** Makes the task's labels exactly `labelIds`: links are added or soft-deleted as needed. */
export async function setTaskLabels(
  client: TodoClient,
  workspaceId: string,
  taskId: string,
  labelIds: readonly string[],
): Promise<void> {
  const { data, error } = await client
    .from("task_labels")
    .select("label_id,deleted_at")
    .eq("task_id", taskId)
    .eq("workspace_id", workspaceId);
  check(error);
  const active = new Set((data ?? []).filter((l) => l.deleted_at === null).map((l) => l.label_id));
  const wanted = new Set(labelIds);

  const toAdd = [...wanted].filter((id) => !active.has(id));
  if (toAdd.length > 0) {
    const { error: addError } = await client.from("task_labels").upsert(
      toAdd.map((labelId) => ({
        task_id: taskId,
        label_id: labelId,
        workspace_id: workspaceId,
        deleted_at: null,
      })),
      { onConflict: "task_id,label_id" },
    );
    check(addError);
  }

  const toRemove = [...active].filter((id) => !wanted.has(id));
  if (toRemove.length > 0) {
    const { error: removeError } = await client
      .from("task_labels")
      .update({ deleted_at: new Date().toISOString() })
      .eq("task_id", taskId)
      .eq("workspace_id", workspaceId)
      .in("label_id", toRemove);
    check(removeError);
  }
}

export async function insertProject(
  client: TodoClient,
  project: { id: string; workspaceId: string; name: string; color: string | null; position: string },
): Promise<void> {
  const { error } = await client.from("projects").insert({
    id: project.id,
    workspace_id: project.workspaceId,
    name: project.name,
    color: project.color,
    position: project.position,
  });
  check(error);
}

export async function updateProject(
  client: TodoClient,
  id: string,
  patch: { name?: string; color?: string | null; archived?: boolean; deletedAt?: Date | null },
): Promise<void> {
  const update: Database["public"]["Tables"]["projects"]["Update"] = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.archived !== undefined) update.archived_at = patch.archived ? new Date().toISOString() : null;
  if (patch.deletedAt !== undefined) update.deleted_at = iso(patch.deletedAt);
  if (Object.keys(update).length === 0) return;
  const { error } = await client.from("projects").update(update).eq("id", id);
  check(error);
}

/**
 * Moves a project and all its tasks to the trash. Tasks go first: if the second
 * step fails, the project is still visible (empty) instead of leaving tasks that
 * belong to a hidden project.
 */
export async function trashProject(client: TodoClient, workspaceId: string, id: string): Promise<void> {
  const deletedAt = new Date().toISOString();
  const { error: tasksError } = await client
    .from("tasks")
    .update({ deleted_at: deletedAt })
    .eq("workspace_id", workspaceId)
    .eq("project_id", id)
    .is("deleted_at", null);
  check(tasksError);
  const { error } = await client.from("projects").update({ deleted_at: deletedAt }).eq("id", id);
  check(error);
}

export async function insertLabel(
  client: TodoClient,
  label: { id: string; workspaceId: string; name: string; color?: string | null },
): Promise<void> {
  const { error } = await client.from("labels").insert({
    id: label.id,
    workspace_id: label.workspaceId,
    name: label.name,
    color: label.color ?? null,
  });
  check(error);
}

export async function updateLabel(
  client: TodoClient,
  id: string,
  patch: { name?: string; color?: string | null; deletedAt?: Date | null },
): Promise<void> {
  const update: Database["public"]["Tables"]["labels"]["Update"] = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.deletedAt !== undefined) update.deleted_at = iso(patch.deletedAt);
  if (Object.keys(update).length === 0) return;
  const { error } = await client.from("labels").update(update).eq("id", id);
  check(error);
}
