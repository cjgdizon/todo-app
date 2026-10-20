import { RRule, type Options } from "./rrule-compat.ts";
import { fromFloating, toFloating, zoned } from "./zoned.ts";

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurrenceError";
  }
}

/** Rule parts we evaluate. Anything else (BYHOUR, BYWEEKNO, DTSTART, ...) is rejected. */
const ALLOWED_PARTS = new Set([
  "FREQ",
  "INTERVAL",
  "BYDAY",
  "BYMONTHDAY",
  "BYMONTH",
  "BYSETPOS",
  "UNTIL",
  "WKST",
]);

/**
 * Largest INTERVAL per frequency. Rules are user input that runs on every device
 * and in server jobs, so the range is bounded: a negative interval makes rrule
 * loop forever, and huge ones only burn CPU.
 */
const MAX_INTERVAL = new Map<number, number>([
  [RRule.DAILY, 999],
  [RRule.WEEKLY, 520],
  [RRule.MONTHLY, 120],
  [RRule.YEARLY, 100],
]);

/** How far past the start date an occurrence is looked for. Above the largest interval (100 years). */
const HORIZON_YEARS = 110;

/**
 * rrule only stops early when it produces a date; a rule with no matches (Feb 30)
 * keeps scanning until its hard limit at year 9999, which takes seconds. To bound
 * that, the whole search is shifted into a window that ends near year 9999. The
 * Gregorian calendar repeats exactly every 400 years, so shifting by a multiple
 * of 400 keeps weekdays and leap years identical, and the result is shifted back.
 * Any rule is then scanned for at most about 510 years.
 */
const CALENDAR_CYCLE_YEARS = 400;
const SEARCH_WINDOW_END_YEAR = 9889;

function asList(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? (value as number[]) : [value as number];
}

function invalid(message: string): never {
  throw new RecurrenceError(message);
}

/**
 * Parses and validates a single RFC 5545 RRULE (with or without the "RRULE:"
 * prefix).
 *
 * Supported parts: FREQ (daily, weekly, monthly, yearly), INTERVAL, BYDAY,
 * BYMONTHDAY, BYMONTH, BYSETPOS, UNTIL, WKST. COUNT is rejected on purpose (each
 * next date is computed from the current one, so a count could never run out; use
 * UNTIL). Sub-daily parts, DTSTART, EXDATE, RDATE and time zones are rejected too.
 */
