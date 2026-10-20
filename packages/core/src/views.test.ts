import { describe, expect, it } from "vitest";
import {
  buildTaskTree,
  compareTasks,
  descendantIds,
  dueBucket,
  groupUpcoming,
  planCompletion,
} from "./views.ts";

// Tuesday 2026-10-20 18:00 in Manila (UTC+8, no DST).
const ctx = { now: new Date("2026-10-20T10:00:00Z"), timeZone: "Asia/Manila" };
const at = (iso: string) => new Date(iso);

describe("dueBucket", () => {
  it("has no bucket without a due date", () => {
    expect(dueBucket({ dueAt: null, dueAllDay: false }, ctx)).toBe("none");
  });

  it("keeps an all-day task due today in today, even after its midnight start", () => {
    expect(dueBucket({ dueAt: at("2026-10-19T16:00:00Z"), dueAllDay: true }, ctx)).toBe("today");
  });

  it("makes a timed task overdue as soon as its time has passed", () => {
    expect(dueBucket({ dueAt: at("2026-10-20T09:00:00Z"), dueAllDay: false }, ctx)).toBe("overdue");
  });

  it("keeps a timed task later today in today", () => {
    expect(dueBucket({ dueAt: at("2026-10-20T12:00:00Z"), dueAllDay: false }, ctx)).toBe("today");
  });

  it("makes an all-day task from yesterday overdue", () => {
    expect(dueBucket({ dueAt: at("2026-10-18T16:00:00Z"), dueAllDay: true }, ctx)).toBe("overdue");
  });

  it("treats tomorrow and later as upcoming", () => {
    expect(dueBucket({ dueAt: at("2026-10-20T16:00:00Z"), dueAllDay: true }, ctx)).toBe("upcoming");
    expect(dueBucket({ dueAt: at("2027-03-01T00:00:00Z"), dueAllDay: false }, ctx)).toBe("upcoming");
  });
});

describe("groupUpcoming", () => {
  const task = (id: string, iso: string, allDay: boolean, position = "a0") => ({
    id,
    dueAt: at(iso),
    dueAllDay: allDay,
    position,
  });

  it("groups by local day, earliest day first, all-day before timed", () => {
    const groups = groupUpcoming(
      [
        task("late", "2026-10-23T01:00:00Z", false), // Fri 09:00
        task("timed", "2026-10-21T01:00:00Z", false), // Wed 09:00
        task("allday", "2026-10-20T16:00:00Z", true), // Wed all-day
        task("early", "2026-10-21T00:00:00Z", false), // Wed 08:00
      ],
      ctx,
    );
    expect(groups.map((g) => g.date)).toEqual(["2026-10-21", "2026-10-23"]);
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(["allday", "early", "timed"]);
  });

  it("ignores tasks that are not upcoming", () => {
    const groups = groupUpcoming(
      [
        task("overdue", "2026-10-18T16:00:00Z", true),
        task("today", "2026-10-19T16:00:00Z", true),
      ],
      ctx,
    );
    expect(groups).toEqual([]);
  });
});

describe("compareTasks", () => {
  it("orders by position, then id, using plain string comparison", () => {
    const list = [
      { id: "b", position: "a1" },
      { id: "a", position: "a1" },
      { id: "z", position: "Zz" },
      { id: "c", position: "a0" },
    ];
    expect([...list].sort(compareTasks).map((t) => t.id)).toEqual(["z", "c", "a", "b"]);
  });
});

describe("buildTaskTree", () => {
  const t = (id: string, parentId: string | null, position: string) => ({ id, parentId, position });

  it("nests subtasks under their parent in position order", () => {
    const tree = buildTaskTree([
      t("child2", "root", "a1"),
      t("root", null, "a0"),
      t("child1", "root", "a0"),
      t("grand", "child1", "a0"),
      t("other", null, "a1"),
    ]);
    expect(tree.map((n) => n.task.id)).toEqual(["root", "other"]);
    expect(tree[0]?.children.map((n) => n.task.id)).toEqual(["child1", "child2"]);
    expect(tree[0]?.children[0]?.children.map((n) => n.task.id)).toEqual(["grand"]);
  });

  it("shows a task whose parent is not in the list as a top-level task", () => {
    const tree = buildTaskTree([t("orphan", "missing", "a0")]);
    expect(tree.map((n) => n.task.id)).toEqual(["orphan"]);
  });

  it("does not loop forever on a bad cycle in the data", () => {
    const tree = buildTaskTree([t("a", "b", "a0"), t("b", "a", "a0")]);
    expect(tree).toEqual([]);
  });
});

describe("descendantIds", () => {
  const t = (id: string, parentId: string | null) => ({ id, parentId });

  it("lists every nested subtask but not the task itself", () => {
    const list = [t("root", null), t("a", "root"), t("b", "a"), t("c", "root"), t("other", null), t("x", "other")];
    expect(descendantIds(list, "root").sort()).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for a task without subtasks", () => {
    expect(descendantIds([t("a", null)], "a")).toEqual([]);
  });

  it("does not loop on a cycle in bad data", () => {
    expect(descendantIds([t("a", "b"), t("b", "a")], "a").sort()).toEqual(["b"]);
  });
});

describe("planCompletion", () => {
  const base = { dueAt: null, rrule: null, dueTz: null, recurAfterCompletion: false };
  const done = ctx.now;

  it("completes a one-off task", () => {
    expect(planCompletion(base, done, "Asia/Manila")).toEqual({ kind: "complete" });
  });

  it("completes a task that has a due date but no rule", () => {
    expect(planCompletion({ ...base, dueAt: at("2026-10-19T01:00:00Z") }, done, "UTC")).toEqual({
      kind: "complete",
    });
  });

  it("advances a recurring task to the next occurrence in its own time zone", () => {
    const plan = planCompletion(
      {
        ...base,
        dueAt: at("2026-10-19T01:00:00Z"), // Mon 09:00 Manila
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        dueTz: "Asia/Manila",
      },
      done,
      "UTC",
    );
    expect(plan).toEqual({ kind: "advance", nextDueAt: at("2026-10-26T01:00:00Z") });
  });

  it("falls back to the viewer's zone when the task has none", () => {
    const plan = planCompletion(
      { ...base, dueAt: at("2026-10-19T01:00:00Z"), rrule: "FREQ=WEEKLY;BYDAY=MO" },
      done,
      "Asia/Manila",
    );
    expect(plan).toEqual({ kind: "advance", nextDueAt: at("2026-10-26T01:00:00Z") });
  });

  it("counts from the completion day for 'after completion' rules", () => {
    const plan = planCompletion(
      {
        ...base,
        dueAt: at("2026-10-15T01:00:00Z"),
        rrule: "FREQ=DAILY;INTERVAL=3",
        dueTz: "Asia/Manila",
        recurAfterCompletion: true,
      },
      done,
      "UTC",
    );
    expect(plan).toEqual({ kind: "advance", nextDueAt: at("2026-10-23T01:00:00Z") });
  });

  it("completes the task when the rule has ended", () => {
    const plan = planCompletion(
      {
        ...base,
        dueAt: at("2026-10-19T01:00:00Z"),
        rrule: "FREQ=DAILY;UNTIL=20261019T020000Z",
        dueTz: "Asia/Manila",
      },
      done,
      "UTC",
    );
    expect(plan).toEqual({ kind: "complete" });
  });
});
