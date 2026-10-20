import type { ExchangeData, ImportContext } from "@todo/core";
import type { Label, Project, Section, Task } from "./models.ts";

/** `order by position, id`, as a plain string comparison. */
const byPosition = (a: { id: string; position: string }, b: { id: string; position: string }): number =>
  a.position === b.position ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.position < b.position ? -1 : 1;

/** The workspace's data in the export shape, in display order. */
export function toExchangeData(input: {
  projects: readonly Project[];
  sections: readonly Section[];
  labels: readonly Label[];
  tasks: readonly Task[];
}): ExchangeData {
  return {
    projects: [...input.projects]
      .sort(byPosition)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, archived: p.archived })),
    sections: [...input.sections]
      .sort(byPosition)
      .map((s) => ({ id: s.id, projectId: s.projectId, name: s.name })),
    labels: input.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    tasks: [...input.tasks].sort(byPosition).map((t) => ({
      id: t.id,
      parentId: t.parentId,
      projectId: t.projectId,
      sectionId: t.sectionId,
      title: t.title,
      notes: t.notes,
      priority: t.priority,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
      dueAllDay: t.dueAllDay,
      dueTz: t.dueTz,
      rrule: t.rrule,
      recurAfterCompletion: t.recurAfterCompletion,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      labelIds: [...t.labelIds],
    })),
  };
}

/** What the import planner needs to know about what already exists. */
export function importContextFrom(input: {
  projects: readonly Project[];
  sections: readonly Section[];
  labels: readonly Label[];
  tasks: readonly Task[];
  timeZone: string;
  now: Date;
}): ImportContext {
  const topLevelEnd = new Map<string, string>();
  for (const task of input.tasks) {
    if (task.parentId !== null) continue;
    const key = task.projectId ?? "";
    const last = topLevelEnd.get(key);
    if (last === undefined || task.position > last) topLevelEnd.set(key, task.position);
  }
  const projectsEnd = input.projects.reduce<string | null>(
    (max, project) => (max === null || project.position > max ? project.position : max),
    null,
  );
  return {
    timeZone: input.timeZone,
    now: input.now,
    existingProjects: input.projects.map((p) => ({ id: p.id, name: p.name })),
    existingSections: input.sections.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      name: s.name,
      position: s.position,
    })),
    existingLabels: input.labels.map((l) => ({ id: l.id, name: l.name })),
    topLevelEnd,
    projectsEnd,
  };
}
