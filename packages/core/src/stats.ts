import type { DateTime } from "luxon";
import { zoned } from "./zoned.ts";

/** A local calendar day (`YYYY-MM-DD`) and a number for it: tasks completed, or minutes tracked. */
export interface DayCount {
  date: string;
  count: number;
}

const DAY_FORMAT = "yyyy-MM-dd";
const MS_PER_MINUTE = 60_000;

/** Midnight at the start of each of the last `days` days, today last, in `zone`. */
function dayStarts(now: Date, zone: string, days: number): DateTime[] {
  if (!Number.isInteger(days) || days < 1) throw new RangeError("days must be at least 1");
  const today = zoned(now, zone).startOf("day");
  return Array.from({ length: days }, (_, index) => today.minus({ days: days - 1 - index }));
}

/** The local dates of the last `days` days, oldest first, ending with today. */
export function lastDays(now: Date, zone: string, days: number): string[] {
  return dayStarts(now, zone, days).map((start) => start.toFormat(DAY_FORMAT));
}

/** How many of `instants` fall on each of the last `days` local days. Others are ignored. */
export function countByDay(instants: readonly Date[], now: Date, zone: string, days: number): DayCount[] {
  const dates = lastDays(now, zone, days);
  const counts = new Map(dates.map((date) => [date, 0]));
  for (const instant of instants) {
    const date = zoned(instant, zone).toFormat(DAY_FORMAT);
    const count = counts.get(date);
    if (count !== undefined) counts.set(date, count + 1);
  }
  return dates.map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

/**
 * Minutes of tracked time on each of the last `days` local days. Time past midnight counts toward
 * the day it happened on, and a timer still running counts up to `now`.
 */
export function minutesByDay(
  entries: readonly { startedAt: Date; endedAt: Date | null }[],
  now: Date,
  zone: string,
  days: number,
): DayCount[] {
  return dayStarts(now, zone, days).map((start) => {
    const from = start.toMillis();
    const to = start.plus({ days: 1 }).toMillis();
    let milliseconds = 0;
    for (const entry of entries) {
      const overlapStart = Math.max(entry.startedAt.getTime(), from);
      const overlapEnd = Math.min((entry.endedAt ?? now).getTime(), to);
      if (overlapEnd > overlapStart) milliseconds += overlapEnd - overlapStart;
    }
    return { date: start.toFormat(DAY_FORMAT), count: Math.round(milliseconds / MS_PER_MINUTE) };
  });
}

/**
 * Consecutive days with something done, ending today. A day still empty today does not break the
 * streak (there is time left), so it then counts back from yesterday.
 */
export function currentStreak(days: readonly DayCount[]): number {
  let index = days.length - 1;
  if (index >= 0 && days[index]?.count === 0) index -= 1;
  let streak = 0;
  while (index >= 0 && (days[index]?.count ?? 0) > 0) {
    streak += 1;
    index -= 1;
  }
  return streak;
}