function parseRrule(rule: string): Partial<Options> {
  const text = rule.trim();
  if (!text) invalid("Recurrence rule is empty");
  if (/[\r\n]/.test(text)) invalid("Only a single RRULE line is supported");

  const body = text.replace(/^RRULE:/i, "");
  const seen = new Set<string>();
  for (const part of body.split(";")) {
    if (!part) continue;
    const key = (part.split("=")[0] ?? "").trim().toUpperCase();
    if (key === "COUNT") invalid("COUNT is not supported; use UNTIL to end a recurrence");
    if (!ALLOWED_PARTS.has(key)) invalid(`Unsupported recurrence rule part "${key.slice(0, 24)}"`);
    if (seen.has(key)) invalid(`Recurrence rule part ${key} appears more than once`);
    seen.add(key);
  }

  let options: Partial<Options>;
  try {
    options = RRule.parseString(body);
  } catch (error) {
    return invalid(
      `Invalid recurrence rule: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const freq = options.freq;
  const maxInterval = freq === undefined || freq === null ? undefined : MAX_INTERVAL.get(freq);
  if (maxInterval === undefined) {
    invalid("Recurrence rule needs a FREQ of DAILY, WEEKLY, MONTHLY or YEARLY");
  }
  const interval = options.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > maxInterval) {
    invalid(`INTERVAL must be a whole number from 1 to ${maxInterval} for this frequency`);
  }
  for (const day of asList(options.bymonthday)) {
    if (!Number.isInteger(day) || day === 0 || day < -31 || day > 31) {
      invalid("BYMONTHDAY must be 1 to 31 or -31 to -1");
    }
  }
  for (const month of asList(options.bymonth)) {
    if (!Number.isInteger(month) || month < 1 || month > 12) invalid("BYMONTH must be 1 to 12");
  }
  for (const position of asList(options.bysetpos)) {
    if (!Number.isInteger(position) || position === 0 || position < -366 || position > 366) {
      invalid("BYSETPOS must be 1 to 366 or -366 to -1");
    }
  }
  if (options.until && Number.isNaN(options.until.getTime())) invalid("UNTIL is not a valid date");

  return options;
}

/** Throws a RecurrenceError unless `rule` is a supported single RRULE. */
export function validateRrule(rule: string): void {
  parseRrule(rule);
}

/** True when `rule` is a supported single RRULE. */
export function isValidRrule(rule: string): boolean {
  try {
    parseRrule(rule);
    return true;
  } catch (error) {
    if (error instanceof RecurrenceError) return false;
    throw error;
  }
}

function shiftYears(date: Date, years: number): Date {
  const shifted = new Date(date);
  shifted.setUTCFullYear(shifted.getUTCFullYear() + years);
  return shifted;
}

/**
 * The first occurrence of `rule` after `after` (or at it, when `inclusive`),
 * for a rule anchored at the floating start `dtstart`. Returns null when there is
 * none within HORIZON_YEARS of the start, or before UNTIL. Dates are floating
 * (UTC fields are local wall-clock time; see zoned.ts). The work is bounded for
 * every valid rule, including ones that never match.
 */
export function nextOccurrence(
  rule: string,
  dtstart: Date,
  after: Date,
  inclusive: boolean,
): Date | null {
  const options = parseRrule(rule);

  const cycles = Math.floor(
    (SEARCH_WINDOW_END_YEAR - dtstart.getUTCFullYear()) / CALENDAR_CYCLE_YEARS,
  );
  const shift = cycles * CALENDAR_CYCLE_YEARS;
  const start = shiftYears(dtstart, shift);
  const horizon = shiftYears(start, HORIZON_YEARS);
  const until = options.until ? shiftYears(options.until, shift) : horizon;

  let found: Date | null;
  try {
    found = new RRule({ ...options, dtstart: start, until: until < horizon ? until : horizon }).after(
      shiftYears(after, shift),
      inclusive,
    );
  } catch (error) {
    return invalid(
      `Invalid recurrence rule: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return found ? shiftYears(found, -shift) : null;
}

export interface NextDueInput {
  rrule: string;
  /** The due date of the occurrence being completed. */
  dueAt: Date;
  completedAt: Date;
  /** IANA zone the schedule is evaluated in, e.g. "America/New_York". */
  timeZone: string;
  /** "Every 3 days after completion" instead of a fixed calendar schedule. */
  afterCompletion: boolean;
}

/**
 * The next due instant after completing a recurring task, or null when the
 * rule has ended (UNTIL passed, or no occurrence within the search horizon).
 *
 * - Fixed schedule: the first occurrence strictly after both the due date and
 *   the completion time, so occurrences missed while the task sat overdue are
 *   skipped.
 * - After completion: the rule is anchored on the completion day (keeping the
 *   original time of day), so "every 3 days" means three days from completion.
 *
 * The rule runs on local wall-clock time, so 09:00 stays 09:00 across DST.
 * A wall-clock time that does not exist (spring-forward gap) moves forward.
 */
export function nextDue(input: NextDueInput): Date | null {
  const zone = input.timeZone;
  const due = zoned(input.dueAt, zone);
  const done = zoned(input.completedAt, zone);

  let dtstart: Date;
  let boundary: Date;
  if (input.afterCompletion) {
    const anchor = done.set({
      hour: due.hour,
      minute: due.minute,
      second: due.second,
      millisecond: 0,
    });
    dtstart = toFloating(anchor);
    boundary = dtstart;
  } else {
    dtstart = toFloating(due);
    boundary = toFloating(done > due ? done : due);
  }

  const found = nextOccurrence(input.rrule, dtstart, boundary, false);
  return found ? fromFloating(found, zone) : null;
}
