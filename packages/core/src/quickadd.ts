import { parse as chronoParse } from "chrono-node";
import type { Priority } from "./task.ts";
import { isValidRrule, nextOccurrence } from "./recurrence.ts";
import { fromFloating, toFloating, zoned } from "./zoned.ts";

/**
 * Natural-language quick add: "Pay rent every 1st at 9am #home p2 @bills".
 *
 *   p1..p4 (standalone)   priority          #name   project          @name   label
 *   every day|week|month|year, every N units, every weekday, every mon[, wed and fri],
 *   every 1st, daily|weekly|monthly|yearly   recurrence (`every!` = after completion)
 *   tomorrow, friday, "at 5pm", ...          due date/time (chrono-node)
 *
 * With a recurrence, a day-level date in the text ("friday", "starting tomorrow",
 * "on april 15") is where the series starts; without one it starts today. The first
 * due date is the first occurrence on or after that start and now (all-day when no
 * time is given).
 * Tokens must stand alone ("example.com/#x" and "xp1" are plain text).
 */

export interface QuickAddContext {
  now: Date;
  timeZone: string;
}

export interface QuickAddResult {
  /** What is left after extracting everything else; may be empty. */
  title: string;
  priority: Priority | null;
  project: string | null;
  labels: string[];
  due: { at: Date; allDay: boolean } | null;
  rrule: string | null;
  recurAfterCompletion: boolean;
}

const DAY_NAME =
  "mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?";
const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const UNIT_FREQ: Record<string, string> = {
  day: "DAILY",
  week: "WEEKLY",
  month: "MONTHLY",
  year: "YEARLY",
};
const SHORTHAND_FREQ: Record<string, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
  annually: "YEARLY",
};

