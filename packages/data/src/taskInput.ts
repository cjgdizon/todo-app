import { positionBetween, type Priority, type QuickAddResult } from "@todo/core";

/** Everything needed to create a task, with project and labels already resolved to ids. */
export interface TaskInput {
  title: string;
  priority: Priority;
  projectId: string | null;
  labelIds: string[];
  /** Label names from the text that do not exist yet; the caller creates them. */
  newLabelNames: string[];
  /** A `#project` from the text that matched nothing; the task goes to the Inbox. */
  unknownProject: string | null;
  dueAt: Date | null;
  dueAllDay: boolean;
  dueTz: string | null;
  rrule: string | null;
  recurAfterCompletion: boolean;
}

interface Named {
  id: string;
  name: string;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Turns a parsed quick-add line into a task, matching `#project` and `@label`
 * against existing ones (case-insensitive). Returns null when no title is left.
 */
export function taskInputFromQuickAdd(
  parsed: QuickAddResult,
  lookup: { projects: readonly Named[]; labels: readonly Named[]; timeZone: string },
): TaskInput | null {
  if (!parsed.title) return null;

  const project = parsed.project
    ? lookup.projects.find((p) => sameName(p.name, parsed.project ?? ""))
    : undefined;

  const labelIds: string[] = [];
  const newLabelNames: string[] = [];
  for (const name of parsed.labels) {
    const label = lookup.labels.find((l) => sameName(l.name, name));
    if (label) labelIds.push(label.id);
    else newLabelNames.push(name);
  }

  const due = parsed.due;
  return {
    title: parsed.title,
    priority: parsed.priority ?? 4,
    projectId: project?.id ?? null,
    labelIds,
    newLabelNames,
    unknownProject: parsed.project && !project ? parsed.project : null,
    dueAt: due?.at ?? null,
    dueAllDay: due?.allDay ?? false,
    dueTz: due ? lookup.timeZone : null,
    rrule: due ? parsed.rrule : null,
    recurAfterCompletion: due ? parsed.recurAfterCompletion : false,
  };
}

/** A key that sorts after every task already in the same list (project + parent). */
export function positionAtEnd(
  tasks: readonly { projectId: string | null; parentId: string | null; position: string }[],
  scope: { projectId: string | null; parentId: string | null },
): string {
  let last: string | null = null;
  for (const task of tasks) {
    if (task.projectId !== scope.projectId || task.parentId !== scope.parentId) continue;
    if (last === null || task.position > last) last = task.position;
  }
  return positionBetween(last, null);
}
