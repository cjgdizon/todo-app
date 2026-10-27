import { attachmentPath, validateAttachment, type Priority } from "@todo/core";
import type { TodoClient } from "./client.ts";
import type { Database } from "./database.types.ts";
import {
  parseActivity,
  parseAttachment,
  parseComment,
  parseInvite,
  parseLabel,
  parseMember,
  parseMembership,
  parseProfile,
  parseProject,
  parseReminder,
  parseSavedFilter,
  parseSection,
  parseTask,
  parseTimeEntry,
  parseWorkspace,
  type Activity,
  type Attachment,
  type Comment,
  type Invite,
  type Label,
  type Member,
  type Membership,
  type Profile,
  type Project,
  type Reminder,
  type SavedFilter,
  type Section,
  type Task,
  type TimeEntry,
  type Workspace,
  type WorkspaceRole,
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
// A person belongs to a handful of workspaces; this only bounds the query.
const MAX_WORKSPACES = 100;

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
  "id,workspace_id,project_id,section_id,parent_id,assignee_id,title,notes,priority,due_at,due_all_day,due_tz,rrule,recur_after_completion,position,completed_at,version";
const PROJECT_COLUMNS = "id,workspace_id,name,color,position,archived_at";
const LABEL_COLUMNS = "id,workspace_id,name,color";

export interface Bootstrap {
  profile: Profile;
  workspace: Workspace;
}

/**
 * The signed-in user's profile and active workspace: `preferredWorkspaceId` when they still
 * belong to it, otherwise their oldest one ("Personal" after sign-up).
 */
export async function fetchBootstrap(
  client: TodoClient,
  userId: string,
  preferredWorkspaceId: string | null = null,
): Promise<Bootstrap> {
  const [profile, workspaces] = await Promise.all([
    client.from("profiles").select("id,display_name,timezone").eq("id", userId).single(),
    client.from("workspaces").select("id,name").order("created_at").order("id").limit(MAX_WORKSPACES),
  ]);
  check(profile.error);
  check(workspaces.error);
  const rows = workspaces.data ?? [];
  const workspace = rows.find((row) => row.id === preferredWorkspaceId) ?? rows[0];
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

/** The signed-in user's saved filters (others' are hidden by row-level security). */
export async function fetchSavedFilters(client: TodoClient, workspaceId: string): Promise<SavedFilter[]> {
  const rows = await fetchAll((from, to) =>
    client
      .from("saved_filters")
      .select("id,workspace_id,name,query")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows.map(parseSavedFilter);
}

export async function insertSavedFilter(
  client: TodoClient,
  filter: { id: string; workspaceId: string; ownerId: string; name: string; query: string },
): Promise<void> {
  const { error } = await client.from("saved_filters").insert({
    id: filter.id,
    workspace_id: filter.workspaceId,
    owner_id: filter.ownerId,
    name: filter.name,
    query: filter.query,
  });
  check(error);
}

export async function updateSavedFilter(
  client: TodoClient,
  id: string,
  patch: { name?: string; query?: string; deletedAt?: Date | null },
): Promise<void> {
  const update: Database["public"]["Tables"]["saved_filters"]["Update"] = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.query !== undefined) update.query = patch.query;
  if (patch.deletedAt !== undefined) update.deleted_at = iso(patch.deletedAt);
  if (Object.keys(update).length === 0) return;
  const { error } = await client.from("saved_filters").update(update).eq("id", id);
  check(error);
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
  /** A board column of the task's project. Clear it (null) whenever the project changes. */
  sectionId?: string | null;
  parentId?: string | null;
  assigneeId?: string | null;
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
  if (patch.sectionId !== undefined) update.section_id = patch.sectionId;
  if (patch.parentId !== undefined) update.parent_id = patch.parentId;
  if (patch.assigneeId !== undefined) update.assignee_id = patch.assigneeId;
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

export async function fetchSections(client: TodoClient, workspaceId: string): Promise<Section[]> {
  const rows = await fetchAll((from, to) =>
    client
      .from("sections")
      .select("id,workspace_id,project_id,name,position")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("position")
      .order("id")
      .range(from, to),
  );
  return rows.map(parseSection);
}

export async function insertSection(
  client: TodoClient,
  section: { id: string; workspaceId: string; projectId: string; name: string; position: string },
): Promise<void> {
  const { error } = await client.from("sections").insert({
    id: section.id,
    workspace_id: section.workspaceId,
    project_id: section.projectId,
    name: section.name,
    position: section.position,
  });
  check(error);
}

export async function updateSection(
  client: TodoClient,
  id: string,
  patch: { name?: string; deletedAt?: Date | null },
): Promise<void> {
  const update: Database["public"]["Tables"]["sections"]["Update"] = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.deletedAt !== undefined) update.deleted_at = iso(patch.deletedAt);
  if (Object.keys(update).length === 0) return;
  const { error } = await client.from("sections").update(update).eq("id", id);
  check(error);
}

/**
 * Takes every task out of a section, so the section can be deleted without leaving tasks
 * pointing at a hidden column. Returns the ids of the tasks it moved.
 */
export async function emptySection(client: TodoClient, workspaceId: string, sectionId: string): Promise<string[]> {
  const { data, error } = await client
    .from("tasks")
    .update({ section_id: null })
    .eq("workspace_id", workspaceId)
    .eq("section_id", sectionId)
    .select("id");
  check(error);
  return (data ?? []).map((row) => row.id);
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

/** Every workspace the user belongs to, oldest first, with their role in each. */
export async function fetchMemberships(client: TodoClient, userId: string): Promise<Membership[]> {
  const { data, error } = await client
    .from("workspace_members")
    .select("role,created_at,workspaces(id,name)")
    .eq("user_id", userId)
    .order("created_at")
    .order("workspace_id");
  check(error);
  return (data ?? []).map(parseMembership);
}

export async function fetchMembers(client: TodoClient, workspaceId: string): Promise<Member[]> {
  const { data, error } = await client
    .from("workspace_members")
    .select("user_id,role,profiles(display_name)")
    .eq("workspace_id", workspaceId)
    .order("created_at")
    .order("user_id");
  check(error);
  return (data ?? []).map(parseMember);
}

export async function updateMemberRole(
  client: TodoClient,
  workspaceId: string,
  userId: string,
  role: Exclude<WorkspaceRole, "owner">,
): Promise<void> {
  const { error } = await client
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  check(error);
}

/** Removes a member (an admin) or leaves the workspace (the member themself). */
export async function removeMember(client: TodoClient, workspaceId: string, userId: string): Promise<void> {
  const { error } = await client
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  check(error);
}

/** Invites that can still be used. Only admins see any (row-level security). */
export async function fetchInvites(client: TodoClient, workspaceId: string): Promise<Invite[]> {
  const { data, error } = await client
    .from("workspace_invites")
    .select("id,role,expires_at,created_at")
    .eq("workspace_id", workspaceId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at")
    .order("id");
  check(error);
  return (data ?? []).map(parseInvite);
}

/** Creates an invite and returns its token, which is shown once and never stored in readable form. */
export async function createInvite(
  client: TodoClient,
  workspaceId: string,
  role: Exclude<WorkspaceRole, "owner">,
): Promise<string> {
  const { data, error } = await client.rpc("create_workspace_invite", { ws: workspaceId, invite_role: role });
  check(error);
  if (typeof data !== "string" || data.length === 0) throw new DataError("The server did not return an invite");
  return data;
}

/** Joins the workspace the token belongs to and returns its id. */
export async function acceptInvite(client: TodoClient, token: string): Promise<string> {
  const { data, error } = await client.rpc("accept_workspace_invite", { invite_token: token });
  check(error);
  if (typeof data !== "string") throw new DataError("The server did not return a workspace");
  return data;
}

export async function revokeInvite(client: TodoClient, inviteId: string): Promise<void> {
  const { error } = await client.rpc("revoke_workspace_invite", { invite: inviteId });
  check(error);
}

const COMMENT_COLUMNS = "id,task_id,author_id,body,edited_at,mentions,created_at";

export async function fetchComments(client: TodoClient, workspaceId: string, taskId: string): Promise<Comment[]> {
  const rows = await fetchAll((from, to) =>
    client
      .from("comments")
      .select(COMMENT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("task_id", taskId)
      .is("deleted_at", null)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  return rows.map(parseComment);
}

export async function insertComment(
  client: TodoClient,
  comment: { id: string; workspaceId: string; taskId: string; authorId: string; body: string; mentions: readonly string[] },
): Promise<void> {
  const { error } = await client.from("comments").insert({
    id: comment.id,
    workspace_id: comment.workspaceId,
    task_id: comment.taskId,
    author_id: comment.authorId,
    body: comment.body,
    mentions: [...comment.mentions],
  });
  check(error);
}

export async function updateComment(
  client: TodoClient,
  id: string,
  patch: { body?: string; mentions?: readonly string[]; deletedAt?: Date | null },
): Promise<void> {
  const update: Database["public"]["Tables"]["comments"]["Update"] = {};
  if (patch.mentions !== undefined) update.mentions = [...patch.mentions];
  if (patch.body !== undefined) {
    update.body = patch.body;
    update.edited_at = new Date().toISOString();
  }
  if (patch.deletedAt !== undefined) update.deleted_at = iso(patch.deletedAt);
  if (Object.keys(update).length === 0) return;
  const { error } = await client.from("comments").update(update).eq("id", id);
  check(error);
}

const ACTIVITY_LIMIT = 100;

/** The most recent activity in a shared workspace, newest first. */
export async function fetchActivity(client: TodoClient, workspaceId: string): Promise<Activity[]> {
  const { data, error } = await client
    .from("activity_log")
    .select("id,task_id,actor_id,action,meta,created_at,profiles(display_name)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ACTIVITY_LIMIT);
  check(error);
  return (data ?? []).map(parseActivity);
}

/** The signed-in user's active reminders (others' are hidden by row-level security). */
export async function fetchReminders(client: TodoClient, workspaceId: string): Promise<Reminder[]> {
  const rows = await fetchAll((from, to) =>
    client
      .from("reminders")
      .select("task_id,offset_min,remind_at,sent_at")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("remind_at")
      .order("id")
      .range(from, to),
  );
  return rows.map(parseReminder);
}

/** Needs a connection (it is a server call), and fails with a plain message if the time has passed. */
export async function setTaskReminder(client: TodoClient, taskId: string, offsetMin: number): Promise<void> {
  const { error } = await client.rpc("set_task_reminder", { p_task: taskId, p_offset_min: offsetMin });
  check(error);
}

export async function clearTaskReminder(client: TodoClient, taskId: string): Promise<void> {
  const { error } = await client.rpc("clear_task_reminder", { p_task: taskId });
  check(error);
}

/** The signed-in user's time entries since `since`, plus any timer still running (others' are hidden by row-level security). */
export async function fetchTimeEntries(client: TodoClient, workspaceId: string, since: Date): Promise<TimeEntry[]> {
  const rows = await fetchAll((from, to) =>
    client
      .from("time_entries")
      .select("id,task_id,started_at,ended_at")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .or(`started_at.gte.${since.toISOString()},ended_at.is.null`)
      .order("started_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return rows.map(parseTimeEntry);
}

export async function insertTimeEntry(
  client: TodoClient,
  entry: { id: string; workspaceId: string; taskId: string; userId: string; startedAt: Date },
): Promise<void> {
  const { error } = await client.from("time_entries").insert({
    id: entry.id,
    workspace_id: entry.workspaceId,
    task_id: entry.taskId,
    user_id: entry.userId,
    started_at: entry.startedAt.toISOString(),
  });
  check(error);
}

export async function updateTimeEntry(
  client: TodoClient,
  id: string,
  patch: { endedAt?: Date; deletedAt?: Date },
): Promise<void> {
  const update: Database["public"]["Tables"]["time_entries"]["Update"] = {};
  if (patch.endedAt !== undefined) update.ended_at = patch.endedAt.toISOString();
  if (patch.deletedAt !== undefined) update.deleted_at = patch.deletedAt.toISOString();
  if (Object.keys(update).length === 0) return;
  const { error } = await client.from("time_entries").update(update).eq("id", id);
  check(error);
}

const ATTACHMENT_BUCKET = "attachments";
const DOWNLOAD_LINK_SECONDS = 60;

export async function fetchAttachments(client: TodoClient, workspaceId: string, taskId: string): Promise<Attachment[]> {
  const rows = await fetchAll((from, to) =>
    client
      .from("attachments")
      .select("id,task_id,storage_path,file_name,mime_type,size_bytes,created_by,created_at")
      .eq("workspace_id", workspaceId)
      .eq("task_id", taskId)
      .is("deleted_at", null)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  return rows.map(parseAttachment);
}

/**
 * Stores the file, then records it. In that order: a record never exists without its file, and if
 * recording fails the file is taken out again. Needs a connection (file bytes are not queued offline).
 */
export async function uploadAttachment(
  client: TodoClient,
  upload: {
    id: string;
    workspaceId: string;
    taskId: string;
    userId: string;
    fileName: string;
    mimeType: string;
    size: number;
    body: Blob | ArrayBuffer;
  },
): Promise<void> {
  const problem = validateAttachment({ name: upload.fileName, size: upload.size });
  if (problem) throw new DataError(problem);

  const path = attachmentPath(upload.taskId, upload.id, upload.fileName);
  const stored = await client.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, upload.body, { contentType: upload.mimeType || "application/octet-stream", upsert: false });
  check(stored.error);

  const { error } = await client.from("attachments").insert({
    id: upload.id,
    workspace_id: upload.workspaceId,
    task_id: upload.taskId,
    storage_path: path,
    file_name: upload.fileName,
    mime_type: upload.mimeType || null,
    size_bytes: upload.size,
    created_by: upload.userId,
  });
  if (error) {
    await client.storage.from(ATTACHMENT_BUCKET).remove([path]); // best effort: nothing points at it
    throw new DataError(error.message);
  }
}

/** A link that works for a minute and downloads the file under its own name (never shows it inline). */
export async function attachmentDownloadUrl(client: TodoClient, attachment: Attachment): Promise<string> {
  const { data, error } = await client.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.storagePath, DOWNLOAD_LINK_SECONDS, { download: attachment.fileName });
  check(error);
  if (!data?.signedUrl) throw new DataError("Could not make a download link");
  return data.signedUrl;
}

/** Hides the record first (that is what the person sees), then removes the file as a best effort. */
export async function removeAttachment(client: TodoClient, attachment: Attachment): Promise<void> {
  const { error } = await client
    .from("attachments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", attachment.id);
  check(error);
  await client.storage.from(ATTACHMENT_BUCKET).remove([attachment.storagePath]);
}
