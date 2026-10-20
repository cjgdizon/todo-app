import type { Task } from "./models.ts";
import type { TaskPatch } from "./queries.ts";

/** A task edit as the UI describes it: database fields plus the full replacement set of labels. */
export type TaskChange = TaskPatch & { labelIds?: readonly string[] };

/**
 * The task as it will look once `change` is saved, so lists can update before the
 * server answers. Returns null when the change moves the task to the trash.
 * Never mutates its input.
 */
export function applyTaskChange(task: Task, change: TaskChange): Task | null {
  if (change.deletedAt) return null;
  const next: Task = { ...task, labelIds: [...task.labelIds] };
  if (change.title !== undefined) next.title = change.title;
  if (change.notes !== undefined) next.notes = change.notes;
  if (change.priority !== undefined) next.priority = change.priority;
  if (change.projectId !== undefined) next.projectId = change.projectId;
  if (change.parentId !== undefined) next.parentId = change.parentId;
  if (change.dueAt !== undefined) next.dueAt = change.dueAt;
  if (change.dueAllDay !== undefined) next.dueAllDay = change.dueAllDay;
  if (change.dueTz !== undefined) next.dueTz = change.dueTz;
  if (change.rrule !== undefined) next.rrule = change.rrule;
  if (change.recurAfterCompletion !== undefined) next.recurAfterCompletion = change.recurAfterCompletion;
  if (change.position !== undefined) next.position = change.position;
  if (change.completedAt !== undefined) next.completedAt = change.completedAt;
  if (change.labelIds !== undefined) next.labelIds = [...change.labelIds];
  return next;
}
