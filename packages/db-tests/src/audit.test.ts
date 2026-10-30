import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { addMember, addTask, asService, asUser, createDb, personalWorkspace, signUp, uniqueEmail as email } from "./db";

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 60_000);

const count = async (sql: string, params: unknown[] = []) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).rows[0]!.n;

describe("workspaces cannot be deleted through the API", () => {
  it("leaves the workspace and its tasks in place when its owner tries to delete it", async () => {
    const owner = await signUp(db, email("owner"));
    const member = await signUp(db, email("member"));
    const ws = await personalWorkspace(db, owner);
    await addMember(db, ws, member);
    await addTask(db, member, ws, "Member's work");

    await asUser(db, owner, () => db.query("delete from public.workspaces where id = $1", [ws]));

    expect(await count("select 1 from public.workspaces where id = $1", [ws])).toBe(1);
    expect(await count("select 1 from public.tasks where workspace_id = $1", [ws])).toBe(1);
  });
});

describe("claim_calendar_sync_queue", () => {
  const queue = async (user: string, ws: string, tasks: string[]) => {
    for (const task of tasks) {
      await db.query(
        "insert into public.calendar_sync_queue (user_id, task_id, workspace_id) values ($1, $2, $3)",
        [user, task, ws],
      );
    }
  };
  const claim = (user: string, batch: number) =>
    asService(db, () =>
      db.query<{ task_id: string }>("select task_id from public.claim_calendar_sync_queue($1, $2)", [user, batch]),
    );

  it("hands each waiting task out once, oldest first, and leaves other people's rows alone", async () => {
    const person = await signUp(db, email("cal"));
    const other = await signUp(db, email("cal-other"));
    const ws = await personalWorkspace(db, person);
    const otherWs = await personalWorkspace(db, other);
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await queue(person, ws, ids);
    await queue(other, otherWs, [crypto.randomUUID()]);

    const first = await claim(person, 2);
    const second = await claim(person, 2);

    expect(first.rows.map((r) => r.task_id)).toEqual([ids[0], ids[1]]);
    expect(second.rows.map((r) => r.task_id)).toEqual([ids[2]]);
    expect(await count("select 1 from public.calendar_sync_queue where user_id = $1", [other])).toBe(1);
  });

  it("is not callable by a signed-in person", async () => {
    const person = await signUp(db, email("cal-user"));
    await expect(
      asUser(db, person, () => db.query("select * from public.claim_calendar_sync_queue($1, 1)", [person])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("scheduled purge of deleted rows", () => {
  /** A task with one attachment file, in a fresh workspace. */
  async function taskWithFile(name: string) {
    const owner = await signUp(db, email(name));
    const ws = await personalWorkspace(db, owner);
    const task = await addTask(db, owner, ws, name);
    const path = `${task}/${name}.txt`;
    await db.query(
      `insert into public.attachments (workspace_id, task_id, created_by, storage_path, file_name, size_bytes)
       values ($1, $2, $3, $4, $5, 1)`,
      [ws, task, owner, path, `${name}.txt`],
    );
    return { owner, ws, task, path };
  }
  const expiredPaths = () =>
    asService(db, () => db.query<{ p: string }>("select public.expired_attachment_paths() as p")).then((r) => r.rows.map((row) => row.p));

  it("lists the files of attachments and tasks that were deleted long enough ago, and nothing else", async () => {
    const live = await taskWithFile("live-file");
    const oldAttachment = await taskWithFile("old-attachment");
    const oldTask = await taskWithFile("old-task");
    const recent = await taskWithFile("recent-delete");
    await db.query("update public.attachments set deleted_at = now() - interval '40 days' where storage_path = $1", [oldAttachment.path]);
    await db.query("update public.tasks set deleted_at = now() - interval '40 days' where id = $1", [oldTask.task]);
    await db.query("update public.tasks set deleted_at = now() - interval '2 days' where id = $1", [recent.task]);

    const paths = await expiredPaths();

    expect(paths).toContain(oldAttachment.path);
    expect(paths).toContain(oldTask.path);
    expect(paths).not.toContain(live.path);
    expect(paths).not.toContain(recent.path);
  });

  it("purges the old tombstones and keeps live rows", async () => {
    const live = await taskWithFile("keep-me");
    const gone = await taskWithFile("purge-me");
    await db.query("update public.tasks set deleted_at = now() - interval '40 days' where id = $1", [gone.task]);

    const purged = await asService(db, () => db.query<{ n: string }>("select public.purge_deleted_rows() as n"));

    expect(Number(purged.rows[0]?.n)).toBeGreaterThanOrEqual(1);
    expect(await count("select 1 from public.tasks where id = $1", [gone.task])).toBe(0);
    expect(await count("select 1 from public.tasks where id = $1", [live.task])).toBe(1);
  });

  it("is for the server only", async () => {
    const person = await signUp(db, email("purge-user"));
    await expect(asUser(db, person, () => db.query("select public.purge_deleted_rows()"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, person, () => db.query("select public.expired_attachment_paths()"))).rejects.toThrow(/permission denied/);
  });
});
