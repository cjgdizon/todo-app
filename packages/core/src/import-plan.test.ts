import { describe, expect, it } from "vitest";
import type { ExchangeData, ExchangeTask } from "./exchange.ts";
import { planImport, type ImportContext } from "./import-plan.ts";

const task = (overrides: Partial<ExchangeTask> & { id: string; title: string }): ExchangeTask => ({
  parentId: null,
  projectId: null,
  sectionId: null,
  notes: null,
  priority: 4,
  dueAt: null,
  dueAllDay: false,
  dueTz: null,
  rrule: null,
  recurAfterCompletion: false,
  completedAt: null,
  labelIds: [],
  ...overrides,
});

const empty: ExchangeData = { projects: [], sections: [], labels: [], tasks: [] };

const context = (overrides: Partial<ImportContext> = {}): ImportContext => ({
  timeZone: "Asia/Manila",
  now: new Date("2026-10-21T00:00:00Z"),
  existingProjects: [],
  existingSections: [],
  existingLabels: [],
  topLevelEnd: new Map(),
  projectsEnd: null,
  ...overrides,
});

const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};

const data: ExchangeData = {
  projects: [{ id: "p1", name: "Home", color: "#3f7d6b", archived: true }],
  sections: [{ id: "s1", projectId: "p1", name: "Doing" }],
  labels: [{ id: "l1", name: "bills", color: null }],
  tasks: [
    task({ id: "t1", title: "Pay rent", projectId: "p1", sectionId: "s1", labelIds: ["l1"], priority: 1 }),
    task({ id: "t2", title: "Find receipt", parentId: "t1", projectId: "p1" }),
  ],
};

describe("planImport: new things", () => {
  it("creates projects, sections, labels and tasks under fresh ids, never the file's own", () => {
    const plan = planImport(data, context(), ids());
    expect(plan.warnings).toEqual([]);
    expect(plan.projects).toHaveLength(1);
    expect(plan.projects[0]).toMatchObject({ name: "Home", color: "#3f7d6b", archived: true });
    const used = [
      ...plan.projects.map((p) => p.id),
      ...plan.sections.map((s) => s.id),
      ...plan.labels.map((l) => l.id),
      ...plan.tasks.map((t) => t.id),
    ];
    expect(new Set(used).size).toBe(used.length);
    for (const original of ["p1", "s1", "l1", "t1", "t2"]) expect(used).not.toContain(original);
  });

  it("links tasks to the new project, section, label and parent", () => {
    const plan = planImport(data, context(), ids());
    const [rent, receipt] = plan.tasks;
    expect(rent).toMatchObject({
      title: "Pay rent",
      priority: 1,
      projectId: plan.projects[0]?.id,
      sectionId: plan.sections[0]?.id,
      labelIds: [plan.labels[0]?.id],
      parentId: null,
      depth: 1,
    });
    expect(receipt).toMatchObject({ title: "Find receipt", parentId: rent?.id, depth: 2, sectionId: null });
  });
});

describe("planImport: existing things", () => {
  it("reuses a project, section and label that already exist, matching names without regard to case", () => {
    const plan = planImport(
      data,
      context({
        existingProjects: [{ id: "E-proj", name: "home" }],
        existingSections: [{ id: "E-sec", projectId: "E-proj", name: "DOING", position: "a0" }],
        existingLabels: [{ id: "E-label", name: "BILLS" }],
      }),
      ids(),
    );
    expect(plan.projects).toEqual([]);
    expect(plan.sections).toEqual([]);
    expect(plan.labels).toEqual([]);
    expect(plan.tasks[0]).toMatchObject({ projectId: "E-proj", sectionId: "E-sec", labelIds: ["E-label"] });
  });

  it("merges two projects or labels in the file that share a name", () => {
    const plan = planImport(
      {
        ...empty,
        projects: [
          { id: "a", name: "Work", color: null, archived: false },
          { id: "b", name: "work", color: null, archived: false },
        ],
        tasks: [task({ id: "t1", title: "x", projectId: "a" }), task({ id: "t2", title: "y", projectId: "b" })],
      },
      context(),
      ids(),
    );
    expect(plan.projects).toHaveLength(1);
    expect(plan.tasks[0]?.projectId).toBe(plan.tasks[1]?.projectId);
  });

  it("places new tasks after the ones already in the same list", () => {
    const plan = planImport(
      { ...empty, tasks: [task({ id: "t1", title: "a" }), task({ id: "t2", title: "b" })] },
      context({ topLevelEnd: new Map([["", "a5"]]) }),
      ids(),
    );
    const [first, second] = plan.tasks.map((t) => t.position);
    expect(first && first > "a5").toBe(true);
    expect(first && second && second > first).toBe(true);
  });

  it("places new projects after existing ones", () => {
    const plan = planImport(
      { ...empty, projects: [{ id: "p", name: "New", color: null, archived: false }] },
      context({ projectsEnd: "a9", existingProjects: [{ id: "x", name: "Other" }] }),
      ids(),
    );
    expect(plan.projects[0]?.position && plan.projects[0].position > "a9").toBe(true);
  });
});

