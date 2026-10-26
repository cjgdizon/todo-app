"use client";

import { formatClock, formatMinutes, useStartTimer, useStopTimer, useTimeEntries, type Task } from "@todo/data";
import { clearFocus, startFocus } from "@/lib/focus";
import { useNow } from "@/lib/use-now";
import { useToast } from "./toast";

const MS_PER_MINUTE = 60_000;
const button = "rounded-md px-3 py-2 font-medium";

/** Time tracking for one task: start or stop a timer, or a 25-minute focus session, and the total so far. */
export function TaskTimer({ task }: { task: Task }) {
  const entries = useTimeEntries().data ?? [];
  const start = useStartTimer();
  const stop = useStopTimer();
  const { notify } = useToast();
  const running = entries.find((entry) => entry.endedAt === null);
  const onThisTask = running?.taskId === task.id;
  const now = useNow(onThisTask);

  const trackedMs = entries
    .filter((entry) => entry.taskId === task.id)
    .reduce((total, entry) => total + Math.max(0, (entry.endedAt?.getTime() ?? now) - entry.startedAt.getTime()), 0);

  const onError = () => notify("Couldn't update the timer. Try again.", { tone: "error" });

  function begin(focus: boolean) {
    const id = crypto.randomUUID();
    const at = new Date();
    start.mutate({ id, taskId: task.id, at }, { onError });
    if (focus) startFocus(id, at.getTime());
    else clearFocus();
  }

  function end() {
    if (!running) return;
    stop.mutate({ id: running.id, at: new Date() }, { onError });
    clearFocus();
  }

  return (
    <section aria-label="Time tracking">
      <h3 className="mb-1 text-sm font-medium">Time</h3>
      <p className="text-sm text-text-muted">
        Tracked, last 31 days: {formatMinutes(trackedMs / MS_PER_MINUTE)}
        {onThisTask && running ? (
          <>
            {" · running "}
            <span role="timer">{formatClock(now - running.startedAt.getTime())}</span>
          </>
        ) : null}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {onThisTask ? (
          <button type="button" onClick={end} className={`${button} bg-accent text-on-accent`}>
            Stop timer
          </button>
        ) : (
          <>
            <button type="button" onClick={() => begin(false)} className={`${button} bg-accent text-on-accent`}>
              Start timer
            </button>
            <button type="button" onClick={() => begin(true)} className={`${button} text-accent-strong underline`}>
              Focus 25 minutes
            </button>
          </>
        )}
      </div>
      {running && !onThisTask ? (
        <p className="mt-1 text-sm text-text-muted">Starting here stops the timer that is running on another task.</p>
      ) : null}
    </section>
  );
}
