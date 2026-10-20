import { describe, expect, it } from "vitest";
import { positionBetween, positionsBetween } from "./ordering";

describe("positionBetween", () => {
  it("creates a first key for an empty list", () => {
    const key = positionBetween(null, null);
    expect(key.length).toBeGreaterThan(0);
  });

  it("sorts after the last key and before the first key", () => {
    const first = positionBetween(null, null);
    const after = positionBetween(first, null);
    const before = positionBetween(null, first);
    expect(after > first).toBe(true);
    expect(before < first).toBe(true);
  });

  it("stays strictly between neighbours across many inserts at the same spot", () => {
    const a = positionBetween(null, null);
    let b = positionBetween(a, null);
    for (let i = 0; i < 200; i++) {
      const mid = positionBetween(a, b);
      expect(a < mid && mid < b).toBe(true);
      b = mid;
    }
  });

  it("rejects keys that are equal or out of order", () => {
    const a = positionBetween(null, null);
    const b = positionBetween(a, null);
    expect(() => positionBetween(a, a)).toThrow();
    expect(() => positionBetween(b, a)).toThrow();
  });

  it("matches plain string comparison (Postgres COLLATE \"C\") after random inserts", () => {
    // Deterministic pseudo-random sequence so failures are reproducible.
    let seed = 42;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed;
    };
    const rand = (max: number) => next() % max;
    const unit = () => next() / 4294967296;
    const list: string[] = [];
    for (let i = 0; i <= 300; i++) {
      const at = rand(list.length + 1);
      list.splice(at, 0, positionBetween(list[at - 1] ?? null, list[at] ?? null, unit));
    }
    expect([...list].sort()).toEqual(list);
    expect(new Set(list).size).toBe(list.length);
  });
});

describe("positionBetween jitter (offline collisions)", () => {
  // A scripted random source: yields the given values in a cycle.
  const scripted = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length] ?? 0;
  };

  it("gives two clients inserting at the same spot different keys", () => {
    const a = positionBetween(null, null, () => 0.5);
    const b = positionBetween(a, null, () => 0.5);
    const one = positionBetween(a, b, scripted(0.1, 0.2, 0.3, 0.4));
    const two = positionBetween(a, b, scripted(0.2, 0.1, 0.4, 0.3));
    expect(one).not.toBe(two);
    for (const key of [one, two]) expect(a < key && key < b).toBe(true);
  });

  it("retries a suffix that would overshoot the upper neighbour instead of colliding", () => {
    const a = positionBetween(null, null, () => 0.5);
    const b = positionBetween(a, null, () => 0.5); // "a1" + a suffix of V's
    // The first suffix (starts at 'h' > 'V') overshoots b; the second one fits.
    const key = positionBetween(a, b, scripted(0.7, 0.8, 0.9, 0.6, 0.1, 0.2, 0.3, 0.4));
    expect(a < key && key < b).toBe(true);
    expect(key.length).toBeGreaterThan(2); // a jittered key, not the bare "a1"
  });

  it("stays strictly between neighbours and never ends in zero, even at the extremes", () => {
    const first = positionBetween(null, null, () => 0.5);
    const second = positionBetween(first, null, () => 0.5);
    for (const random of [() => 0, () => 0.999999, scripted(0, 0.999999)]) {
      const key = positionBetween(first, second, random);
      expect(first < key && key < second).toBe(true);
      expect(key.endsWith("0")).toBe(false);
      // A jittered key is still a valid neighbour for later inserts.
      expect(() => positionBetween(first, key, () => 0.5)).not.toThrow();
      expect(() => positionBetween(key, second, () => 0.5)).not.toThrow();
    }
  });

  it("spreads appends at the end too", () => {
    const last = positionBetween(null, null, () => 0.5);
    const a = positionBetween(last, null, scripted(0.1, 0.2, 0.3, 0.4));
    const b = positionBetween(last, null, scripted(0.6, 0.7, 0.8, 0.9));
    expect(a).not.toBe(b);
    expect(a > last && b > last).toBe(true);
  });
});

describe("positionsBetween", () => {
  it("returns n increasing keys inside the bounds", () => {
    const lo = positionBetween(null, null);
    const hi = positionBetween(lo, null);
    const keys = positionsBetween(lo, hi, 5);
    expect(keys).toHaveLength(5);
    expect([...keys].sort()).toEqual(keys);
    expect(keys.every((k) => k > lo && k < hi)).toBe(true);
  });

  it("returns an empty list for n = 0", () => {
    expect(positionsBetween(null, null, 0)).toEqual([]);
  });

  it("rejects a negative or non-integer count", () => {
    expect(() => positionsBetween(null, null, -1)).toThrow();
    expect(() => positionsBetween(null, null, 1.5)).toThrow();
  });
});
