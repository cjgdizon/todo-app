import { DateTime } from "luxon";
import { instantToLocal, localToInstant } from "./zoned.ts";

/**
 * Date arithmetic behind the calendar view. Days are plain calendar dates
 * (`YYYY-MM-DD`); tasks are placed on a day in the viewer's time zone.
 */

const DAY_FORMAT = "yyyy-MM-dd";

/**
 * The weeks to draw for a month (`month` is 1-12): Monday-first rows of seven days, padded
 * with the neighbouring months' days so every row is full. Four to six rows.
 */
export function monthGrid(year: number, month: number): string[][] {
  const first = DateTime.utc(year, month, 1);
  const last = first.endOf("month");
  let day = first.minus({ days: first.weekday - 1 });

  const weeks: string[][] = [];
  while (day <= last) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day.toFormat(DAY_FORMAT));
      day = day.plus({ days: 1 });
    }
    weeks.push(week);
  }
  return weeks;
}

/** The month `delta` months from the given one (`month` is 1-12), rolling over years. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const shifted = DateTime.utc(year, month, 1).plus({ months: delta });
  return { year: shifted.year, month: shifted.month };
}

/** Tasks by the local day they are due in `timeZone`, in input order. Tasks without a due date are left out. */
export function groupTasksByDay<T extends { dueAt: Date | null }>(
  tasks: readonly T[],
  timeZone: string,
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.dueAt) continue;
    const { date } = instantToLocal(task.dueAt, timeZone);
    const group = byDay.get(date) ?? [];
    group.push(task);
    byDay.set(date, group);
  }
  return byDay;
}

/**
 * The new due instant when a task is dropped on another day: the same local time of day
 * (all-day tasks stay all-day), so 09:00 stays 09:00 across a daylight-saving change.
 * Returns null if `day` is not a real `YYYY-MM-DD` date.
 */
export function rescheduleToDay(
  due: { dueAt: Date; dueAllDay: boolean },
  day: string,
  timeZone: string,
): Date | null {
  const { time } = instantToLocal(due.dueAt, timeZone);
  return localToInstant(day, due.dueAllDay ? null : time, timeZone);
}
