import { describe, expect, it } from "vitest";
import { reorder } from "./reorder";

const list = [
  { id: "a", position: "a0" },
  { id: "b", position: "a1" },
  { id: "c", position: "a2" },
];

/** Applies the updates and returns the ids in display order. */
function applied(items: typeof list, updates: { id: string; position: string }[]): string[] {
  const byId = new Map(items.map((i) => [i.id, i.position]));
  for (const u of updates) byId.set(u.id, u.position);
  return [...byId.entries()].sort(([, p1], [, p2]) => (p1 < p2 ? -1 : p1 > p2 ? 1 : 0)).map(([id]) => id);
}

describe("reorder", () => {
  it("moves an item to the end by changing only its own key", () => {
    const updates = reorder(list, 0, 2);
    expect(updates).toHaveLength(1);
    expect(applied(list, updates)).toEqual(["b", "c", "a"]);
  });

  it("moves an item to the start", () => {
    const updates = reorder(list, 2, 0);
    expect(updates).toHaveLength(1);
    expect(applied(list, updates)).toEqual(["c", "a", "b"]);
  });

  it("moves an item down one place", () => {
    const updates = reorder(list, 0, 1);
    expect(applied(list, updates)).toEqual(["b", "a", "c"]);
  });

  it("moves an item up one place", () => {
    expect(applied(list, reorder(list, 2, 1))).toEqual(["a", "c", "b"]);
  });

  it("does nothing when the position does not change or is out of range", () => {
    expect(reorder(list, 1, 1)).toEqual([]);
    expect(reorder(list, -1, 1)).toEqual([]);
    expect(reorder(list, 0, 3)).toEqual([]);
  });

  it("rebalances the whole list when neighbouring keys are equal", () => {
    const clashing = [
      { id: "a", position: "a0" },
      { id: "b", position: "a5" },
      { id: "c", position: "a5" },
      { id: "d", position: "a9" },
    ];
    // Moving "a" between the two equal keys has no room, so every key is reassigned.
    const updates = reorder(clashing, 0, 1);
    expect(updates).toHaveLength(4);
    expect(applied(clashing, updates)).toEqual(["b", "a", "c", "d"]);
    const positions = updates.map((u) => u.position);
    expect(new Set(positions).size).toBe(4);
  });
});
