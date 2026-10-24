"use client";

import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  compareTasks,
  dueBucket,
  groupTasksByDay,
  instantToLocal,
  monthGrid,
  rescheduleToDay,
  shiftMonth,
} from "@todo/core";
import { useData, useTasks, useUpdateTask, type Task } from "@todo/data";
import { useState } from "react";
import { formatDue } from "@todo/data";
import { useTaskSelection } from "@/lib/use-task-selection";
import { useToast } from "./toast";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

const monthTitle = (year: number, month: number) =>
  new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );

/** All-day tasks first, then by time, then manual order. */
function byTimeOfDay(a: Task, b: Task): number {
  if (a.dueAllDay !== b.dueAllDay) return a.dueAllDay ? -1 : 1;
  const diff = (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0);
  return diff !== 0 ? diff : compareTasks(a, b);
}

const navButton = "rounded-sm px-3 py-1 text-sm text-accent-strong";

export function CalendarView() {
  const { timeZone } = useData();
  const tasks = useTasks();
  const update = useUpdateTask();
  const { notify } = useToast();
  const selection = useTaskSelection();

  const today = instantToLocal(new Date(), timeZone).date;
  const [shown, setShown] = useState(() => {
    const [year, month] = today.split("-").map(Number);
    return { year: year ?? 1970, month: month ?? 1 };
  });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // Pointer drag only: the task drawer's date field is the keyboard way to reschedule.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const open = (tasks.data ?? []).filter((task) => task.completedAt === null && task.dueAt !== null);
  const byDay = groupTasksByDay(open, timeZone);
  const weeks = monthGrid(shown.year, shown.month);
  const monthPrefix = `${shown.year}-${String(shown.month).padStart(2, "0")}`;

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const task = open.find((t) => t.id === active.id);
    if (!task?.dueAt) return;
    const next = rescheduleToDay({ dueAt: task.dueAt, dueAllDay: task.dueAllDay }, String(over.id), timeZone);
    if (!next || next.getTime() === task.dueAt.getTime()) return;

    const previous = task.dueAt;
    update.mutate(
      { id: task.id, change: { dueAt: next } },
      { onError: () => notify("Couldn't move that task. Try again.", { tone: "error" }) },
    );
    notify(`Moved "${task.title}" to ${formatDue({ dueAt: next, dueAllDay: task.dueAllDay }, { now: new Date(), timeZone }).label}.`, {
      action: { label: "Undo", run: () => update.mutateAsync({ id: task.id, change: { dueAt: previous } }) },
    });
  }

  const toggleExpanded = (day: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[20px] leading-7 font-semibold">Calendar</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={navButton}
            onClick={() => setShown(shiftMonth(shown.year, shown.month, -1))}
          >
            Previous month
          </button>
          <button
            type="button"
            className={navButton}
            onClick={() => {
              const [year, month] = today.split("-").map(Number);
              setShown({ year: year ?? shown.year, month: month ?? shown.month });
            }}
          >
            Today
          </button>
          <button type="button" className={navButton} onClick={() => setShown(shiftMonth(shown.year, shown.month, 1))}>
            Next month
          </button>
        </div>
      </div>

      <h2 aria-live="polite" className="mb-2 text-base font-medium">
        {monthTitle(shown.year, shown.month)}
      </h2>

      {tasks.isError ? (
        <p role="alert" className="text-danger">
          <span aria-hidden="true">⚠ </span>
          Couldn&apos;t load your tasks.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <table className="w-full min-w-[640px] table-fixed border-collapse">
              <caption className="sr-only">Tasks by due date, {monthTitle(shown.year, shown.month)}</caption>
              <thead>
                <tr>
                  {WEEKDAYS.map((name) => (
                    <th key={name} scope="col" className="py-1 text-sm font-medium text-text-muted">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week[0]}>
                    {week.map((day) => (
                      <DayCell
                        key={day}
                        day={day}
                        inMonth={day.startsWith(monthPrefix)}
                        isToday={day === today}
                        tasks={[...(byDay.get(day) ?? [])].sort(byTimeOfDay)}
                        showAll={expanded.has(day)}
                        onToggleAll={() => toggleExpanded(day)}
                        onOpen={(task) => selection.open(task.id)}
                        timeZone={timeZone}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </DndContext>
        </div>
      )}
    </main>
  );
}

interface DayCellProps {
  day: string;
  inMonth: boolean;
  isToday: boolean;
  tasks: Task[];
  showAll: boolean;
  onToggleAll: () => void;
  onOpen: (task: Task) => void;
  timeZone: string;
}

function DayCell({ day, inMonth, isToday, tasks, showAll, onToggleAll, onOpen, timeZone }: DayCellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: day });
  const visible = showAll ? tasks : tasks.slice(0, MAX_CHIPS);
  const hidden = tasks.length - visible.length;

  return (
    <td
      ref={setNodeRef}
      data-day={day}
      aria-current={isToday ? "date" : undefined}
      className={`h-28 border border-border p-1 align-top ${inMonth ? "" : "bg-surface-subtle text-text-muted"} ${
        isOver ? "bg-accent-subtle" : ""
      }`}
    >
      <time
        dateTime={day}
        className={`mb-1 inline-flex size-6 items-center justify-center rounded-full text-sm tabular-nums ${
          isToday ? "bg-accent font-medium text-on-accent" : ""
        }`}
      >
        {Number(day.slice(8))}
      </time>
      <ul className="flex flex-col gap-0.5">
        {visible.map((task) => (
          <Chip key={task.id} task={task} timeZone={timeZone} onOpen={onOpen} />
        ))}
      </ul>
      {(hidden > 0 || showAll) && tasks.length > MAX_CHIPS && (
        <button
          type="button"
          onClick={onToggleAll}
          aria-expanded={showAll}
          className="mt-0.5 rounded-sm px-1 text-sm text-accent-strong"
        >
          {showAll ? "Show fewer" : `+${hidden} more`}
        </button>
      )}
    </td>
  );
}

function Chip({ task, timeZone, onOpen }: { task: Task; timeZone: string; onOpen: (task: Task) => void }) {
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const overdue = dueBucket(task, { now: new Date(), timeZone }) === "overdue";
  const time = task.dueAt && !task.dueAllDay ? instantToLocal(task.dueAt, timeZone).time : null;

  return (
    <li style={{ transform: CSS.Translate.toString(transform) }} className={isDragging ? "relative z-10" : undefined}>
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        onClick={() => onOpen(task)}
        className={`block w-full truncate rounded-sm bg-accent-subtle px-1.5 py-0.5 text-left text-sm ${
          overdue ? "text-warning" : "text-text"
        } ${isDragging ? "shadow-pop" : ""}`}
      >
        {overdue && <span className="sr-only">Overdue: </span>}
        {time && <span className="mr-1 tabular-nums">{time}</span>}
        {task.priority !== 4 && <span className="mr-1 font-medium">P{task.priority}</span>}
        {task.title}
      </button>
    </li>
  );
}
