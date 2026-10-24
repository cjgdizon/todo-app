"use client";

import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import type { ViewContext } from "@todo/core";
import type { Label, Task } from "@todo/data";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { formatDue } from "@todo/data";
import { describeRecurrence } from "@todo/data";
import { CheckIcon, ClockIcon, DragIcon, FlagIcon, HashIcon, RepeatIcon, TagIcon, TrashIcon } from "./icons";

export interface DragBindings {
  setNodeRef: (element: HTMLElement | null) => void;
  style: CSSProperties;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  isDragging: boolean;
}

interface TaskRowProps {
  task: Task;
  ctx: ViewContext;
  /** Shown beside the task; null in a project's own view, where it is implied. */
  projectName: string | null;
  labels: readonly Label[];
  selected: boolean;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  onDelete: (task: Task) => void;
  /** Alt+Up / Alt+Down: move one place among siblings. */
  onMove: (task: Task, delta: -1 | 1) => void;
  drag?: DragBindings;
  /** Present while selecting several tasks; the row then shows a selection checkbox. */
  select?: { checked: boolean; onToggle: (shiftKey: boolean) => void };
  /** Nested subtask list. */
  children?: ReactNode;
}

const PRIORITY_COLOR: Record<number, string> = {
  1: "text-priority-1",
  2: "text-priority-2",
  3: "text-priority-3",
};

export function TaskRow({
  task,
  ctx,
  projectName,
  labels,
  selected,
  onToggle,
  onOpen,
  onDelete,
  onMove,
  drag,
  select,
  children,
}: TaskRowProps) {
  const done = task.completedAt !== null;
  const due = task.dueAt ? formatDue({ dueAt: task.dueAt, dueAllDay: task.dueAllDay }, ctx) : null;

  const onTitleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    onMove(task, event.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <li
      ref={drag?.setNodeRef}
      style={drag?.style}
      data-task-id={task.id}
      className={`group list-none ${done ? "row-leaving" : ""} ${drag?.isDragging ? "opacity-60" : ""}`}
    >
      <div
        className={`flex items-start gap-3 rounded-md px-2 py-3 hover:bg-surface-subtle focus-within:bg-surface-subtle ${
          selected || select?.checked ? "bg-accent-subtle hover:bg-accent-subtle" : ""
        }`}
      >
        {select ? (
          <input
            type="checkbox"
            checked={select.checked}
            aria-label={`Select: ${task.title}`}
            // The click carries the Shift key; React needs onChange for a controlled checkbox.
            onChange={() => undefined}
            onClick={(event) => select.onToggle(event.shiftKey)}
            className="mt-1 size-5 shrink-0 accent-accent"
          />
        ) : null}
        {drag ? (
          <button
            type="button"
            aria-label={`Reorder: ${task.title}`}
            className="mt-0.5 flex size-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            {...drag.attributes}
            {...drag.listeners}
          >
            <DragIcon />
          </button>
        ) : null}

        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={`Complete: ${task.title}`}
          onClick={() => onToggle(task)}
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
            done
              ? "border-accent bg-accent text-on-accent"
              : "border-text-muted text-transparent hover:text-text-muted"
          }`}
        >
          <CheckIcon width={14} height={14} />
        </button>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpen(task)}
            onKeyDown={onTitleKeyDown}
            className={`block w-full text-left font-medium ${done ? "text-text-muted line-through opacity-60" : ""}`}
          >
            {task.title}
          </button>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
            {due && (
              <span className={`inline-flex items-center gap-1 tabular-nums ${due.overdue ? "text-warning" : ""}`}>
                {due.overdue && <ClockIcon width={14} height={14} />}
                {due.overdue && <span className="sr-only">Overdue: </span>}
                {due.label}
              </span>
            )}
            {task.rrule && (
              <span className="inline-flex items-center gap-1">
                <RepeatIcon width={14} height={14} />
                {describeRecurrence(task.rrule, task.recurAfterCompletion)}
              </span>
            )}
            {task.priority !== 4 && (
              <span className={`inline-flex items-center gap-1 ${PRIORITY_COLOR[task.priority] ?? ""}`}>
                <FlagIcon width={14} height={14} />P{task.priority}
              </span>
            )}
            {projectName && (
              <span className="inline-flex items-center gap-1">
                <HashIcon width={14} height={14} />
                {projectName}
              </span>
            )}
            {labels.map((label) => (
              <span key={label.id} className="inline-flex items-center gap-1">
                <TagIcon width={14} height={14} />
                {label.name}
              </span>
            ))}
          </div>
        </div>

        <button
          type="button"
          aria-label={`Delete: ${task.title}`}
          onClick={() => onDelete(task)}
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm text-text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <TrashIcon />
        </button>
      </div>
      {children}
    </li>
  );
}
