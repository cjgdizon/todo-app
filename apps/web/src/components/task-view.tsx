"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { compareTasks, planCompletion, type TaskNode } from "@todo/core";
import {
  useBulkActions,
  useCompleteTask,
  useData,
  useLabels,
  useProjects,
  useTasks,
  useTrashTask,
  useUpdateTask,
  type BulkResult,
  type Task,
} from "@todo/data";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { reorder } from "@/lib/reorder";
import { toggleSelection } from "@/lib/selection";
import { useTaskSelection } from "@/lib/use-task-selection";
import { selectView, type View } from "@todo/data";
import { BulkBar } from "./bulk-bar";
import { QuickAdd, type QuickAddDefaults } from "./quick-add";
import { TaskRow } from "./task-row";
import { TodaySummary } from "./today-summary";
import { useToast } from "./toast";

/** Re-renders every minute so "overdue" flips without a reload. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const EMPTY: Record<View["kind"], string> = {
  inbox: "Your inbox is empty. Add a task above.",
  today: "Nothing is due today.",
  upcoming: "Nothing is scheduled ahead.",
  project: "No tasks in this project yet.",
  label: "No tasks with this label.",
  search: "No tasks match.",
  filter: "No tasks match this filter.",
};

const FADE_OUT_MS = 800;

interface TaskViewProps {
  view: View;
  title: string;
  /** Extra controls beside the heading (project rename and delete). */
  actions?: ReactNode;
}

