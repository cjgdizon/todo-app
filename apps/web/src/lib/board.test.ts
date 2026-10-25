import type { Section, Task } from "@todo/data";
import { describe, expect, it } from "vitest";
import { boardColumns, columnDropId, dropTarget, positionInColumn } from "./board";

let counter = 0;
const task = (overrides: Partial<Task> & { title: string }): Task => ({
  id: `t${++counter}`,
  workspaceId: "w",
  projectId: "p1",
  sectionId: null,
  parentId: null,
  assigneeId: null,
  notes: null,
  priority: 4,
  dueAt: null,
  dueAllDay: false,
  dueTz: null,
  rrule: null,
  recurAfterCompletion: false,
  position: "a0",
  completedAt: null,
  labelIds: [],
  version: 1,
  ...overrides,
});

const section = (id: string, projectId: string, position: string): Section => ({
  id,
  workspaceId: "w",
  projectId,
  name: id.toUpperCase(),
  position,
});

describe("boardColumns", () => {
  const sections = [section("doing", "p1", "a1"), section("todo", "p1", "a0"), section("other", "p2", "a0")];

  it("starts with 'No section', then the project's sections in order", () => {
    const columns = boardColumns([], sections, "p1");
    expect(columns.map((c) => [c.id, c.name])).toEqual([
      [null, "No section"],
      ["todo", "TODO"],
      ["doing", "DOING"],
    ]);
  });

  it("puts each open top-level task of the project in its column, in position order", () => {
    const columns = boardColumns(
      [
        task({ title: "b", sectionId: "todo", position: "a1" }),
        task({ title: "a", sectionId: "todo", position: "a0" }),
        task({ title: "loose" }),
        task({ title: "elsewhere", projectId: "p2" }),
        task({ title: "done", sectionId: "todo", completedAt: new Date("2026-10-20T00:00:00Z") }),
      ],
      sections,
      "p1",
    );
    const titles = (id: string | null) => columns.find((c) => c.id === id)?.tasks.map((t) => t.title);
    expect(titles("todo")).toEqual(["a", "b"]);
    expect(titles(null)).toEqual(["loose"]);
    expect(titles("doing")).toEqual([]);
  });

  it("leaves subtasks off the board; they show on their parent's card", () => {
    const parent = task({ title: "parent", sectionId: "todo" });
    const child = task({ title: "child", sectionId: "todo", parentId: parent.id });
    const columns = boardColumns([parent, child], sections, "p1");
    expect(columns.find((c) => c.id === "todo")?.tasks.map((t) => t.title)).toEqual(["parent"]);
  });

  it("shows a task whose section no longer exists in 'No section'", () => {
    const columns = boardColumns([task({ title: "orphan", sectionId: "deleted" })], sections, "p1");
    expect(columns[0]?.tasks.map((t) => t.title)).toEqual(["orphan"]);
  });
});

describe("positionInColumn", () => {
  const column = [
    { id: "a", position: "a0" },
    { id: "b", position: "a1" },
    { id: "c", position: "a2" },
  ];

  it("inserts at the start, middle and end", () => {
    expect(positionInColumn(column, "new", 0) < "a0").toBe(true);
    const middle = positionInColumn(column, "new", 1);
    expect(middle > "a0" && middle < "a1").toBe(true);
    expect(positionInColumn(column, "new", 3) > "a2").toBe(true);
  });

  it("ignores the moved card when it is already in the column", () => {
    // Moving "a" to index 1 of [b, c] puts it between b and c.
    const position = positionInColumn(column, "a", 1);
    expect(position > "a1" && position < "a2").toBe(true);
  });

  it("clamps an index past the end", () => {
    expect(positionInColumn(column, "new", 99) > "a2").toBe(true);
  });

  it("falls back to the end of the column when neighbouring keys are equal", () => {
    const clash = [
      { id: "a", position: "a5" },
      { id: "b", position: "a5" },
    ];
    expect(positionInColumn(clash, "new", 1) > "a5").toBe(true);
  });
});

describe("dropTarget", () => {
  const sections = [section("todo", "p1", "a0"), section("doing", "p1", "a1")];
  const a = task({ title: "a", sectionId: "todo", position: "a0", id: "ca" });
  const b = task({ title: "b", sectionId: "todo", position: "a1", id: "cb" });
  const c = task({ title: "c", sectionId: "doing", position: "a0", id: "cc" });
  const columns = boardColumns([a, b, c], sections, "p1");

  it("drops onto an empty column at its end", () => {
    expect(dropTarget(columns, "ca", columnDropId(null))).toEqual({ sectionId: null, index: 0 });
  });

  it("drops onto a column body after its cards", () => {
    expect(dropTarget(columns, "ca", columnDropId("doing"))).toEqual({ sectionId: "doing", index: 1 });
  });

  it("drops onto a card in another column, just before it", () => {
    expect(dropTarget(columns, "ca", "cc")).toEqual({ sectionId: "doing", index: 0 });
  });

  it("moving down within a column lands after the card it is dropped on", () => {
    expect(dropTarget(columns, "ca", "cb")).toEqual({ sectionId: "todo", index: 1 });
  });

  it("moving up within a column lands before the card it is dropped on", () => {
    expect(dropTarget(columns, "cb", "ca")).toEqual({ sectionId: "todo", index: 0 });
  });

  it("returns null when dropped on itself or on something unknown", () => {
    expect(dropTarget(columns, "ca", "ca")).toBeNull();
    expect(dropTarget(columns, "ca", "nowhere")).toBeNull();
  });
});
