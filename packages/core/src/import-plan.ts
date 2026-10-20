import { capWarnings, type ExchangeData, type ExchangeTask } from "./exchange.ts";
import { positionsBetween } from "./ordering.ts";
import { isValidRrule } from "./recurrence.ts";
import { zoned } from "./zoned.ts";

/** The database allows subtasks to nest this deep, counting the top-level task as level 1. */
const MAX_LEVEL = 5;

export interface PlannedProject {
  id: string;
  name: string;
  color: string | null;
  archived: boolean;
  position: string;
}
export interface PlannedSection {
  id: string;
  projectId: string;
  name: string;
  position: string;
}
export interface PlannedLabel {
  id: string;
  name: string;
  color: string | null;
}
export interface PlannedTask {
  id: string;
  parentId: string | null;
  projectId: string | null;
  sectionId: string | null;
  title: string;
  notes: string | null;
  priority: 1 | 2 | 3 | 4;
  dueAt: Date | null;
  dueAllDay: boolean;
  dueTz: string | null;
  rrule: string | null;
  recurAfterCompletion: boolean;
  completedAt: Date | null;
  position: string;
  labelIds: string[];
  /** 1 for a top-level task. Parents always come before their children in the plan. */
  depth: number;
}

/** Exactly what to create. Nothing here refers to an id from the file. */
export interface ImportPlan {
  projects: PlannedProject[];
  sections: PlannedSection[];
  labels: PlannedLabel[];
  tasks: PlannedTask[];
  warnings: string[];
}

/** What already exists, so an import joins it instead of duplicating it. */
export interface ImportContext {
  timeZone: string;
  now: Date;
  existingProjects: readonly { id: string; name: string }[];
  existingSections: readonly { id: string; projectId: string; name: string; position: string }[];
  existingLabels: readonly { id: string; name: string }[];
  /** The last position key in each existing top-level task list, by project id ("" for the Inbox). */
  topLevelEnd: ReadonlyMap<string, string>;
  /** The last position key among existing projects. */
  projectsEnd: string | null;
}

interface Draft {
  source: ExchangeTask;
  id: string;
  title: string;
  parentFileId: string | null;
  level: number;
  projectId: string | null;
}

/**
 * Turns a parsed file into the rows to create. Every id is replaced with a fresh one, so an
 * import can never overwrite anything. Projects, sections and labels that already exist (same
 * name, ignoring case) are reused. A subtask joins its parent's project; loops and nesting
 * deeper than five levels are broken; recurrence rules must be allowed and have a due date.
 * Everything that was changed or skipped is reported in `warnings`.
 */