export function TaskView({ view, title, actions }: TaskViewProps) {
  const { timeZone } = useData();
  const tasksQuery = useTasks();
  const projectsQuery = useProjects();
  const labelsQuery = useLabels();
  const updateTask = useUpdateTask();
  const completeTask = useCompleteTask();
  const trashTask = useTrashTask();
  const { notify } = useToast();
  const selection = useTaskSelection();
  const now = useNow();
  const ctx = { now, timeZone };

  // Tasks that were just completed stay on screen while the checkmark animation plays.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const forget = (id: string) =>
    setLeaving((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });

  const tasks = tasksQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const labels = labelsQuery.data ?? [];
  const result = selectView(tasks, view, ctx, { projects, labels }, leaving);

  // Selecting several tasks for a bulk action.
  const bulk = useBulkActions();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);

  const orderedIds: string[] = [];
  const collect = (nodes: TaskNode<Task>[]) => {
    for (const node of nodes) {
      orderedIds.push(node.task.id);
      collect(node.children);
    }
  };
  for (const section of result.sections) collect(section.nodes);
  // Only what is still on screen counts, in display order.
  const pickedIds = orderedIds.filter((id) => picked.has(id));

  const exitSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
    anchor.current = null;
  };

  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        setSelecting(false);
        setPicked(new Set());
        anchor.current = null;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selecting]);

  const tasksWord = (n: number) => (n === 1 ? "1 task" : `${n} tasks`);

  async function runBulk(action: () => Promise<BulkResult>, describe: (result: BulkResult) => string) {
    try {
      const outcome = await action();
      setPicked(new Set());
      anchor.current = null;
      if (outcome.count === 0) {
        notify("Subtasks stay in their parent's project, so nothing was moved.");
        return;
      }
      const left =
        outcome.skipped > 0
          ? ` ${outcome.skipped === 1 ? "1 subtask was" : `${outcome.skipped} subtasks were`} left in place.`
          : "";
      notify(describe(outcome) + left, { action: { label: "Undo", run: outcome.undo } });
    } catch {
      notify("Couldn't update those tasks. Try again.", { tone: "error" });
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onToggle(task: Task) {
    if (task.completedAt) {
      await updateTask.mutateAsync({ id: task.id, change: { completedAt: null } });
      forget(task.id);
      return;
    }
    const plan = planCompletion(task, new Date(), timeZone);
    if (plan.kind === "complete") setLeaving((current) => new Set(current).add(task.id));
    try {
      const outcome = await completeTask(task);
      notify(outcome.kind === "advance" ? "Done. Moved to the next date." : "Task completed.", {
        action: {
          label: "Undo",
          run: async () => {
            await outcome.undo();
            forget(task.id);
          },
        },
      });
    } catch {
      forget(task.id);
      notify("Couldn't update that task. Try again.", { tone: "error" });
    }
    window.setTimeout(() => forget(task.id), FADE_OUT_MS);
  }

  async function onDelete(task: Task) {
    try {
      const { count, undo } = await trashTask(task);
      if (selection.selectedId === task.id) selection.close();
      notify(count > 1 ? `Deleted "${task.title}" and its subtasks.` : `Deleted "${task.title}".`, {
        action: { label: "Undo", run: undo },
      });
    } catch {
      notify("Couldn't delete that task. Try again.", { tone: "error" });
    }
  }

  /** Moves a task among its siblings (same project and parent), in display order. */
  async function moveWithinSiblings(task: Task, to: (siblings: Task[], from: number) => number) {
    const siblings = tasks
      .filter((t) => t.completedAt === null && t.projectId === task.projectId && t.parentId === task.parentId)
      .sort(compareTasks);
    const from = siblings.findIndex((t) => t.id === task.id);
    if (from < 0) return;
    const updates = reorder(siblings, from, to(siblings, from));
    try {
      await Promise.all(updates.map((u) => updateTask.mutateAsync({ id: u.id, change: { position: u.position } })));
    } catch {
      notify("Couldn't reorder that. Try again.", { tone: "error" });
    }
  }

  const canReorder = (view.kind === "inbox" || view.kind === "project") && !selecting;

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const task = tasks.find((t) => t.id === active.id);
    const target = tasks.find((t) => t.id === over.id);
    if (!task || !target) return;
    void moveWithinSiblings(task, (siblings) => siblings.findIndex((t) => t.id === target.id));
  }

  const projectName = (task: Task): string | null =>
    view.kind === "project" || task.projectId === null
      ? null
      : (projects.find((p) => p.id === task.projectId)?.name ?? null);

  const renderRow = (node: TaskNode<Task>, sortable: boolean): ReactNode => {
    const rowProps = {
      task: node.task,
      ctx,
      projectName: projectName(node.task),
      labels: node.task.labelIds.flatMap((id) => labels.find((l) => l.id === id) ?? []),
      selected: selection.selectedId === node.task.id,
      onToggle: (t: Task) => void onToggle(t),
      onOpen: (t: Task) => selection.open(t.id),
      onDelete: (t: Task) => void onDelete(t),
      onMove: (t: Task, delta: -1 | 1) =>
        void moveWithinSiblings(t, (siblings, from) => Math.min(Math.max(from + delta, 0), siblings.length - 1)),
      ...(selecting
        ? {
            select: {
              checked: picked.has(node.task.id),
              onToggle: (shift: boolean) => {
                // Read the anchor now: the updater below runs after it has moved to this row.
                const from = anchor.current;
                setPicked((current) => toggleSelection(current, orderedIds, from, node.task.id, shift));
                anchor.current = node.task.id;
              },
            },
          }
        : {}),
    };
    const subtasks =
      node.children.length > 0 ? (
        <ul className="ml-9 border-l border-border pl-2">{node.children.map((child) => renderRow(child, false))}</ul>
      ) : null;
    return sortable ? (
      <SortableRow key={node.task.id} {...rowProps}>
        {subtasks}
      </SortableRow>
    ) : (
      <TaskRow key={node.task.id} {...rowProps}>
        {subtasks}
      </TaskRow>
    );
  };

  const defaults: QuickAddDefaults = {
    projectId: view.kind === "project" ? view.id : null,
    labelId: view.kind === "label" ? view.id : null,
    dueToday: view.kind === "today",
  };

  const loading = tasksQuery.isPending;
  const empty = result.sections.every((section) => section.nodes.length === 0);

  return (
    <main className={`mx-auto w-full max-w-[720px] px-4 py-8 ${selecting ? "pb-28" : ""}`}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-[28px] leading-[34px]">{title}</h1>
        <div className="flex items-center gap-1">
          {!empty && (
            <button
              type="button"
              aria-pressed={selecting}
              onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
              className={`rounded-sm px-2 py-1 text-sm ${selecting ? "bg-accent-subtle font-medium" : "text-accent-strong"}`}
            >
              Select
            </button>
          )}
          {actions}
        </div>
      </div>

      {view.kind === "today" && !loading && (
        <TodaySummary tasks={tasks} ctx={ctx} projectName={projectName} onComplete={(t) => void onToggle(t)} />
      )}

      {view.kind === "search" ? <SearchBox query={view.query} /> : <QuickAdd defaults={defaults} />}

      {tasksQuery.isError ? (
        <p role="alert" className="text-danger">
          <span aria-hidden="true">⚠ </span>
          Couldn&apos;t load your tasks.{" "}
          <button type="button" className="text-accent-strong underline" onClick={() => void tasksQuery.refetch()}>
            Try again
          </button>
        </p>
      ) : loading ? (
        <div aria-hidden="true" className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 rounded-md bg-surface-subtle" />
          ))}
        </div>
      ) : result.error ? (
        <p role="alert" className="text-danger">
          <span aria-hidden="true">⚠ </span>
          {result.error}
        </p>
      ) : empty ? (
        <p className="text-text-muted">
          {view.kind === "search" && view.query.trim() === "" ? "Type to search your tasks." : EMPTY[view.kind]}
        </p>
      ) : (
        result.sections.map((section) => (
          <section key={section.key} aria-label={section.title ?? title} className="mb-6">
            {section.title && (
              <h2 className="mb-1 font-serif text-[18px] leading-6 text-text-muted">{section.title}</h2>
            )}
            {canReorder ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={section.nodes.map((n) => n.task.id)} strategy={verticalListSortingStrategy}>
                  <ul>{section.nodes.map((node) => renderRow(node, true))}</ul>
                </SortableContext>
              </DndContext>
            ) : (
              <ul>{section.nodes.map((node) => renderRow(node, false))}</ul>
            )}
          </section>
        ))
      )}

      {selecting && (
        <BulkBar
          count={pickedIds.length}
          total={orderedIds.length}
          projects={projects}
          onSelectAll={() => setPicked(new Set(orderedIds))}
          onClear={() => setPicked(new Set())}
          onComplete={() =>
            void runBulk(() => bulk.complete(pickedIds), (r) => `${tasksWord(r.count)} completed.`)
          }
          onPriority={(priority) =>
            void runBulk(() => bulk.setPriority(pickedIds, priority), (r) => `Set ${tasksWord(r.count)} to P${priority}.`)
          }
          onMove={(projectId) => {
            const target = projectId ? (projects.find((p) => p.id === projectId)?.name ?? "the project") : "Inbox";
            void runBulk(() => bulk.move(pickedIds, projectId), (r) => `Moved ${tasksWord(r.count)} to ${target}.`);
          }}
          onDelete={() => void runBulk(() => bulk.trash(pickedIds), (r) => `Deleted ${tasksWord(r.count)}.`)}
          onDone={exitSelecting}
        />
      )}
    </main>
  );
}

type RowProps = Parameters<typeof TaskRow>[0];

function SortableRow(props: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id });
  return (
    <TaskRow
      {...props}
      drag={{
        setNodeRef,
        style: { transform: CSS.Transform.toString(transform), transition },
        attributes,
        listeners,
        isDragging,
      }}
    />
  );
}

function SearchBox({ query }: { query: string }) {
  const inputId = useId();
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState(query);

  const update = (value: string) => {
    setText(value);
    const next = new URLSearchParams(params.toString());
    if (value) next.set("q", value);
    else next.delete("q");
    router.replace(`/search${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
  };

  return (
    <div className="mb-4">
      <label htmlFor={inputId} className="sr-only">
        Search tasks
      </label>
      <input
        id={inputId}
        type="search"
        autoComplete="off"
        value={text}
        onChange={(event) => update(event.target.value)}
        placeholder="Search, or filter like p1 & #home & due:today"
        className="w-full rounded-md border border-border bg-surface-subtle px-3 py-2 text-base placeholder:text-text-muted"
      />
    </div>
  );
}
