import type { Label, Project, Task } from "./models.ts";
import { describe, expect, it } from "vitest";
import { selectView } from "./views.ts";

// Tuesday 2026-10-20 18:00 in Manila (UTC+8).
const ctx = { now: new Date("2026-10-20T10:00:00Z"), timeZone: "Asia/Manila" };

let counter = 0;
const task = (overrides: Partial<Task> & { title: string }): Task => ({
  id: `t${++counter}`,
  workspaceId: "w",
  projectId: null,
  sectionId: null,
  parentId: null,
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

const home: Project = { id: "p-home", workspaceId: "w", name: "Home", color: null, position: "a0", archived: false };
const bills: Label = { id: "l-bills", workspaceId: "w", name: "bills", color: null };
const lookups = { projects: [home], labels: [bills] };
const none: ReadonlySet<string> = new Set();

const titles = (nodes: { task: Task }[]) => nodes.map((n) => n.task.title);
const run = (tasks: Task[], view: Parameters<typeof selectView>[1], keep = none) =>
  selectView(tasks, view, ctx, lookups, keep);

describe("selectView: inbox and project", () => {
  it("shows open tasks without a project in the inbox, in position order", () => {
    const result = run(
      [
        task({ title: "second", position: "a1" }),
        task({ title: "first", position: "a0" }),
        task({ title: "in project", projectId: home.id }),
        task({ title: "done", completedAt: new Date("2026-10-20T00:00:00Z") }),
      ],
      { kind: "inbox" },
    );
    expect(result.error).toBeNull();
    expect(result.sections).toHaveLength(1);
    expect(titles(result.sections[0]?.nodes ?? [])).toEqual(["first", "second"]);
  });

  it("nests subtasks under their parent", () => {
    const parent = task({ title: "parent", projectId: home.id });
    const child = task({ title: "child", projectId: home.id, parentId: parent.id });
    const result = run([child, parent], { kind: "project", id: home.id });
    const [node] = result.sections[0]?.nodes ?? [];
    expect(node?.task.title).toBe("parent");
    expect(titles(node?.children ?? [])).toEqual(["child"]);
  });

  it("keeps a just-completed task visible while it is fading out", () => {
    const done = task({ title: "done", completedAt: new Date("2026-10-20T10:00:00Z") });
    expect(run([done], { kind: "inbox" }).sections[0]?.nodes ?? []).toHaveLength(0);
    const kept = run([done], { kind: "inbox" }, new Set([done.id]));
    expect(titles(kept.sections[0]?.nodes ?? [])).toEqual(["done"]);
  });
});

describe("selectView: today", () => {
  it("lists overdue tasks before today's, each ordered by time then priority", () => {
    const result = run(
      [
        task({ title: "later today", dueAt: new Date("2026-10-20T12:00:00Z") }),
        task({ title: "all-day today", dueAt: new Date("2026-10-19T16:00:00Z"), dueAllDay: true }),
        task({ title: "yesterday", dueAt: new Date("2026-10-18T16:00:00Z"), dueAllDay: true }),
        task({ title: "earlier today", dueAt: new Date("2026-10-20T09:00:00Z") }),
        task({ title: "tomorrow", dueAt: new Date("2026-10-20T16:00:00Z"), dueAllDay: true }),
        task({ title: "no date" }),
      ],
      { kind: "today" },
    );
    expect(result.sections.map((s) => s.title)).toEqual(["Overdue", "Today"]);
    expect(titles(result.sections[0]?.nodes ?? [])).toEqual(["yesterday", "earlier today"]);
    expect(titles(result.sections[1]?.nodes ?? [])).toEqual(["all-day today", "later today"]);
  });

  it("returns no sections when nothing is due", () => {
    expect(run([task({ title: "no date" })], { kind: "today" }).sections).toEqual([]);
  });
});

describe("selectView: upcoming", () => {
  it("groups future tasks by day with a readable heading", () => {
    const result = run(
      [
        task({ title: "friday", dueAt: new Date("2026-10-22T16:00:00Z"), dueAllDay: true }),
        task({ title: "tomorrow", dueAt: new Date("2026-10-20T16:00:00Z"), dueAllDay: true }),
        task({ title: "today", dueAt: new Date("2026-10-19T16:00:00Z"), dueAllDay: true }),
      ],
      { kind: "upcoming" },
    );
    expect(result.sections.map((s) => s.title)).toEqual(["Tomorrow", "Fri, Oct 23"]);
    expect(titles(result.sections[0]?.nodes ?? [])).toEqual(["tomorrow"]);
  });
});

describe("selectView: label and search", () => {
  const tasks = [
    task({ title: "Pay rent", projectId: home.id, priority: 1, labelIds: [bills.id], position: "a0" }),
    task({ title: "Buy milk", position: "a1" }),
    task({ title: "Pay electricity", labelIds: [bills.id], position: "a2" }),
  ];

  it("lists open tasks that carry the label", () => {
    const result = run(tasks, { kind: "label", id: bills.id });
    expect(titles(result.sections[0]?.nodes ?? [])).toEqual(["Pay rent", "Pay electricity"]);
  });

  it("searches title text", () => {
    const result = run(tasks, { kind: "search", query: "milk" });
    expect(titles(result.sections[0]?.nodes ?? [])).toEqual(["Buy milk"]);
  });

  it("understands the filter language", () => {
    const result = run(tasks, { kind: "search", query: "p1 & #home" });
    expect(titles(result.sections[0]?.nodes ?? [])).toEqual(["Pay rent"]);
  });

  it("reports an unreadable filter instead of throwing", () => {
    const result = run(tasks, { kind: "search", query: "(p1 &" });
    expect(result.sections).toEqual([]);
    expect(result.error).toMatch(/.+/);
  });

  it("applies a saved filter's query like a search", () => {
    const result = run(tasks, { kind: "filter", query: "#home | @bills" });
    expect(titles(result.sections[0]?.nodes ?? [])).toEqual(["Pay rent", "Pay electricity"]);
  });

  it("reports an unreadable saved filter instead of throwing", () => {
    const result = run(tasks, { kind: "filter", query: "(p1 &" });
    expect(result.sections).toEqual([]);
    expect(result.error).toMatch(/.+/);
  });

  it("shows nothing for an empty search", () => {
    const result = run(tasks, { kind: "search", query: "   " });
    expect(result).toEqual({ sections: [], error: null });
  });
});
