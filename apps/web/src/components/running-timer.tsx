"use client";

import { formatClock, useRunningTimer, useStopTimer, useTasks } from "@todo/data";
import { useEffect, useRef } from "react";
import { clearFocus, focusRemaining, useFocus } from "@/lib/focus";
import { useNow } from "@/lib/use-now";
import { useTaskSelection } from "@/lib/use-task-selection";
import { useToast } from "./toast";

/** Shows the running timer on every page, counts a focus session down and ends it when time is up. */
export function RunningTimer() {
  const running = useRunningTimer();
  const task = useTasks().data?.find((item) => item.id === running?.taskId);
  const stop = useStopTimer();
  const focus = useFocus();
  const selection = useTaskSelection();
  const { notify } = useToast();
  const now = useNow(Boolean(running));
  const endedEntry = useRef<string | null>(null);

  const remaining = focusRemaining(focus, running?.id, now);
  const finished = running !== undefined && focus !== null && remaining !== null && remaining <= 0;

  useEffect(() => {
    if (!finished || !running || !focus || endedEntry.current === running.id) return;
    endedEntry.current = running.id;
    // End at the planned time, not at "now": the page may have been closed when it was due.
    stop.mutate({ id: running.id, at: new Date(focus.endsAt) });
    clearFocus();
    notify("Focus session done. Take a 5-minute break.");
  }, [finished, running, focus, stop, notify]);

  if (!running) return null;
  const title = task?.title ?? "a task";
  return (
    <div
      role="region"
      aria-label="Running timer"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-accent-subtle px-4 py-2 text-sm"
    >
      <span className="font-medium">{remaining !== null ? "Focus" : "Timing"}</span>
      <span role="timer" className="tabular-nums">
        {remaining !== null ? `${formatClock(remaining)} left` : formatClock(now - running.startedAt.getTime())}
      </span>
      {task ? (
        <button type="button" onClick={() => selection.open(task.id)} className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline">
          {title}
        </button>
      ) : (
        <span className="flex-1">{title}</span>
      )}
      <button
        type="button"
        onClick={() => {
          stop.mutate({ id: running.id, at: new Date() });
          clearFocus();
        }}
        className="rounded-sm px-2 py-1 font-medium text-accent-strong underline"
      >
        Stop
      </button>
    </div>
  );
}
