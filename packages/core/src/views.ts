import { nextDue } from "./recurrence.ts";
import { zoned } from "./zoned.ts";

/**
 * Pure helpers behind the list views: which bucket a due date falls in, how
 * upcoming tasks group by day, how subtasks nest, and what completing a task
 * does. Dates are evaluated in the viewer's time zone.
 */

export interface ViewContext {
  now: Date;
  timeZone: string;
}

export type DueBucket = "none" | "overdue" | "today" | "upcoming";

/**
 * Where a task sits relative to now. A timed task is overdue once its time has
 * passed; an all-day task is overdue only after its day has ended.
 */
export function dueBucket(
  task: { dueAt: Date | null; dueAllDay: boolean },
  ctx: ViewContext,
): DueBucket {
  if (!task.dueAt) return "none";
  const due = zoned(task.dueAt, ctx.timeZone);
  const now = zoned(ctx.now, ctx.timeZone);
  const startOfToday = now.startOf("day");
  if (due >= startOfToday.plus({ days: 1 })) return "upcoming";
  if (due >= startOfToday) return !task.dueAllDay && due < now ? "overdue" : "today";
  return "overdue";
}

/** `order by position, id`: plain string comparison, matching Postgres COLLATE "C". */
export function compareTasks(
  a: { id: string; position: string },
  b: { id: string; position: string },
): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export interface UpcomingTask {
  id: string;
  dueAt: Date | null;
  dueAllDay: boolean;
  position: string;
}

export interface UpcomingGroup<T extends UpcomingTask> {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  tasks: T[];
}

/** Tasks due after today, grouped by local day (earliest first); all-day before timed. */
export function groupUpcoming<T extends UpcomingTask>(
  tasks: readonly T[],
  ctx: ViewContext,
): UpcomingGroup<T>[] {
  const byDay = new Map<string, T[]>();
  for (const task of tasks) {
    if (dueBucket(task, ctx) !== "upcoming" || !task.dueAt) continue;
    const date = zoned(task.dueAt, ctx.timeZone).toISODate();
    if (!date) continue;
    const day = byDay.get(date) ?? [];
    day.push(task);
    byDay.set(date, day);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, dayTasks]) => ({
      date,
      tasks: dayTasks.sort((a, b) => {
        if (a.dueAllDay !== b.dueAllDay) return a.dueAllDay ? -1 : 1;
        const diff = (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0);
        return diff !== 0 ? diff : compareTasks(a, b);
      }),
    }));
}

export interface TaskNode<T> {
  task: T;
  children: TaskNode<T>[];
}

/**
 * Subtasks nested under their parents, siblings in `position, id` order. A task
 * whose parent is not in the list is shown at the top level. Tasks that only
 * reference each other in a loop are dropped (the database forbids cycles).
 */
export function buildTaskTree<T extends { id: string; parentId: string | null; position: string }>(
  tasks: readonly T[],
): TaskNode<T>[] {
  const nodes = new Map<string, TaskNode<T>>(
    tasks.map((task) => [task.id, { task, children: [] }]),
  );
  const roots: TaskNode<T>[] = [];
  for (const node of nodes.values()) {
    const parent = node.task.parentId ? nodes.get(node.task.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: TaskNode<T>[]): TaskNode<T>[] => {
    list.sort((a, b) => compareTasks(a.task, b.task));
    for (const node of list) sort(node.children);
    return list;
  };
  return sort(roots);
}

/** Ids of every subtask under `rootId`, at any depth (not `rootId` itself). Safe on cyclic data. */
export function descendantIds(
  tasks: readonly { id: string; parentId: string | null }[],
  rootId: string,
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.parentId === null) continue;
    const siblings = childrenOf.get(task.parentId) ?? [];
    siblings.push(task.id);
    childrenOf.set(task.parentId, siblings);
  }
  const seen = new Set<string>([rootId]);
  const out: string[] = [];
  const queue = [rootId];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const child of childrenOf.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

/** `ids` plus every subtask under any of them, each id once. */
export function withDescendants(
  tasks: readonly { id: string; parentId: string | null }[],
  ids: readonly string[],
): string[] {
  const all = new Set(ids);
  for (const id of ids) for (const child of descendantIds(tasks, id)) all.add(child);
  return [...all];
}

/**
 * Which tasks a bulk "move to project" can change. A subtask must stay in its parent's
 * project (the database enforces it), so only selected top-level tasks move, and they take
 * all their subtasks along. A selected subtask without its parent is reported in `skipped`.
 */
export function planBulkMove(
  tasks: readonly { id: string; parentId: string | null }[],
  selectedIds: readonly string[],
): { ids: string[]; skipped: string[] } {
  const parentOf = new Map(tasks.map((task) => [task.id, task.parentId]));
  const roots = selectedIds.filter((id) => parentOf.get(id) === null);
  const ids = withDescendants(tasks, roots);
  const moved = new Set(ids);
  return { ids, skipped: selectedIds.filter((id) => !moved.has(id)) };
}

export interface CompletableTask {
  dueAt: Date | null;
  rrule: string | null;
  dueTz: string | null;
  recurAfterCompletion: boolean;
}

export type CompletionPlan = { kind: "complete" } | { kind: "advance"; nextDueAt: Date };

/**
 * What completing a task does: a recurring task moves to its next due date, any
 * other task (or one whose rule has ended) is marked done.
 */
export function planCompletion(
  task: CompletableTask,
  completedAt: Date,
  fallbackZone: string,
): CompletionPlan {
  if (!task.rrule || !task.dueAt) return { kind: "complete" };
  const nextDueAt = nextDue({
    rrule: task.rrule,
    dueAt: task.dueAt,
    completedAt,
    timeZone: task.dueTz ?? fallbackZone,
    afterCompletion: task.recurAfterCompletion,
  });
  return nextDueAt ? { kind: "advance", nextDueAt } : { kind: "complete" };
}

/**
 * `planCompletion` for many tasks at once: the ones that simply finish are listed together
 * (so they can be saved in one statement), recurring ones each get their own next date.
 */
export function planBulkCompletion<T extends CompletableTask & { id: string }>(
  tasks: readonly T[],
  completedAt: Date,
  fallbackZone: string,
): { completeIds: string[]; advances: { id: string; nextDueAt: Date }[] } {
  const completeIds: string[] = [];
  const advances: { id: string; nextDueAt: Date }[] = [];
  for (const task of tasks) {
    const plan = planCompletion(task, completedAt, fallbackZone);
    if (plan.kind === "advance") advances.push({ id: task.id, nextDueAt: plan.nextDueAt });
    else completeIds.push(task.id);
  }
  return { completeIds, advances };
}
