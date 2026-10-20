import { compareTasks, positionBetween } from "@todo/core";
import type { Section, Task } from "@todo/data";

/** One column of a project's board: a section, or the tasks that have none. */
export interface BoardColumn {
  /** The section's id; null for "No section". */
  id: string | null;
  name: string;
  tasks: Task[];
}

const NO_SECTION = "No section";
const COLUMN_PREFIX = "column:";

/** The droppable id of a column, so a card can be dropped on an empty one. */
export const columnDropId = (sectionId: string | null): string => `${COLUMN_PREFIX}${sectionId ?? "none"}`;

/**
 * The columns of a project's board: "No section" first, then the project's sections in order.
 * Cards are the project's open top-level tasks (subtasks show on their parent's card). A task
 * whose section no longer exists falls into "No section".
 */
export function boardColumns(
  tasks: readonly Task[],
  sections: readonly Section[],
  projectId: string,
): BoardColumn[] {
  const projectSections = sections
    .filter((section) => section.projectId === projectId)
    .sort((a, b) => compareTasks(a, b));
  const known = new Set(projectSections.map((section) => section.id));

  const columns: BoardColumn[] = [
    { id: null, name: NO_SECTION, tasks: [] },
    ...projectSections.map((section) => ({ id: section.id, name: section.name, tasks: [] as Task[] })),
  ];
  const byId = new Map(columns.map((column) => [column.id, column]));

  for (const task of tasks) {
    if (task.projectId !== projectId || task.parentId !== null || task.completedAt !== null) continue;
    const column = byId.get(task.sectionId !== null && known.has(task.sectionId) ? task.sectionId : null);
    column?.tasks.push(task);
  }
  for (const column of columns) column.tasks.sort(compareTasks);
  return columns;
}

/**
 * The position key for a card placed at `index` among a column's cards (the moved card is
 * ignored if it is already in the column). If its new neighbours have equal keys there is
 * no room between them, so it goes to the end of the column instead.
 */
export function positionInColumn(
  column: readonly { id: string; position: string }[],
  movedId: string,
  index: number,
): string {
  const others = column.filter((card) => card.id !== movedId);
  const at = Math.min(Math.max(index, 0), others.length);
  try {
    return positionBetween(others[at - 1]?.position ?? null, others[at]?.position ?? null);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return positionBetween(others[others.length - 1]?.position ?? null, null);
  }
}

/**
 * Where a dragged card lands: the target column and the index among that column's other cards.
 * Dropped on a column body it goes last; on a card it goes before it, except when moving down
 * within the same column, where it goes after it. Null if the drop means nothing.
 */
export function dropTarget(
  columns: readonly BoardColumn[],
  activeId: string,
  overId: string,
): { sectionId: string | null; index: number } | null {
  if (activeId === overId) return null;
  const without = (column: BoardColumn) => column.tasks.filter((task) => task.id !== activeId);

  if (overId.startsWith(COLUMN_PREFIX)) {
    const key = overId.slice(COLUMN_PREFIX.length);
    const column = columns.find((c) => (c.id ?? "none") === key);
    return column ? { sectionId: column.id, index: without(column).length } : null;
  }

  const column = columns.find((c) => c.tasks.some((task) => task.id === overId));
  if (!column) return null;
  const overIndex = without(column).findIndex((task) => task.id === overId);
  const activeOriginal = column.tasks.findIndex((task) => task.id === activeId);
  const overOriginal = column.tasks.findIndex((task) => task.id === overId);
  const movingDownInColumn = activeOriginal >= 0 && activeOriginal < overOriginal;
  return { sectionId: column.id, index: movingDownInColumn ? overIndex + 1 : overIndex };
}
