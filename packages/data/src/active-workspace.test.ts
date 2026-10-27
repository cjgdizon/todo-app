import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readActiveWorkspace, setActiveWorkspace, subscribeActiveWorkspace } from "./active-workspace.ts";

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

describe("active workspace", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("remembers the choice per user", () => {
    setActiveWorkspace("u1", "w1");
    setActiveWorkspace("u2", "w2");
    expect(readActiveWorkspace("u1")).toBe("w1");
    expect(readActiveWorkspace("u2")).toBe("w2");
    expect(readActiveWorkspace("u3")).toBeNull();
  });

  it("forgets the choice when set to null", () => {
    setActiveWorkspace("u1", "w1");
    setActiveWorkspace("u1", null);
    expect(readActiveWorkspace("u1")).toBeNull();
  });

  it("tells subscribers when the choice changes", () => {
    const listener = vi.fn();
    const stop = subscribeActiveWorkspace(listener);
    setActiveWorkspace("u1", "w1");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    setActiveWorkspace("u1", "w2");
    expect(listener).toHaveBeenCalledTimes(1);
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
    const listener = vi.fn();
    subscribeActiveWorkspace(listener);
    expect(() => setActiveWorkspace("u1", "w1")).not.toThrow();
    expect(readActiveWorkspace("u1")).toBeNull();
    expect(listener).toHaveBeenCalled();
  });
});
