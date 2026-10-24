import { instantToLocal, localToInstant, zoned } from "./zoned.ts";

export interface SnoozeTarget {
  dueAt: Date;
  dueAllDay: boolean;
  dueTz: string;
}

/**
 * Where "snooze" puts a task: tomorrow (relative to `now`, in `zone`), at the task's usual time
 * of day, or all day when it has no time. An overdue task comes forward to tomorrow rather than
 * moving a day from its old date.
 */
export function snoozeTarget(
  task: { dueAt: Date | null; dueAllDay: boolean },
  now: Date,
  zone: string,
): SnoozeTarget {
  const tomorrow = zoned(now, zone).plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const timed = task.dueAt !== null && !task.dueAllDay;
  const time = timed && task.dueAt ? instantToLocal(task.dueAt, zone).time : null;
  const dueAt = localToInstant(tomorrow, time, zone);
  if (!dueAt) throw new RangeError(`Cannot snooze to ${tomorrow} in ${zone}`);
  return { dueAt, dueAllDay: !timed, dueTz: zone };
}
