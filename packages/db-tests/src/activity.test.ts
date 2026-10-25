import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  addTask,
  asUser,
  createDb,
  personalWorkspace,
  signUp,
  uniqueEmail as email,
} from "./db";

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 60_000);

interface Entry {
  action: string;
  actor_id: string | null;
  task_id: string | null;
  meta: Record<string, unknown>;
}

const log = async (ws: string) =>
  (
    await db.query<Entry>(
      "select action, actor_id, task_id, meta from public.activity_log where workspace_id = $1 order by id",
      [ws],
    )
  ).rows;

const as = (uid: string, sql: string, params: unknown[] = []) =>
  asUser(db, uid, () => db.query(sql, params));

/** A workspace shared by its owner and one member, with the join already logged. */
async function sharedWorkspace() {
  const owner = await signUp(db, email("owner"));
  const member = await signUp(db, email("member"));
  const ws = await personalWorkspace(db, owner);
  await addMember(db, ws, member);
  return { owner, member, ws };
}

describe("activity log", () => {
  it("stays empty while a workspace has one member", async () => {
    const owner = await signUp(db, email("solo"));
    const ws = await personalWorkspace(db, owner);
    const task = await addTask(db, owner, ws, "Alone");
    await as(owner, "update public.tasks set completed_at = now() where id = $1", [task]);
    expect(await log(ws)).toEqual([]);
  });

  it("records who joined", async () => {
    const { member, ws } = await sharedWorkspace();
    expect(await log(ws)).toEqual([
      { action: "member_joined", actor_id: member, task_id: null, meta: { user_id: member, role: "member" } },
    ]);
  });

  it("records task events with the actor and the title at the time", async () => {
    const { owner, member, ws } = await sharedWorkspace();
    const task = await addTask(db, owner, ws, "Plan offsite");
    await as(member, "update public.tasks set completed_at = now() where id = $1", [task]);
    await as(member, "update public.tasks set completed_at = null where id = $1", [task]);
    await as(owner, "update public.tasks set assignee_id = $2 where id = $1", [task, member]);
    await as(owner, "update public.tasks set assignee_id = null where id = $1", [task]);
    await as(owner, "update public.tasks set title = 'Plan the offsite' where id = $1", [task]);
    await as(owner, "update public.tasks set deleted_at = now() where id = $1", [task]);

    const entries = (await log(ws)).filter((e) => e.task_id === task);
    expect(entries.map((e) => [e.action, e.actor_id])).toEqual([
      ["task_created", owner],
      ["task_completed", member],
      ["task_reopened", member],
      ["task_assigned", owner],
      ["task_unassigned", owner],
      ["task_deleted", owner],
    ]);
    expect(entries[0]?.meta).toEqual({ title: "Plan offsite" });
    expect(entries[3]?.meta).toEqual({ title: "Plan offsite", assignee_id: member });
    expect(entries[5]?.meta).toEqual({ title: "Plan the offsite" });
  });

  it("records comments without copying their text", async () => {
    const { owner, member, ws } = await sharedWorkspace();
    const task = await addTask(db, owner, ws, "Discuss");
    await as(member, "insert into public.comments (workspace_id, task_id, body) values ($1, $2, 'secret words')", [
      ws,
      task,
    ]);
    const comment = (await log(ws)).find((e) => e.action === "comment_added");
    expect(comment).toMatchObject({ actor_id: member, task_id: task, meta: { title: "Discuss" } });
    expect(JSON.stringify(comment)).not.toContain("secret words");
  });

  it("is readable by members only, and clients cannot write it", async () => {
    const { owner, member, ws } = await sharedWorkspace();
    const outsider = await signUp(db, email("outsider"));
    await addTask(db, owner, ws, "Visible");

    for (const uid of [owner, member]) {
      const rows = (await as(uid, "select 1 from public.activity_log where workspace_id = $1", [ws])).rows;
      expect(rows.length).toBeGreaterThan(0);
    }
    expect((await as(outsider, "select 1 from public.activity_log where workspace_id = $1", [ws])).rows).toHaveLength(0);
    await expect(
      as(owner, "insert into public.activity_log (workspace_id, action) values ($1, 'forged')", [ws]),
    ).rejects.toThrow(/permission denied/);
    await expect(as(owner, "delete from public.activity_log where workspace_id = $1", [ws])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("is purged after its retention window", async () => {
    const { ws } = await sharedWorkspace();
    await db.query(
      "insert into public.activity_log (workspace_id, action, created_at) values ($1, 'task_created', now() - interval '200 days')",
      [ws],
    );
    const before = (await log(ws)).length;
    await db.query("select private.purge_deleted()");
    expect((await log(ws)).length).toBe(before - 1);
  });
});
