import { dueBucket, type ViewContext } from "@todo/core";

/** Local calendar day as `YYYY-MM-DD` in `timeZone`. */
function localDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** "9:00 AM". Newer ICU versions put a narrow no-break space before AM/PM; use a normal one. */
function clock(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
    .format(date)
    .replace(/\u202f/g, " ");
}

export interface DueLabel {
  label: string;
  overdue: boolean;
}

/** A short, human due date such as "Tomorrow, 9:00 AM" or "Fri, Oct 23", in the viewer's zone. */
export function formatDue(
  task: { dueAt: Date; dueAllDay: boolean },
  ctx: ViewContext,
): DueLabel {
  const today = localDay(ctx.now, ctx.timeZone);
  const day = localDay(task.dueAt, ctx.timeZone);

  let label: string;
  if (day === today) label = "Today";
  else if (day === shiftDay(today, 1)) label = "Tomorrow";
  else if (day === shiftDay(today, -1)) label = "Yesterday";
  else if (day.slice(0, 4) === today.slice(0, 4)) {
    label = new Intl.DateTimeFormat("en-US", {
      timeZone: ctx.timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(task.dueAt);
  } else {
    label = new Intl.DateTimeFormat("en-US", {
      timeZone: ctx.timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(task.dueAt);
  }

  if (!task.dueAllDay) label += `, ${clock(task.dueAt, ctx.timeZone)}`;
  return { label, overdue: dueBucket(task, ctx) === "overdue" };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A running clock: `m:ss`, or `h:mm:ss` from an hour on. Negative time shows as zero. */
export function formatClock(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Tracked time in words: `5m`, `1h`, `1h 20m`. */
export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
