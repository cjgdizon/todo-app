import { describe, expect, it } from "vitest";
import { deserializeCache, serializeCache } from "./persist-codec.ts";

describe("saved cache codec", () => {
  it("brings dates back as dates, wherever they sit", () => {
    const due = new Date("2026-10-21T15:00:00.000Z");
    const original = { clientState: { queries: [{ state: { data: [{ id: "1", dueAt: due, completedAt: null }] } }] } };
    const restored = deserializeCache(serializeCache(original)) as typeof original;
    const task = restored.clientState.queries[0]!.state.data[0]!;
    expect(task.dueAt).toBeInstanceOf(Date);
    expect(task.dueAt.getTime()).toBe(due.getTime());
    expect(task.completedAt).toBeNull();
  });

  it("leaves ordinary strings and numbers alone, including ones that look like dates", () => {
    const original = { title: "2026-10-21T15:00:00.000Z", position: "a0", count: 3 };
    expect(deserializeCache(serializeCache(original))).toEqual(original);
  });

  it("stores an invalid date as null instead of failing the whole save", () => {
    const text = serializeCache({ dueAt: new Date("nope") });
    expect(deserializeCache(text)).toEqual({ dueAt: null });
  });
});
