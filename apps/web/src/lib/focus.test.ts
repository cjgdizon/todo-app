import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFocus, FOCUS_MS, focusRemaining, readFocus, startFocus, subscribeFocus } from "./focus";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("focus session", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("lasts 25 minutes from the moment it starts", () => {
    const now = Date.parse("2026-10-26T10:00:00Z");
    startFocus("entry-1", now);
    expect(readFocus()).toEqual({ entryId: "entry-1", endsAt: now + FOCUS_MS });
    expect(FOCUS_MS).toBe(25 * 60 * 1000);
  });

  it("counts down only for the timer it was started with", () => {
    const now = Date.parse("2026-10-26T10:00:00Z");
    startFocus("entry-1", now);
    const focus = readFocus();
    expect(focusRemaining(focus, "entry-1", now + 60_000)).toBe(FOCUS_MS - 60_000);
    expect(focusRemaining(focus, "entry-1", now + FOCUS_MS + 5_000)).toBe(-5_000);
    expect(focusRemaining(focus, "another-entry", now)).toBeNull();
    expect(focusRemaining(focus, undefined, now)).toBeNull();
    expect(focusRemaining(null, "entry-1", now)).toBeNull();
  });

  it("can be cleared, and tells subscribers about each change", () => {
    const listener = vi.fn();
    const stop = subscribeFocus(listener);
    startFocus("entry-1", 1);
    clearFocus();
    expect(readFocus()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    startFocus("entry-2", 1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignores stored data that is not a focus session", () => {
    localStorage.setItem("todo-focus", "{not json");
    expect(readFocus()).toBeNull();
    localStorage.setItem("todo-focus", JSON.stringify({ entryId: 5, endsAt: "soon" }));
    expect(readFocus()).toBeNull();
  });

  it("does not throw when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => startFocus("entry-1", 1)).not.toThrow();
    expect(readFocus()).toBeNull();
  });
});
