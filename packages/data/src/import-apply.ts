import type { ImportPlan, PlannedTask } from "@todo/core";
import type { TodoClient } from "./client.ts";
import { DataError } from "./queries.ts";

const INSERT_BATCH = 500;
/** Ids go into the request URL when trashing, so keep each group small. */
const ID_BATCH = 100;

export interface ImportProgress {
  done: number;
  total: number;
}

export interface ImportResult {
  counts: { projects: number; sections: number; labels: number; tasks: number };
  /** Moves everything the import created to the trash. */
  undo: () => Promise<void>;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

function check(error: { message: string } | null): void {
  if (error) throw new DataError(error.message);
}

const taskRow = (task: PlannedTask, target: { workspaceId: string; userId: string }) => ({
  id: task.id,
  workspace_id: target.workspaceId,
  created_by: target.userId,
  project_id: task.projectId,
  section_id: task.sectionId,
  parent_id: task.parentId,
  title: task.title,
  notes: task.notes,
  priority: task.priority,
  due_at: task.dueAt ? task.dueAt.toISOString() : null,
  due_all_day: task.dueAllDay,
  due_tz: task.dueTz,
  rrule: task.rrule,
  recur_after_completion: task.recurAfterCompletion,
  completed_at: task.completedAt ? task.completedAt.toISOString() : null,
  position: task.position,
});

/**
 * Creates what an import plan describes: projects, sections and labels first, then tasks one
 * nesting level at a time (a subtask needs its parent to exist), then task labels. Rows go in
 * batches. The requests are not one transaction, so if any step fails everything created so far
 * is moved to the trash before the error is rethrown. The result's `undo` does the same later.
 */
export async function applyImportPlan(
  client: TodoClient,
  target: { workspaceId: string; userId: string },
  plan: ImportPlan,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  const links = plan.tasks.flatMap((task) => task.labelIds.map((labelId) => ({ taskId: task.id, labelId })));
  const total = plan.projects.length + plan.sections.length + plan.labels.length + plan.tasks.length + links.length;
  let done = 0;
  const advance = (rows: number) => {
    done += rows;
    onProgress?.({ done, total });
  };

  const created = { projects: [] as string[], sections: [] as string[], labels: [] as string[], tasks: [] as string[] };
  const { workspaceId } = target;

  const trash = async () => {
    const deletedAt = new Date().toISOString();
    for (const ids of chunks(created.tasks, ID_BATCH)) {
      check((await client.from("tasks").update({ deleted_at: deletedAt }).in("id", ids)).error);
    }
    for (const ids of chunks(created.sections, ID_BATCH)) {
      check((await client.from("sections").update({ deleted_at: deletedAt }).in("id", ids)).error);
    }
    for (const ids of chunks(created.projects, ID_BATCH)) {
      check((await client.from("projects").update({ deleted_at: deletedAt }).in("id", ids)).error);
    }
    for (const ids of chunks(created.labels, ID_BATCH)) {
      check((await client.from("labels").update({ deleted_at: deletedAt }).in("id", ids)).error);
    }
  };

  try {
    const archivedAt = new Date().toISOString();
    for (const batch of chunks(plan.projects, INSERT_BATCH)) {
      check(
        (
          await client.from("projects").insert(
            batch.map((p) => ({
              id: p.id,
              workspace_id: workspaceId,
              name: p.name,
              color: p.color,
              position: p.position,
              archived_at: p.archived ? archivedAt : null,
            })),
          )
        ).error,
      );
      created.projects.push(...batch.map((p) => p.id));
      advance(batch.length);
    }

    for (const batch of chunks(plan.sections, INSERT_BATCH)) {
      check(
        (
          await client.from("sections").insert(
            batch.map((s) => ({
              id: s.id,
              workspace_id: workspaceId,
              project_id: s.projectId,
              name: s.name,
              position: s.position,
            })),
          )
        ).error,
      );
      created.sections.push(...batch.map((s) => s.id));
      advance(batch.length);
    }

    for (const batch of chunks(plan.labels, INSERT_BATCH)) {
      check(
        (
          await client
            .from("labels")
            .insert(batch.map((l) => ({ id: l.id, workspace_id: workspaceId, name: l.name, color: l.color })))
        ).error,
      );
      created.labels.push(...batch.map((l) => l.id));
      advance(batch.length);
    }

    const levels = [...new Set(plan.tasks.map((task) => task.depth))].sort((a, b) => a - b);
    for (const level of levels) {
      const atLevel = plan.tasks.filter((task) => task.depth === level);
      for (const batch of chunks(atLevel, INSERT_BATCH)) {
        check((await client.from("tasks").insert(batch.map((task) => taskRow(task, target)))).error);
        created.tasks.push(...batch.map((task) => task.id));
        advance(batch.length);
      }
    }

    for (const batch of chunks(links, INSERT_BATCH)) {
      check(
        (
          await client
            .from("task_labels")
            .insert(batch.map((link) => ({ workspace_id: workspaceId, task_id: link.taskId, label_id: link.labelId })))
        ).error,
      );
      advance(batch.length);
    }
  } catch (error) {
    // Best effort: the original error is what the caller needs to see.
    await trash().catch(() => undefined);
    throw error;
  }

  return {
    counts: {
      projects: created.projects.length,
      sections: created.sections.length,
      labels: created.labels.length,
      tasks: created.tasks.length,
    },
    undo: trash,
  };
}
