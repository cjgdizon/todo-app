import type { ImportPlan, PlannedTask } from "@todo/core";
import { describe, expect, it } from "vitest";
import type { TodoClient } from "./client.ts";
import { applyImportPlan } from "./import-apply.ts";

interface Call {
  table: string;
  op: "insert" | "update";
  rows?: Record<string, unknown>[];
  patch?: Record<string, unknown>;
  ids?: string[];
}

/** A stand-in for the Supabase client that records what it is asked to do. */
function fakeClient(fail?: (insertNumber: number, table: string) => boolean) {
  const calls: Call[] = [];
  let inserts = 0;
  const client = {
    from: (table: string) => ({
      insert: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        inserts++;
        calls.push({ table, op: "insert", rows: Array.isArray(rows) ? rows : [rows] });
        return { error: fail?.(inserts, table) ? { message: "boom" } : null };
      },
      update: (patch: Record<string, unknown>) => ({
        in: async (_column: string, ids: string[]) => {
          calls.push({ table, op: "update", patch, ids });
          return { error: null };
        },
      }),
    }),
  };
  return { client: client as unknown as TodoClient, calls };
}

const planned = (id: string, depth: number, overrides: Partial<PlannedTask> = {}): PlannedTask => ({
  id,
  parentId: depth > 1 ? "parent" : null,
  projectId: null,
  sectionId: null,
  title: id,
  notes: null,
  priority: 4,
  dueAt: null,
  dueAllDay: false,
  dueTz: null,
  rrule: null,
  recurAfterCompletion: false,
  completedAt: null,
  position: "a0",
  labelIds: [],
  depth,
  ...overrides,
});

const target = { workspaceId: "w1", userId: "u1" };

const plan: ImportPlan = {
  projects: [{ id: "p1", name: "Home", color: null, archived: false, position: "a0" }],
  sections: [{ id: "s1", projectId: "p1", name: "Doing", position: "a0" }],
  labels: [{ id: "l1", name: "bills", color: null }],
  tasks: [
    planned("t1", 1, {
      projectId: "p1",
      sectionId: "s1",
      labelIds: ["l1"],
      dueAt: new Date("2026-11-01T01:00:00Z"),
      dueTz: "Asia/Manila",
      completedAt: new Date("2026-10-20T10:00:00Z"),
    }),
    planned("t2", 2, { parentId: "t1", projectId: "p1" }),
  ],
  warnings: [],
};

describe("applyImportPlan", () => {
  it("creates things parents-first: projects, sections, labels, each nesting level of tasks, then task labels", async () => {
    const { client, calls } = fakeClient();
    const result = await applyImportPlan(client, target, plan);

    expect(calls.map((c) => c.table)).toEqual(["projects", "sections", "labels", "tasks", "tasks", "task_labels"]);
    expect(calls.every((c) => c.op === "insert")).toBe(true);
    expect(result.counts).toEqual({ projects: 1, sections: 1, labels: 1, tasks: 2 });
  });

  it("writes the workspace, the creator and every field of a task", async () => {
    const { client, calls } = fakeClient();
    await applyImportPlan(client, target, plan);

    expect(calls[3]?.rows).toEqual([
      {
        id: "t1",
        workspace_id: "w1",
        created_by: "u1",
        project_id: "p1",
        section_id: "s1",
        parent_id: null,
        title: "t1",
        notes: null,
        priority: 4,
        due_at: "2026-11-01T01:00:00.000Z",
        due_all_day: false,
        due_tz: "Asia/Manila",
        rrule: null,
        recur_after_completion: false,
        completed_at: "2026-10-20T10:00:00.000Z",
        position: "a0",
      },
    ]);
    expect(calls[5]?.rows).toEqual([{ workspace_id: "w1", task_id: "t1", label_id: "l1" }]);
  });

  it("inserts in batches of 500", async () => {
    const many: ImportPlan = {
      projects: [],
      sections: [],
      labels: [],
      tasks: Array.from({ length: 1200 }, (_, i) => planned(`t${i}`, 1)),
      warnings: [],
    };
    const { client, calls } = fakeClient();
    await applyImportPlan(client, target, many);
    expect(calls.map((c) => c.rows?.length)).toEqual([500, 500, 200]);
  });

  it("reports progress up to the total", async () => {
    const { client } = fakeClient();
    const seen: number[] = [];
    let total = 0;
    await applyImportPlan(client, target, plan, (progress) => {
      seen.push(progress.done);
      total = progress.total;
    });
    expect(seen.at(-1)).toBe(total);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(total).toBeGreaterThan(0);
  });

  it("does nothing for an empty plan", async () => {
    const { client, calls } = fakeClient();
    const result = await applyImportPlan(client, target, { projects: [], sections: [], labels: [], tasks: [], warnings: [] });
    expect(calls).toEqual([]);
    expect(result.counts).toEqual({ projects: 0, sections: 0, labels: 0, tasks: 0 });
  });

  it("moves everything it created to the trash if a step fails, and reports the failure", async () => {
    // Fail on the third insert call (the labels).
    const { client, calls } = fakeClient((n) => n === 3);
    await expect(applyImportPlan(client, target, plan)).rejects.toThrow(/boom/);

    const trashed = calls.filter((c) => c.op === "update");
    expect(trashed.every((c) => c.patch && "deleted_at" in c.patch && c.patch.deleted_at !== null)).toBe(true);
    const byTable = Object.fromEntries(trashed.map((c) => [c.table, c.ids]));
    expect(byTable.projects).toEqual(["p1"]);
    expect(byTable.sections).toEqual(["s1"]);
    // Nothing was created in the failed step or after it, so nothing else needs trashing.
    expect(byTable.tasks).toBeUndefined();
  });

  it("trashes everything when the result's undo is used", async () => {
    const { client, calls } = fakeClient();
    const result = await applyImportPlan(client, target, plan);
    const before = calls.length;
    await result.undo();

    const trashed = calls.slice(before).filter((c) => c.op === "update");
    const byTable = Object.fromEntries(trashed.map((c) => [c.table, c.ids]));
    expect(byTable.tasks).toEqual(["t1", "t2"]);
    expect(byTable.sections).toEqual(["s1"]);
    expect(byTable.projects).toEqual(["p1"]);
    expect(byTable.labels).toEqual(["l1"]);
  });

  it("trashes ids in groups small enough for a request URL", async () => {
    const many: ImportPlan = {
      projects: [],
      sections: [],
      labels: [],
      tasks: Array.from({ length: 250 }, (_, i) => planned(`t${i}`, 1)),
      warnings: [],
    };
    const { client, calls } = fakeClient();
    const result = await applyImportPlan(client, target, many);
    const before = calls.length;
    await result.undo();
    expect(calls.slice(before).map((c) => c.ids?.length)).toEqual([100, 100, 50]);
  });
});
