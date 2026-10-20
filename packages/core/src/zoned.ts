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
