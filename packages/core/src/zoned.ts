import { DateTime } from "luxon";

/**
 * Date libraries such as rrule and chrono-node work on plain `Date`s without
 * real time-zone support. The "floating" trick: shift an instant so its UTC
 * fields equal the wall-clock fields in the user's zone, run the library in that
 * shifted space, then convert back. Luxon does the conversion back, so DST gaps
 * (non-existent times move forward) and repeated hours are handled in one place.
 */

/** The instant as a luxon DateTime in `zone`. Throws if the zone is unknown. */
export function zoned(date: Date, zone: string): DateTime {
  const dt = DateTime.fromJSDate(date, { zone });
  if (!dt.isValid) throw new RangeError(`Invalid time zone or date: ${zone}`);
  return dt;
}

/** A Date whose UTC fields are the wall-clock fields of `dt` (to the second). */
export function toFloating(dt: DateTime): Date {
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second));
}

/** The real instant for a floating Date, interpreting its UTC fields as local time in `zone`. */
export function fromFloating(floating: Date, zone: string): Date {
  const dt = DateTime.fromObject(
    {
      year: floating.getUTCFullYear(),
      month: floating.getUTCMonth() + 1,
      day: floating.getUTCDate(),
      hour: floating.getUTCHours(),
      minute: floating.getUTCMinutes(),
      second: floating.getUTCSeconds(),
    },
    { zone },
  );
  if (!dt.isValid) throw new RangeError(`Invalid time zone or date: ${zone}`);
  return dt.toJSDate();
}

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const TIME_TEXT = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The instant for a local calendar date (`YYYY-MM-DD`) and optional time (`HH:mm`)
 * in `zone`; without a time it is the start of that day. A time that does not exist
 * (spring-forward gap) moves forward. Returns null for text that is not a real
 * date/time or for an unknown zone.
 */
export function localToInstant(date: string, time: string | null, zone: string): Date | null {
  if (!DATE_TEXT.test(date) || (time !== null && !TIME_TEXT.test(time))) return null;
  const dt = DateTime.fromISO(`${date}T${time ?? "00:00"}`, { zone });
  return dt.isValid ? dt.toJSDate() : null;
}

/** The wall-clock date (`YYYY-MM-DD`) and time (`HH:mm`) of an instant in `zone`. */
export function instantToLocal(instant: Date, zone: string): { date: string; time: string } {
  const dt = zoned(instant, zone);
  return { date: dt.toFormat("yyyy-MM-dd"), time: dt.toFormat("HH:mm") };
}
