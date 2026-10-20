import { describe, expect, it } from "vitest";
import { toggleSelection } from "./selection";

const order = ["a", "b", "c", "d", "e"];
const set = (...ids: string[]) => new Set(ids);

describe("toggleSelection", () => {
  it("adds an id that is not selected", () => {
    expect(toggleSelection(set(), order, null, "b", false)).toEqual(set("b"));
  });

  it("removes an id that is already selected", () => {
    expect(toggleSelection(set("b", "c"), order, "b", "b", false)).toEqual(set("c"));
  });

  it("selects the range from the anchor down to the clicked row, inclusive", () => {
    expect(toggleSelection(set("b"), order, "b", "d", true)).toEqual(set("b", "c", "d"));
  });

  it("selects the range upward too", () => {
    expect(toggleSelection(set("d"), order, "d", "b", true)).toEqual(set("b", "c", "d"));
  });

  it("keeps rows that were already selected outside the range", () => {
    expect(toggleSelection(set("a", "c"), order, "c", "e", true)).toEqual(set("a", "c", "d", "e"));
  });

  it("acts like a plain click when there is no anchor", () => {
    expect(toggleSelection(set(), order, null, "c", true)).toEqual(set("c"));
  });

  it("acts like a plain click when the anchor is no longer on screen", () => {
    expect(toggleSelection(set(), order, "gone", "c", true)).toEqual(set("c"));
  });

  it("does not change the set it was given", () => {
    const before = set("a");
    toggleSelection(before, order, "a", "c", true);
    expect(before).toEqual(set("a"));
  });
});