describe("planImport: ordering and hierarchy", () => {
  it("lists parents before their children even if the file lists them the other way round", () => {
    const plan = planImport(
      {
        ...empty,
        tasks: [
          task({ id: "child", title: "child", parentId: "parent" }),
          task({ id: "parent", title: "parent" }),
        ],
      },
      context(),
      ids(),
    );
    expect(plan.tasks.map((t) => t.title)).toEqual(["parent", "child"]);
    expect(plan.tasks[1]?.parentId).toBe(plan.tasks[0]?.id);
  });

  it("puts a subtask in its parent's project and warns when the file disagreed", () => {
    const plan = planImport(
      {
        ...empty,
        projects: [
          { id: "p1", name: "One", color: null, archived: false },
          { id: "p2", name: "Two", color: null, archived: false },
        ],
        tasks: [
          task({ id: "t1", title: "parent", projectId: "p1" }),
          task({ id: "t2", title: "child", parentId: "t1", projectId: "p2" }),
        ],
      },
      context(),
      ids(),
    );
    expect(plan.tasks[1]?.projectId).toBe(plan.tasks[0]?.projectId);
    expect(plan.warnings.join(" ")).toMatch(/child/);
  });

  it("makes a task top-level when its parent is not in the file", () => {
    const plan = planImport({ ...empty, tasks: [task({ id: "t1", title: "lost", parentId: "gone" })] }, context(), ids());
    expect(plan.tasks[0]?.parentId).toBeNull();
    expect(plan.warnings).toHaveLength(1);
  });

  it("breaks a parent loop instead of looping forever", () => {
    const plan = planImport(
      {
        ...empty,
        tasks: [task({ id: "a", title: "a", parentId: "b" }), task({ id: "b", title: "b", parentId: "a" })],
      },
      context(),
      ids(),
    );
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks.filter((t) => t.parentId === null)).toHaveLength(1);
    expect(plan.warnings.join(" ")).toMatch(/loop|cycle/i);
  });

  it("keeps nesting within five levels", () => {
    const chain = Array.from({ length: 8 }, (_, i) =>
      task({ id: `t${i + 1}`, title: `level ${i + 1}`, parentId: i === 0 ? null : `t${i}` }),
    );
    const plan = planImport({ ...empty, tasks: chain }, context(), ids());
    expect(plan.tasks).toHaveLength(8);
    expect(Math.max(...plan.tasks.map((t) => t.depth))).toBe(5);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it("only keeps a section that belongs to the task's project, and never on a subtask", () => {
    const plan = planImport(
      {
        projects: [
          { id: "p1", name: "One", color: null, archived: false },
          { id: "p2", name: "Two", color: null, archived: false },
        ],
        sections: [{ id: "s1", projectId: "p1", name: "Col" }],
        labels: [],
        tasks: [
          task({ id: "t1", title: "wrong project", projectId: "p2", sectionId: "s1" }),
          task({ id: "t2", title: "ok", projectId: "p1", sectionId: "s1" }),
          task({ id: "t3", title: "sub", parentId: "t2", projectId: "p1", sectionId: "s1" }),
        ],
      },
      context(),
      ids(),
    );
    const byTitle = new Map(plan.tasks.map((t) => [t.title, t]));
    expect(byTitle.get("wrong project")?.sectionId).toBeNull();
    expect(byTitle.get("ok")?.sectionId).toBe(plan.sections[0]?.id);
    expect(byTitle.get("sub")?.sectionId).toBeNull();
  });
});

describe("planImport: field checks", () => {
  it("keeps a valid recurrence and fills in the time zone", () => {
    const plan = planImport(
      {
        ...empty,
        tasks: [task({ id: "t1", title: "rent", dueAt: "2026-11-01T01:00:00.000Z", rrule: "FREQ=MONTHLY;BYMONTHDAY=1" })],
      },
      context(),
      ids(),
    );
    expect(plan.tasks[0]).toMatchObject({
      rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
      dueTz: "Asia/Manila",
      dueAt: new Date("2026-11-01T01:00:00.000Z"),
    });
    expect(plan.warnings).toEqual([]);
  });

  it("drops a recurrence that has no due date, or that is not allowed, and says so", () => {
    const plan = planImport(
      {
        ...empty,
        tasks: [
          task({ id: "t1", title: "no date", rrule: "FREQ=DAILY" }),
          task({ id: "t2", title: "bad rule", dueAt: "2026-11-01T01:00:00.000Z", rrule: "FREQ=SECONDLY" }),
        ],
      },
      context(),
      ids(),
    );
    expect(plan.tasks.map((t) => t.rrule)).toEqual([null, null]);
    expect(plan.warnings).toHaveLength(2);
  });

  it("replaces an unknown time zone with the importer's and says so", () => {
    const plan = planImport(
      { ...empty, tasks: [task({ id: "t1", title: "x", dueAt: "2026-11-01T01:00:00.000Z", dueTz: "Nowhere/Land" })] },
      context(),
      ids(),
    );
    expect(plan.tasks[0]?.dueTz).toBe("Asia/Manila");
    expect(plan.warnings).toHaveLength(1);
  });

  it("skips a task with a blank title and a second task that reuses an id", () => {
    const plan = planImport(
      {
        ...empty,
        tasks: [
          task({ id: "t1", title: "   " }),
          task({ id: "t2", title: "first" }),
          task({ id: "t2", title: "duplicate id" }),
        ],
      },
      context(),
      ids(),
    );
    expect(plan.tasks.map((t) => t.title)).toEqual(["first"]);
    expect(plan.warnings).toHaveLength(2);
  });

  it("carries completion, priority and notes, and ignores labels that are not in the file", () => {
    const plan = planImport(
      {
        ...empty,
        labels: [{ id: "l1", name: "x", color: null }],
        tasks: [
          task({
            id: "t1",
            title: "done",
            notes: "n",
            priority: 2,
            completedAt: "2026-10-20T10:00:00.000Z",
            labelIds: ["l1", "ghost"],
          }),
        ],
      },
      context(),
      ids(),
    );
    expect(plan.tasks[0]).toMatchObject({
      notes: "n",
      priority: 2,
      completedAt: new Date("2026-10-20T10:00:00.000Z"),
    });
    expect(plan.tasks[0]?.labelIds).toHaveLength(1);
    expect(plan.warnings).toHaveLength(1);
  });

  it("skips a section whose project is not in the file, and sends a task with a missing project to the Inbox", () => {
    const plan = planImport(
      {
        ...empty,
        sections: [{ id: "s1", projectId: "ghost", name: "Orphan" }],
        tasks: [task({ id: "t1", title: "x", projectId: "ghost", sectionId: "s1" })],
      },
      context(),
      ids(),
    );
    expect(plan.sections).toEqual([]);
    expect(plan.tasks[0]).toMatchObject({ projectId: null, sectionId: null });
    expect(plan.warnings).toHaveLength(3);
  });

  it("drops a due date it cannot read and uses the import time for an unreadable completion time", () => {
    const plan = planImport(
      {
        ...empty,
        tasks: [task({ id: "t1", title: "x", dueAt: "garbage", completedAt: "also garbage" })],
      },
      context(),
      ids(),
    );
    expect(plan.tasks[0]).toMatchObject({
      dueAt: null,
      dueTz: null,
      dueAllDay: false,
      completedAt: new Date("2026-10-21T00:00:00Z"),
    });
    expect(plan.warnings).toHaveLength(1);
  });

  it("appends new sections after the ones a reused project already has", () => {
    const plan = planImport(
      {
        projects: [{ id: "p1", name: "Home", color: null, archived: false }],
        sections: [{ id: "s1", projectId: "p1", name: "Later" }],
        labels: [],
        tasks: [],
      },
      context({
        existingProjects: [{ id: "E", name: "Home" }],
        existingSections: [
          { id: "es1", projectId: "E", name: "Now", position: "a0" },
          { id: "es2", projectId: "E", name: "Next", position: "a1" },
        ],
      }),
      ids(),
    );
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0]?.position && plan.sections[0].position > "a1").toBe(true);
  });

  it("plans nothing for an empty file", () => {
    expect(planImport(empty, context(), ids())).toEqual({
      projects: [],
      sections: [],
      labels: [],
      tasks: [],
      warnings: [],
    });
  });
});
