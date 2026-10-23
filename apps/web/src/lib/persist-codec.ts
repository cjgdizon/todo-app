/**
 * How the query cache is written to IndexedDB. The lists hold `Date` objects (due and completion
 * times) and plain JSON would hand them back as strings, which the date code cannot use, so dates
 * are tagged on the way out and rebuilt on the way in.
 */

const TAG = "__date";

export function serializeCache(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key: string, converted: unknown) {
    // JSON has already turned a Date into a string by now; the original is still on the holder.
    const original = this[key];
    if (original instanceof Date) {
      return Number.isNaN(original.getTime()) ? null : { [TAG]: original.toISOString() };
    }
    return converted;
  });
}

export function deserializeCache(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown) => {
    if (value && typeof value === "object" && typeof (value as Record<string, unknown>)[TAG] === "string") {
      return new Date((value as Record<string, string>)[TAG]!);
    }
    return value;
  });
}
