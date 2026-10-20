"use client";

import type { Project } from "@todo/data";
import { useId } from "react";

interface BulkBarProps {
  count: number;
  total: number;
  projects: readonly Project[];
  onSelectAll: () => void;
  onClear: () => void;
  onComplete: () => void;
  onPriority: (priority: 1 | 2 | 3 | 4) => void;
  /** `null` means the Inbox. */
  onMove: (projectId: string | null) => void;
  onDelete: () => void;
  onDone: () => void;
}

const field = "rounded-sm border border-border bg-surface-subtle px-2 py-1 text-sm disabled:opacity-50";
const quiet = "rounded-sm px-2 py-1 text-sm disabled:opacity-50";

/** Actions for the selected tasks, pinned to the bottom of the screen while selecting. */
export function BulkBar(props: BulkBarProps) {
  const priorityId = useId();
  const moveId = useId();
  const none = props.count === 0;
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-4 py-3"
    >
      <div className="mx-auto flex max-w-[720px] flex-wrap items-center gap-2">
        <span aria-live="polite" className="mr-auto text-sm font-medium tabular-nums">
          {props.count} selected
        </span>

        {props.count < props.total ? (
          <button type="button" className={quiet} onClick={props.onSelectAll}>
            Select all
          </button>
        ) : (
          <button type="button" className={quiet} onClick={props.onClear}>
            Clear selection
          </button>
        )}

        <button type="button" className={`${quiet} text-accent-strong`} disabled={none} onClick={props.onComplete}>
          Complete
        </button>

        <label className="sr-only" htmlFor={priorityId}>
          Set priority
        </label>
        <select
          id={priorityId}
          className={field}
          disabled={none}
          value=""
          onChange={(event) => props.onPriority(Number(event.target.value) as 1 | 2 | 3 | 4)}
        >
          <option value="" disabled>
            Priority
          </option>
          <option value="1">P1 · Highest</option>
          <option value="2">P2 · High</option>
          <option value="3">P3 · Medium</option>
          <option value="4">P4 · None</option>
        </select>

        <label className="sr-only" htmlFor={moveId}>
          Move to project
        </label>
        <select
          id={moveId}
          className={field}
          disabled={none}
          value=""
          onChange={(event) => props.onMove(event.target.value === "inbox" ? null : event.target.value)}
        >
          <option value="" disabled>
            Move to…
          </option>
          <option value="inbox">Inbox</option>
          {props.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <button type="button" className={`${quiet} text-danger`} disabled={none} onClick={props.onDelete}>
          Delete
        </button>
        <button type="button" className={quiet} onClick={props.onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
