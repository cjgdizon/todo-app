import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * Manual ordering with fractional indexing: each item stores a string key, and
 * moving an item only rewrites that item's key. Keys compare correctly with
 * plain string comparison, which matches Postgres `COLLATE "C"` on the
 * `position` columns.
 */

/** Neighbours must be in order; the library would otherwise return a key that breaks the list. */
function assertOrdered(before: string | null, after: string | null): void {
  if (before !== null && after !== null && before >= after) {
    throw new RangeError("`before` must sort strictly before `after`");
  }
}

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const JITTER_LENGTH = 4;
const JITTER_ATTEMPTS = 8;

/** A few random base-62 digits. A key may not end in "0", so the last digit is never "0". */
function jitter(random: () => number): string {
  const pick = (alphabet: string) =>
    alphabet.charAt(Math.min(Math.floor(random() * alphabet.length), alphabet.length - 1));
  let suffix = "";
  for (let i = 0; i < JITTER_LENGTH - 1; i++) suffix += pick(DIGITS);
  return suffix + pick(DIGITS.slice(1));
}

/**
 * A key strictly between `before` and `after` (either may be null for "no neighbour").
 *
 * Keys from the library are deterministic, so two offline clients inserting
 * between the same neighbours would get the same key. A random suffix makes that
 * collision very unlikely. A suffixed key is used only if it still sorts strictly
 * between the neighbours; a suffix can overshoot the upper neighbour (about half
 * the time when the plain key is a prefix of it), so a few suffixes are tried
 * before falling back to the plain key. Always list with `order by position, id`,
 * so a remaining tie is still stable. If a list ever has equal neighbours,
 * rebalance it with `positionsBetween(null, null, n)`.
 */
export function positionBetween(
  before: string | null,
  after: string | null,
  random: () => number = Math.random,
): string {
  assertOrdered(before, after);
  const key = generateKeyBetween(before, after);
  for (let attempt = 0; attempt < JITTER_ATTEMPTS; attempt++) {
    const candidate = key + jitter(random);
    if ((before === null || candidate > before) && (after === null || candidate < after)) {
      return candidate;
    }
  }
  return key;
}

/** `count` increasing keys strictly between `before` and `after`. */
export function positionsBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError("count must be a non-negative integer");
  }
  assertOrdered(before, after);
  return generateNKeysBetween(before, after, count);
}
