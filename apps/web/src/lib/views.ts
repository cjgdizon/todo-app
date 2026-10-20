import {
  buildTaskTree,
  compareTasks,
  dueBucket,
  FilterParseError,
  groupUpcoming,
  matchesFilter,
  parseFilter,
  type TaskNode,
  type ViewContext,
} from "@todo/core";
import type { Label, Project, Task } from "@todo/data";
import { formatDue } from "./format";

/** What a list screen shows. Smart views are computed from the full task list. */
export type View =
  | { kind: "inbox" }
  | { kind: "today" }
  | { kind: "upcoming" }
  | { kind: "project"; id: string }
  | { kind: "label"; id: string }
  | { kind: "search"; query: string };

export interface ViewSection {
  key: string;
  /** Heading above the section; null for a single untitled list. */
  title: string | null;
  nodes: TaskNode<Task>[];
}

export interface ViewResult {
  sections: ViewSection[];
  /** A message to show instead of results (e.g. an unreadable search filter). */
  error: string | null;
}

const flat = (tasks: readonly Task[]): TaskNode<Task>[] => tasks.map((task) => ({ task, children: [] }));

/** Earliest due first, then most important, then manual order. */
function byUrgency(a: Task, b: Task): number {
  const diff = (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0);
  if (diff !== 0) return diff;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return compareTasks(a, b);
}

/**
 * Picks and orders the tasks for a screen. Completed tasks are hidden, except the
 * ids in `keepIds`, which stay visible while their completion animation plays.
 */
export function selectView(
  tasks: readonly Task[],
  view: View,
  ctx: ViewContext,
  lookups: { projects: readonly Project[]; labels: readonly Label[] },
  keepIds: ReadonlySet<string>,
): ViewResult {
  const open = tasks.filter((task) => task.completedAt === null || keepIds.has(task.id));
  const one = (nodes: TaskNode<Task>[]): ViewResult => ({
    sections: [{ key: "main", title: null, nodes }],
    error: null,
  });

  switch (view.kind) {
    case "inbox":
      return one(buildTaskTree(open.filter((t) => t.projectId === null)));

    case "project":
      return one(buildTaskTree(open.filter((t) => t.projectId === view.id)));

    case "label":
      return one(flat(open.filter((t) => t.labelIds.includes(view.id)).sort(compareTasks)));

    case "today": {
      const overdue = open.filter((t) => dueBucket(t, ctx) === "overdue").sort(byUrgency);
      const today = open.filter((t) => dueBucket(t, ctx) === "today").sort(byUrgency);
      const sections: ViewSection[] = [];
      if (overdue.length > 0) sections.push({ key: "overdue", title: "Overdue", nodes: flat(overdue) });
      if (today.length > 0) sections.push({ key: "today", title: "Today", nodes: flat(today) });
      return { sections, error: null };
    }

    case "upcoming":
      return {
        sections: groupUpcoming(open, ctx).map((group) => {
          const first = group.tasks[0];
          return {
            key: group.date,
            title: first?.dueAt ? formatDue({ dueAt: first.dueAt, dueAllDay: true }, ctx).label : group.date,
            nodes: flat(group.tasks),
          };
        }),
        error: null,
      };

    case "search": {
      if (view.query.trim() === "") return { sections: [], error: null };
      try {
        const filter = parseFilter(view.query);
        const projectName = (id: string | null) =>
          id ? (lookups.projects.find((p) => p.id === id)?.name ?? null) : null;
        const matches = open
          .filter((t) =>
            matchesFilter(
              filter,
              {
                title: t.title,
                notes: t.notes,
                priority: t.priority,
                projectName: projectName(t.projectId),
                labelNames: t.labelIds.flatMap((id) => lookups.labels.find((l) => l.id === id)?.name ?? []),
                dueAt: t.dueAt,
                dueAllDay: t.dueAllDay,
                completedAt: t.completedAt,
              },
              ctx,
            ),
          )
          .sort(compareTasks);
        return one(flat(matches));
      } catch (error) {
        if (error instanceof FilterParseError) return { sections: [], error: error.message };
        throw error;
      }
    }
  }
}
