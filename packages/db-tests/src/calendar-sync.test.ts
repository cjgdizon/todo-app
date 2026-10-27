import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  addTask,
  asService,
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

const as = (uid: string, sql: string, params: unknown[] = []) =>
  asUser(db, uid, () => db.query(sql, params));

/** Switches calendar sync on for someone, as the connect function would (server side). */
const enable = (uid: string, ws: string) =>
  db.query(
    "insert into public.calendar_integrations (user_id, workspace_id, enabled, calendar_id) values ($1, $2, true, 'cal-1')",
    [uid, ws],
  );

const queued = async (task: string) =>
  (await db.query<{ user_id: string }>("select user_id from public.calendar_sync_queue where task_id = $1 order by user_id", [task])).rows.map(
    (r) => r.user_id,
  );

async function setup() {
  const owner = await signUp(db, email("owner"));
  const member = await signUp(db, email("member"));
  const ws = await personalWorkspace(db, owner);
  await addMember(db, ws, member);
  return { owner, member, ws };
}

describe("calendar integrations", () => {
  it("shows people their own row only, and never the secret reference", async () => {
    const { owner, member, ws } = await setup();
    await enable(owner, ws);
    await db.query("update public.calendar_integrations set vault_secret_id = gen_random_uuid() where user_id = $1", [owner]);

    const mine = await as(owner, "select user_id, enabled, status from public.calendar_integrations");
    expect(mine.rows).toHaveLength(1);
    expect((await as(member, "select 1 from public.calendar_integrations")).rows).toHaveLength(0);
    await expect(as(owner, "select vault_secret_id from public.calendar_integrations")).rejects.toThrow(/permission denied/);
    await expect(as(owner, "select sync_token from public.calendar_integrations")).rejects.toThrow(/permission denied/);
  });

  it("cannot be written by a client", async () => {
    const { owner, ws } = await setup();
    await expect(
      as(owner, "insert into public.calendar_integrations (user_id, workspace_id, enabled) values ($1, $2, true)", [owner, ws]),
    ).rejects.toThrow(/permission denied/);
    await enable(owner, ws);
    await expect(as(owner, "update public.calendar_integrations set enabled = false")).rejects.toThrow(/permission denied/);
    await expect(as(owner, "delete from public.calendar_integrations")).rejects.toThrow(/permission denied/);
  });

  it("goes away when the person leaves the workspace", async () => {
    const { member, ws } = await setup();
    await enable(member, ws);
    await db.query("delete from public.workspace_members where workspace_id = $1 and user_id = $2", [ws, member]);
    expect((await db.query("select 1 from public.calendar_integrations where user_id = $1", [member])).rows).toHaveLength(0);
  });
});

describe("task links", () => {
  it("are visible to their own person only and cannot be written by a client", async () => {
    const { owner, member, ws } = await setup();
    const task = await addTask(db, owner, ws, "Linked");
    await db.query(
      "insert into public.task_calendar_links (task_id, workspace_id, user_id, google_event_id) values ($1, $2, $3, 'evt-1')",
      [task, ws, owner],
    );
    expect((await as(owner, "select 1 from public.task_calendar_links")).rows).toHaveLength(1);
    expect((await as(member, "select 1 from public.task_calendar_links")).rows).toHaveLength(0);
    await expect(as(owner, "delete from public.task_calendar_links")).rejects.toThrow(/permission denied/);
  });

  it("are removed with the task, and one Google event belongs to one task", async () => {
    const { owner, ws } = await setup();
    const a = await addTask(db, owner, ws, "A");
    const b = await addTask(db, owner, ws, "B");
    const link = (task: string) =>
      db.query("insert into public.task_calendar_links (task_id, workspace_id, user_id, google_event_id) values ($1, $2, $3, 'same-event')", [task, ws, owner]);
    await link(a);
    await expect(link(b)).rejects.toThrow(/duplicate key|unique/i);
    await db.query("delete from public.tasks where id = $1", [a]);
    expect((await db.query("select 1 from public.task_calendar_links where task_id = $1", [a])).rows).toHaveLength(0);
  });
});

describe("the sync queue", () => {
  it("queues a changed task once for each person who has sync on in that workspace", async () => {
    const { owner, member, ws } = await setup();
    const bystander = await signUp(db, email("bystander"));
    const task = await addTask(db, owner, ws, "Plan");
    await enable(owner, ws);
    await enable(member, ws);
    await db.query("delete from public.calendar_sync_queue");

    await as(owner, "update public.tasks set title = 'Plan better' where id = $1", [task]);
    await as(owner, "update public.tasks set notes = 'more' where id = $1", [task]);
    expect(await queued(task)).toEqual([owner, member].sort());
    expect(await queued(task)).not.toContain(bystander);
  });

  it("also queues new tasks, finished tasks and removed tasks, but not reordering", async () => {
    const { owner, ws } = await setup();
    await enable(owner, ws);
    const task = await addTask(db, owner, ws, "New one");
    expect(await queued(task)).toEqual([owner]);

    await db.query("delete from public.calendar_sync_queue");
    await as(owner, "update public.tasks set position = 'zz' where id = $1", [task]);
    expect(await queued(task)).toEqual([]);

    await as(owner, "update public.tasks set completed_at = now() where id = $1", [task]);
    expect(await queued(task)).toEqual([owner]);
    await db.query("delete from public.calendar_sync_queue");
    await as(owner, "update public.tasks set deleted_at = now() where id = $1", [task]);
    expect(await queued(task)).toEqual([owner]);
  });

  it("ignores people who switched sync off, and tasks of other workspaces", async () => {
    const { owner, ws } = await setup();
    await enable(owner, ws);
    await db.query("update public.calendar_integrations set enabled = false where user_id = $1", [owner]);
    const task = await addTask(db, owner, ws, "Off");
    expect(await queued(task)).toEqual([]);

    await db.query("update public.calendar_integrations set enabled = true where user_id = $1", [owner]);
    const other = await signUp(db, email("other-owner"));
    const otherTask = await addTask(db, other, await personalWorkspace(db, other), "Elsewhere");
    expect(await queued(otherTask)).toEqual([]);
  });

  it("is for the server only", async () => {
    const { owner, ws } = await setup();
    await enable(owner, ws);
    await expect(as(owner, "select * from public.calendar_sync_queue")).rejects.toThrow(/permission denied/);
    const rows = await asService(db, () => db.query("select * from public.calendar_sync_queue"));
    expect(Array.isArray(rows.rows)).toBe(true);
  });
});
