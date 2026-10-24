"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useCompleteTask,
  useCreateSection,
  useData,
  useSections,
  useTasks,
  useUpdateTask,
  type Project,
  type Section,
  type Task,
} from "@todo/data";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { boardColumns, columnDropId, dropTarget, positionInColumn, type BoardColumn } from "@/lib/board";
import { formatDue } from "@todo/data";
import { useTaskSelection } from "@/lib/use-task-selection";
import { CheckIcon, ClockIcon, DragIcon, FlagIcon } from "./icons";
import { QuickAdd } from "./quick-add";
import { SectionActions } from "./section-actions";
import { useToast } from "./toast";

interface SubtaskCount {
  done: number;
  total: number;
}

/** A project as a board: one column per section, cards you can drag between them. */
export function BoardView({ project, actions }: { project: Project; actions: ReactNode }) {
  const { timeZone } = useData();
  const tasksQuery = useTasks();
  const sectionsQuery = useSections();
  const update = useUpdateTask();
  const completeTask = useCompleteTask();
  const createSection = useCreateSection();
  const { notify } = useToast();
  const selection = useTaskSelection();

  const tasks = tasksQuery.data ?? [];
  const sections = sectionsQuery.data ?? [];
  const columns = boardColumns(tasks, sections, project.id);

  const subtaskCounts = new Map<string, SubtaskCount>();
  for (const task of tasks) {
    if (task.parentId === null) continue;
    const count = subtaskCounts.get(task.parentId) ?? { done: 0, total: 0 };
    count.total += 1;
    if (task.completedAt !== null) count.done += 1;
    subtaskCounts.set(task.parentId, count);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const target = dropTarget(columns, String(active.id), String(over.id));
    const task = tasks.find((t) => t.id === active.id);
    const column = target ? columns.find((c) => c.id === target.sectionId) : undefined;
    if (!target || !task || !column) return;

    const position = positionInColumn(column.tasks, task.id, target.index);
    if (task.sectionId === target.sectionId && task.position === position) return;
    update.mutate(
      { id: task.id, change: { sectionId: target.sectionId, position } },
      { onError: () => notify("Couldn't move that card. Try again.", { tone: "error" }) },
    );
  }

  async function onComplete(task: Task) {
    try {
      const outcome = await completeTask(task);
      notify(outcome.kind === "advance" ? "Done. Moved to the next date." : "Task completed.", {
        action: { label: "Undo", run: outcome.undo },
      });
    } catch {
      notify("Couldn't update that task. Try again.", { tone: "error" });
    }
  }

  async function onAddSection(name: string) {
    try {
      await createSection(project.id, name);
    } catch {
      notify("Couldn't add that section. Try again.", { tone: "error" });
    }
  }

  const sectionById = new Map<string, Section>(sections.map((section) => [section.id, section]));

  return (
    <main className="w-full px-4 py-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-[20px] leading-7 font-semibold">{project.name}</h1>
        <div className="flex items-center gap-1">{actions}</div>
      </div>

      <div className="max-w-[720px]">
        <QuickAdd defaults={{ projectId: project.id, labelId: null, dueToday: false }} />
      </div>

      {tasksQuery.isError ? (
        <p role="alert" className="text-danger">
          <span aria-hidden="true">⚠ </span>
          Couldn&apos;t load your tasks.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
          <div className="flex items-start gap-4 overflow-x-auto pb-4">
            {columns.map((column) => (
              <Column
                key={column.id ?? "none"}
                column={column}
                section={column.id ? sectionById.get(column.id) : undefined}
                subtaskCounts={subtaskCounts}
                timeZone={timeZone}
                selectedId={selection.selectedId}
                onOpen={(task) => selection.open(task.id)}
                onComplete={(task) => void onComplete(task)}
              />
            ))}
            <AddSection onAdd={onAddSection} />
          </div>
        </DndContext>
      )}
    </main>
  );
}

interface ColumnProps {
  column: BoardColumn;
  section: Section | undefined;
  subtaskCounts: ReadonlyMap<string, SubtaskCount>;
  timeZone: string;
  selectedId: string | null;
  onOpen: (task: Task) => void;
  onComplete: (task: Task) => void;
}

function Column({ column, section, subtaskCounts, timeZone, selectedId, onOpen, onComplete }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(column.id) });

  return (
    <section aria-label={column.name} className="w-72 shrink-0 rounded-md bg-surface-subtle p-2">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-medium">
          {column.name} <span className="text-text-muted tabular-nums">{column.tasks.length}</span>
        </h2>
        {section && <SectionActions section={section} taskCount={column.tasks.length} />}
      </div>
      <SortableContext items={column.tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={`flex min-h-16 flex-col gap-2 rounded-md ${isOver ? "bg-accent-subtle" : ""}`}
        >
          {column.tasks.map((task) => (
            <Card
              key={task.id}
              task={task}
              subtasks={subtaskCounts.get(task.id)}
              timeZone={timeZone}
              selected={selectedId === task.id}
              onOpen={onOpen}
              onComplete={onComplete}
            />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

interface CardProps {
  task: Task;
  subtasks: SubtaskCount | undefined;
  timeZone: string;
  selected: boolean;
  onOpen: (task: Task) => void;
  onComplete: (task: Task) => void;
}

function Card({ task, subtasks, timeZone, selected, onOpen, onComplete }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const due = task.dueAt ? formatDue({ dueAt: task.dueAt, dueAllDay: task.dueAllDay }, { now: new Date(), timeZone }) : null;

  return (
    <li
      ref={setNodeRef}
      data-task-id={task.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-md border border-border bg-surface p-3 ${selected ? "bg-accent-subtle" : ""} ${
        isDragging ? "relative z-10 opacity-70 shadow-pop" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={false}
          aria-label={`Complete: ${task.title}`}
          onClick={() => onComplete(task)}
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-text-muted text-transparent hover:text-text-muted"
        >
          <CheckIcon width={12} height={12} />
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => onOpen(task)} className="block w-full text-left font-medium">
            {task.title}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
            {due && (
              <span className={`inline-flex items-center gap-1 tabular-nums ${due.overdue ? "text-warning" : ""}`}>
                {due.overdue && <ClockIcon width={14} height={14} />}
                {due.overdue && <span className="sr-only">Overdue: </span>}
                {due.label}
              </span>
            )}
            {task.priority !== 4 && (
              <span className="inline-flex items-center gap-1">
                <FlagIcon width={14} height={14} />P{task.priority}
              </span>
            )}
            {subtasks && (
              <span className="tabular-nums">
                {subtasks.done}/{subtasks.total} subtasks
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label={`Move: ${task.title}`}
          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-text-muted"
          {...attributes}
          {...listeners}
        >
          <DragIcon />
        </button>
      </div>
    </li>
  );
}

function AddSection({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const inputId = useId();
  const [name, setName] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    await onAdd(trimmed);
  }

  return (
    <form onSubmit={onSubmit} className="w-72 shrink-0 rounded-md border border-dashed border-border p-2">
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
        New section
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={name}
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          placeholder="Section name"
          className="min-w-0 flex-1 rounded-sm border border-border bg-surface-subtle px-2 py-1 text-base"
        />
        <button type="submit" disabled={!name.trim()} className="rounded-sm px-2 py-1 text-accent-strong underline disabled:opacity-50">
          Add section
        </button>
      </div>
    </form>
  );
}