// A time may sit inside a weekday list ("every monday at 9am and friday"); it is
// handed back to the date parser instead of being swallowed with the list.
const AT_TIME = "at\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?";
const LIST_ITEM = `(?:${DAY_NAME})(?:\\s+${AT_TIME})?`;
const WEEKDAY_LIST = new RegExp(
  `\\bevery(!)?\\s+(${LIST_ITEM}(?:\\s*(?:,\\s*and|,|and|&)\\s*${LIST_ITEM})*)\\b`,
  "i",
);
const WEEKDAYS_ONLY = /\bevery(!)?\s+(?:weekday|workday)s?\b/i;
const NTH_OF_MONTH = /\bevery(!)?\s+(?:month\s+on\s+the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i;
// "starting tomorrow", "from monday", "on april 15": connector words left in front of a start date.
const START_CONNECTOR = /\s*\b(?:(?:starting|beginning|starts?|begins?)(?:\s+(?:on|from))?|on|from)\s*$/i;
const DAY_LEVEL_PARTS = ["day", "weekday", "month"] as const;
const EVERY_UNIT = /\bevery(!)?\s+(?:(\d+)\s+)?(day|week|month|year)s?\b/i;
const SHORTHAND = /\b(daily|weekly|monthly|yearly|annually)\b/i;

interface RecurrenceMatch {
  rrule: string;
  afterCompletion: boolean;
  start: number;
  end: number;
  /** Text inside the match that still belongs to the date parser (e.g. "at 9am"). */
  keep: string;
}

function findRecurrence(text: string): RecurrenceMatch | null {
  const at = (m: RegExpExecArray, rrule: string, bang?: string, keep = ""): RecurrenceMatch => ({
    rrule,
    afterCompletion: bang === "!",
    start: m.index,
    end: m.index + m[0].length,
    keep,
  });

  let m = WEEKDAY_LIST.exec(text);
  if (m?.[2]) {
    const days = new Set<string>();
    for (const day of m[2].matchAll(new RegExp(DAY_NAME, "gi"))) {
      const code = DAY_CODES.find((c) => c.toLowerCase() === day[0].slice(0, 2).toLowerCase());
      if (code) days.add(code);
    }
    const ordered = DAY_CODES.filter((c) => days.has(c));
    const times = [...m[2].matchAll(new RegExp(AT_TIME, "gi"))].map((t) => t[0]);
    return at(m, `FREQ=WEEKLY;BYDAY=${ordered.join(",")}`, m[1], times.join(" "));
  }

  m = WEEKDAYS_ONLY.exec(text);
  if (m) return at(m, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", m[1]);

  m = NTH_OF_MONTH.exec(text);
  if (m?.[2]) {
    const n = Number(m[2]);
    if (n >= 1 && n <= 31) return at(m, `FREQ=MONTHLY;BYMONTHDAY=${n}`, m[1]);
  }

  m = EVERY_UNIT.exec(text);
  if (m?.[3]) {
    const interval = m[2] === undefined ? 1 : Number(m[2]);
    const freq = UNIT_FREQ[m[3].toLowerCase()];
    if (freq && interval >= 1) {
      return at(m, interval === 1 ? `FREQ=${freq}` : `FREQ=${freq};INTERVAL=${interval}`, m[1]);
    }
  }

  m = SHORTHAND.exec(text);
  const shorthand = m?.[1] ? SHORTHAND_FREQ[m[1].toLowerCase()] : undefined;
  if (m && shorthand) return at(m, `FREQ=${shorthand}`);

  return null;
}

function cut(text: string, start: number, end: number, keep = ""): string {
  return `${text.slice(0, start)} ${keep} ${text.slice(end)}`;
}

function cleanName(raw: string): string {
  return raw.replace(/[.,;:!?]+$/, "");
}

export function parseQuickAdd(input: string, ctx: QuickAddContext): QuickAddResult {
  let text = input;

  // Standalone tokens: priority, #project, @labels.
  let priority: Priority | null = null;
  text = text.replace(/(?<=^|\s)p([1-4])(?=\s|$)/gi, (_m, digit: string) => {
    priority ??= Number(digit) as Priority;
    return " ";
  });

  let project: string | null = null;
  text = text.replace(/(?<=^|\s)#([^\s#@]+)/g, (_m, name: string) => {
    project ??= cleanName(name);
    return " ";
  });

  const labels: string[] = [];
  text = text.replace(/(?<=^|\s)@([^\s#@]+)/g, (_m, name: string) => {
    const label = cleanName(name);
    if (label && !labels.includes(label)) labels.push(label);
    return " ";
  });

  // Recurrence first, so weekday words are not read as one-off dates.
  // A phrase that builds an unsupported rule (e.g. "every 5000 days") stays plain text.
  const candidate = findRecurrence(text);
  const recurrence = candidate && isValidRrule(candidate.rrule) ? candidate : null;
  if (recurrence) text = cut(text, recurrence.start, recurrence.end, recurrence.keep);

  // Dates run in floating local time (see zoned.ts), so DST is handled by luxon.
  const nowLocal = zoned(ctx.now, ctx.timeZone);
  const chronoRef = { instant: toFloating(nowLocal), timezone: 0 };
  const found = chronoParse(text, chronoRef, { forwardDate: true })[0];
  let hasTime = false;
  let hour = 0;
  let minute = 0;
  let dateFloating: Date | null = null;
  // With a recurrence, a day-level date ("friday", "starting tomorrow") is where the series starts.
  let startsOnDate = false;
  if (found) {
    startsOnDate = recurrence !== null && DAY_LEVEL_PARTS.some((part) => found.start.isCertain(part));
    const before = startsOnDate
      ? text.slice(0, found.index).replace(START_CONNECTOR, "")
      : text.slice(0, found.index);
    text = `${before} ${text.slice(found.index + found.text.length)}`;
    hasTime = found.start.isCertain("hour");
    if (hasTime) {
      hour = found.start.get("hour") ?? 0;
      minute = found.start.get("minute") ?? 0;
    }
    dateFloating = found.start.date();
  }

  let due: QuickAddResult["due"] = null;
  if (recurrence) {
    const startOfToday = nowLocal.startOf("day");
    const dtstart = new Date(startsOnDate && dateFloating ? dateFloating : toFloating(startOfToday));
    dtstart.setUTCHours(hour, minute, 0, 0);
    const boundary = toFloating(hasTime ? nowLocal : startOfToday);
    const first = nextOccurrence(recurrence.rrule, dtstart, boundary, true);
    if (first) due = { at: fromFloating(first, ctx.timeZone), allDay: !hasTime };
  } else if (dateFloating) {
    const at = fromFloating(dateFloating, ctx.timeZone);
    due = hasTime
      ? { at, allDay: false }
      : { at: zoned(at, ctx.timeZone).startOf("day").toJSDate(), allDay: true };
  }

  return {
    title: text.replace(/\s+/g, " ").trim(),
    priority,
    project,
    labels,
    due,
    rrule: recurrence?.rrule ?? null,
    recurAfterCompletion: recurrence?.afterCompletion ?? false,
  };
}