export function planImport(data: ExchangeData, ctx: ImportContext, newId: () => string): ImportPlan {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const lower = (text: string) => text.toLowerCase();

  // Projects.
  const projectByName = new Map<string, string>();
  for (const project of ctx.existingProjects) {
    if (!projectByName.has(lower(project.name))) projectByName.set(lower(project.name), project.id);
  }
  const projectOfFile = new Map<string, string>();
  const projects: PlannedProject[] = [];
  for (const project of data.projects) {
    let id = projectByName.get(lower(project.name));
    if (!id) {
      id = newId();
      projectByName.set(lower(project.name), id);
      projects.push({ id, name: project.name, color: project.color, archived: project.archived, position: "" });
    }
    projectOfFile.set(project.id, id);
  }
  const projectPositions = positionsBetween(ctx.projectsEnd, null, projects.length);
  projects.forEach((project, i) => (project.position = projectPositions[i] ?? project.position));

  // Sections, per project.
  const sectionByName = new Map<string, string>();
  const lastSectionPosition = new Map<string, string>();
  for (const section of ctx.existingSections) {
    const key = `${section.projectId}|${lower(section.name)}`;
    if (!sectionByName.has(key)) sectionByName.set(key, section.id);
    const last = lastSectionPosition.get(section.projectId);
    if (last === undefined || section.position > last) lastSectionPosition.set(section.projectId, section.position);
  }
  const sectionOfFile = new Map<string, { id: string; projectId: string }>();
  const sections: PlannedSection[] = [];
  for (const section of data.sections) {
    const projectId = projectOfFile.get(section.projectId);
    if (!projectId) {
      warn(`Section "${section.name}" was skipped: its project is not in the file`);
      continue;
    }
    const key = `${projectId}|${lower(section.name)}`;
    let id = sectionByName.get(key);
    if (!id) {
      id = newId();
      sectionByName.set(key, id);
      sections.push({ id, projectId, name: section.name, position: "" });
    }
    sectionOfFile.set(section.id, { id, projectId });
  }
  const sectionsByProject = new Map<string, PlannedSection[]>();
  for (const section of sections) {
    sectionsByProject.set(section.projectId, [...(sectionsByProject.get(section.projectId) ?? []), section]);
  }
  for (const [projectId, list] of sectionsByProject) {
    const keys = positionsBetween(lastSectionPosition.get(projectId) ?? null, null, list.length);
    list.forEach((section, i) => (section.position = keys[i] ?? section.position));
  }

  // Labels.
  const labelByName = new Map<string, string>();
  for (const label of ctx.existingLabels) {
    if (!labelByName.has(lower(label.name))) labelByName.set(lower(label.name), label.id);
  }
  const labelOfFile = new Map<string, string>();
  const labels: PlannedLabel[] = [];
  for (const label of data.labels) {
    let id = labelByName.get(lower(label.name));
    if (!id) {
      id = newId();
      labelByName.set(lower(label.name), id);
      labels.push({ id, name: label.name, color: label.color });
    }
    labelOfFile.set(label.id, id);
  }

  // Tasks: keep the usable ones, in file order.
  const drafts = new Map<string, Draft>();
  const inFileOrder: Draft[] = [];
  for (const source of data.tasks) {
    const title = source.title.trim();
    if (title === "") {
      warn("A task with no title was skipped");
      continue;
    }
    if (drafts.has(source.id)) {
      warn(`Task "${title}" was skipped: its id is used by an earlier task`);
      continue;
    }
    const draft: Draft = { source, id: newId(), title, parentFileId: source.parentId, level: 1, projectId: null };
    drafts.set(source.id, draft);
    inFileOrder.push(draft);
  }

  // Parents that are missing, or that point at the task itself.
  for (const draft of inFileOrder) {
    const parent = draft.parentFileId;
    if (parent === null) continue;
    if (parent === draft.source.id || !drafts.has(parent)) {
      warn(`Task "${draft.title}" is top-level: its parent is not in the file`);
      draft.parentFileId = null;
    }
  }
  // Loops: cut the first link that closes one.
  for (const draft of inFileOrder) {
    const seen = new Set([draft.source.id]);
    for (let parent = draft.parentFileId; parent !== null; parent = drafts.get(parent)?.parentFileId ?? null) {
      if (seen.has(parent)) {
        warn(`Task "${draft.title}" is top-level: its parents formed a loop`);
        draft.parentFileId = null;
        break;
      }
      seen.add(parent);
    }
  }

  // Levels, parents first. Nesting past the limit moves up under the deepest allowed ancestor.
  const uncapped = (draft: Draft): number => {
    let level = 1;
    for (let p = draft.parentFileId; p !== null; p = drafts.get(p)?.parentFileId ?? null) level++;
    return level;
  };
  const levelOrder = [...inFileOrder]
    .map((draft, order) => ({ draft, order, level: uncapped(draft) }))
    .sort((a, b) => a.level - b.level || a.order - b.order)
    .map((entry) => entry.draft);

  for (const draft of levelOrder) {
    const parent = draft.parentFileId === null ? undefined : drafts.get(draft.parentFileId);
    if (!parent) {
      draft.level = 1;
      draft.projectId = projectOf(draft.source);
      continue;
    }
    draft.level = parent.level + 1;
    if (draft.level > MAX_LEVEL) {
      let ancestor: Draft = parent;
      while (ancestor.level > MAX_LEVEL - 1) {
        const up = ancestor.parentFileId === null ? undefined : drafts.get(ancestor.parentFileId);
        if (!up) break;
        ancestor = up;
      }
      warn(`Task "${draft.title}" was nested too deeply and now sits under "${ancestor.title}"`);
      draft.parentFileId = ancestor.source.id;
      draft.level = ancestor.level + 1;
      draft.projectId = ancestor.projectId;
    } else {
      draft.projectId = parent.projectId;
    }
    const wanted = draft.source.projectId === null ? null : (projectOfFile.get(draft.source.projectId) ?? null);
    if (draft.source.projectId !== null && wanted !== draft.projectId) {
      warn(`Subtask "${draft.title}" was moved to its parent's project`);
    }
  }

  function projectOf(source: ExchangeTask): string | null {
    if (source.projectId === null) return null;
    const resolved = projectOfFile.get(source.projectId);
    if (!resolved) warn(`Task "${source.title.trim()}" goes to the Inbox: its project is not in the file`);
    return resolved ?? null;
  }

  // Everything else about each task, then positions.
  const planned: PlannedTask[] = [];
  const plannedByDraft = new Map<Draft, PlannedTask>();
  for (const draft of levelOrder) {
    const { source } = draft;
    const parent = draft.parentFileId === null ? undefined : drafts.get(draft.parentFileId);

    let sectionId: string | null = null;
    if (!parent && source.sectionId !== null) {
      const section = sectionOfFile.get(source.sectionId);
      if (section && section.projectId === draft.projectId) sectionId = section.id;
      else warn(`Task "${draft.title}" has no section: it is not one of its project's sections`);
    }

    let dueAt: Date | null = null;
    if (source.dueAt !== null) {
      const at = new Date(source.dueAt);
      if (Number.isNaN(at.getTime())) warn(`Task "${draft.title}" has no due date: it could not be read`);
      else dueAt = at;
    }

    let rrule = source.rrule;
    if (rrule !== null && dueAt === null) {
      warn(`Task "${draft.title}" does not repeat: a repeating task needs a due date`);
      rrule = null;
    } else if (rrule !== null && !isValidRrule(rrule)) {
      warn(`Task "${draft.title}" does not repeat: "${rrule}" is not a supported repeat rule`);
      rrule = null;
    }

    let dueTz: string | null = null;
    if (dueAt !== null) {
      dueTz = source.dueTz ?? ctx.timeZone;
      try {
        zoned(ctx.now, dueTz);
      } catch {
        warn(`Task "${draft.title}" uses the unknown time zone "${dueTz}", so yours was used`);
        dueTz = ctx.timeZone;
      }
    }

    let completedAt: Date | null = null;
    if (source.completedAt !== null) {
      const at = new Date(source.completedAt);
      completedAt = Number.isNaN(at.getTime()) ? ctx.now : at;
    }

    const labelIds: string[] = [];
    let missingLabel = false;
    for (const fileLabel of source.labelIds) {
      const resolved = labelOfFile.get(fileLabel);
      if (!resolved) missingLabel = true;
      else if (!labelIds.includes(resolved)) labelIds.push(resolved);
    }
    if (missingLabel) warn(`Task "${draft.title}" lost a label that is not in the file`);

    const task: PlannedTask = {
      id: draft.id,
      parentId: parent ? parent.id : null,
      projectId: draft.projectId,
      sectionId,
      title: draft.title,
      notes: source.notes,
      priority: source.priority,
      dueAt,
      dueAllDay: dueAt !== null && source.dueAllDay,
      dueTz,
      rrule,
      recurAfterCompletion: rrule !== null && source.recurAfterCompletion,
      completedAt,
      position: "",
      labelIds,
      depth: draft.level,
    };
    planned.push(task);
    plannedByDraft.set(draft, task);
  }

  // Positions: each list keeps the file's order, and top-level lists continue after what is there.
  const lists = new Map<string, { tasks: PlannedTask[]; after: string | null }>();
  for (const draft of inFileOrder) {
    const task = plannedByDraft.get(draft);
    if (!task) continue;
    const key = task.parentId ? `sub:${task.parentId}` : `top:${task.projectId ?? ""}`;
    const list = lists.get(key) ?? { tasks: [], after: task.parentId ? null : (ctx.topLevelEnd.get(task.projectId ?? "") ?? null) };
    list.tasks.push(task);
    lists.set(key, list);
  }
  for (const list of lists.values()) {
    const keys = positionsBetween(list.after, null, list.tasks.length);
    list.tasks.forEach((task, i) => (task.position = keys[i] ?? task.position));
  }

  return { projects, sections, labels, tasks: planned, warnings: capWarnings(warnings) };
}
