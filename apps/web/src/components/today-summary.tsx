"use client";

import type { ViewContext } from "@todo/core";
import { instantToLocal } from "@todo/core";
import { nextUpTask, todayProgress, type Task } from "@todo/data";
import { CheckIcon, FlagIcon } from "./icons";

/** Progress line and the Next up card at the top of the Today screen. */
export function TodaySummary({
  tasks,
  ctx,
  projectName,
  onComplete,
}: {
  tasks: readonly Task[];
  ctx: ViewContext;
  projectName: (task: Task) => string | null;
  onComplete: (task: Task) => void;
}) {
  const { done, total } = todayProgress(tasks, ctx);
  if (total === 0) return null;

  const next = nextUpTask(tasks, ctx);
  const finished = done === total;
  const label = `${done} of ${total} done`;

  return (
    <div className="mb-6">
      <p className="mb-2 text-sm text-text-muted">{label}</p>
      <div
        role="progressbar"
        aria-label="Tasks done today"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="mb-4 h-0.5 rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-[180ms] ease-[var(--ease-enter)]"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>

      {finished ? (
        <p className="font-serif text-[30px] leading-9 font-light text-text-muted" role="status">
          Nothing left today
        </p>
      ) : next ? (
        <section aria-label="Next up" className="glass grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-[20px] p-5">
          <p className="text-sm text-text-muted">Next up</p>
          <button
            type="button"
            role="checkbox"
            aria-checked={false}
            aria-label={`Complete next up: ${next.title}`}
            onClick={() => onComplete(next)}
            className="row-span-2 flex size-6 items-center justify-center self-start rounded-full border-2 border-accent text-transparent hover:text-text-muted"
          >
            <CheckIcon width={14} height={14} />
          </button>
          <p className="font-serif text-5xl leading-none font-light text-accent-strong tabular-nums">
            {next.dueAt ? instantToLocal(next.dueAt, ctx.timeZone).time : ""}
          </p>
          <p className="col-span-2 mt-2 font-serif text-[21px] leading-[26px]">{next.title}</p>
          <p className="col-span-2 flex items-center gap-3 text-sm text-text-muted">
            {next.priority !== 4 && (
              <span className="inline-flex items-center gap-1">
                <FlagIcon width={14} height={14} />P{next.priority}
              </span>
            )}
            {projectName(next) && <span>{projectName(next)}</span>}
          </p>
        </section>
      ) : null}
    </div>
  );
}
