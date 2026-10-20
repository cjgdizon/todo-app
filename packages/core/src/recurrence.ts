import { RRule, type Options } from "rrule";
import { fromFloating, toFloating, zoned } from "./zoned.ts";

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurrenceError";
  }
}

/**
 * Parses and validates a single RFC 5545 RRULE (with or without the "RRULE:"
 * prefix). Supported: daily, weekly, monthly and yearly rules with INTERVAL,
 * BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS and UNTIL.
 *
 * Rejected: COUNT (each next date is computed from the current one, so a count
 * could never run out; use UNTIL), sub-daily frequencies, and anything that
 * carries its own DTSTART, EXDATE, RDATE or time zone.
 */
function parseRrule(rule: string): Partial<Options> {
  const text = rule.trim();
  if (!text) throw new RecurrenceError("Recurrence rule is empty");
  if (/[\r\n]/.test(text)) {
    throw new RecurrenceError("Only a single RRULE line is supported");
  }
  const body = text.replace(/^RRULE:/i, "");
  if (/(^|;)\s*(DTSTART|TZID|EXDATE|RDATE|EXRULE)\b/i.test(body) || /^(DTSTART|EXDATE|RDATE)/i.test(text)) {
    throw new RecurrenceError("DTSTART, EXDATE, RDATE and TZID are not supported");
  }

  let options: Partial<Options>;
  try {
    options = RRule.parseString(body);
  } catch (error) {
    throw new RecurrenceError(
      `Invalid recurrence rule: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (options.freq === undefined || options.freq === null) {
    throw new RecurrenceError("Recurrence rule needs a valid FREQ");
  }
  if (options.freq > RRule.DAILY) {
    throw new RecurrenceError("Only DAILY, WEEKLY, MONTHLY and YEARLY frequencies are supported");
  }
  if (options.count !== undefined && options.count !== null) {
    throw new RecurrenceError("COUNT is not supported; use UNTIL to end a recurrence");
  }
  return options;
}

/** Throws a RecurrenceError unless `rule` is a supported single RRULE. */
export function validateRrule(rule: string): void {
  parseRrule(rule);
}

/** Builds an rrule `RRule` for a supported rule anchored at a floating start. */
export function buildRule(rule: string, dtstart: Date): RRule {
  return new RRule({ ...parseRrule(rule), dtstart });
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
 * rule has ended (UNTIL passed).
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
  const { rrule, timeZone: zone } = input;
  parseRrule(rrule); // fail fast with a RecurrenceError

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

  const found = buildRule(rrule, dtstart).after(boundary, false);
  return found ? fromFloating(found, zone) : null;
}
