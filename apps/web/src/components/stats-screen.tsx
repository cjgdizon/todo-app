"use client";

import { countByDay, currentStreak, minutesByDay, type DayCount } from "@todo/core";
import { formatMinutes, useData, useTasks, useTimeEntries } from "@todo/data";

const DAYS = 14;
const WEEK = 7;
const card = "rounded-md border border-border bg-surface p-4";

const total = (days: readonly DayCount[]) => days.reduce((sum, day) => sum + day.count, 0);

// Dates are plain calendar days, so they are worded in UTC to keep them from shifting.
const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

function Chart({ title, days, format }: { title: string; days: readonly DayCount[]; format: (count: number) => string }) {
  const max = Math.max(1, ...days.map((day) => day.count));
  return (
    <section aria-label={title} className={card}>
      <h2 className="text-base font-medium">{title}</h2>
      <ol className="mt-3 flex flex-col gap-1">
        {[...days].reverse().map((day) => (
          <li key={day.date} className="flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0 text-text-muted">{dayLabel(day.date)}</span>
            <span aria-hidden="true" className="h-2 flex-1 rounded-sm bg-surface-subtle">
              <span className="block h-2 rounded-sm bg-accent" style={{ width: `${(day.count / max) * 100}%` }} />
            </span>
            <span className="w-16 shrink-0 text-right tabular-nums">{format(day.count)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function StatsScreen() {
  const { timeZone } = useData();
  const tasks = useTasks().data ?? [];
  const entries = useTimeEntries().data ?? [];
  const now = new Date();

  const completed = countByDay(
    tasks.flatMap((task) => (task.completedAt ? [task.completedAt] : [])),
    now,
    timeZone,
    DAYS,
  );
  const tracked = minutesByDay(entries, now, timeZone, DAYS);
  const streak = currentStreak(completed);
  const thisWeek = <T extends DayCount>(days: readonly T[]) => days.slice(-WEEK);

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8">
      <h1 className="text-[20px] leading-7 font-semibold">Stats</h1>
      <p className="mt-1 text-text-muted">Your last two weeks.</p>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        <div className={card}>
          <dt className="text-sm text-text-muted">Streak</dt>
          <dd className="mt-1 text-[20px] font-semibold">{streak === 1 ? "1 day" : `${streak} days`}</dd>
        </div>
        <div className={card}>
          <dt className="text-sm text-text-muted">Done this week</dt>
          <dd className="mt-1 text-[20px] font-semibold">{total(thisWeek(completed))}</dd>
        </div>
        <div className={card}>
          <dt className="text-sm text-text-muted">Tracked this week</dt>
          <dd className="mt-1 text-[20px] font-semibold">{formatMinutes(total(thisWeek(tracked)))}</dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-col gap-6">
        <Chart title="Tasks completed per day" days={completed} format={(count) => String(count)} />
        <Chart title="Time tracked per day" days={tracked} format={formatMinutes} />
      </div>

      <p className="mt-4 text-sm text-text-muted">
        A repeating task counts when you finish it for good, not each time you move it to its next date. Tracked
        time is your own, in this workspace.
      </p>
    </main>
  );
}
