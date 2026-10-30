import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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

describe("purging deleted rows", () => {
  /** A task with one attachment file, in the owner's workspace (a fresh one unless given). */
  async function taskWithFile(name: string, existing?: { owner: string; ws: string }) {
    const owner = existing?.owner ?? (await signUp(db, email(name)));
    const ws = existing?.ws ?? (await personalWorkspace(db, owner));
    const task = await addTask(db, owner, ws, name);
    const path = `${task}/${name}.txt`;
    await db.query(
      `insert into public.attachments (workspace_id, task_id, created_by, storage_path, file_name, size_bytes)
       values ($1, $2, $3, $4, $5, 1)`,
      [ws, task, owner, path, `${name}.txt`],
    );
    return { owner, ws, task, path };
  }
  beforeEach(async () => {
    await db.query("delete from public.storage_cleanup");
  });
  const longAgo = "now() - interval '40 days'";
  const purge = () => asService(db, () => db.query<{ n: string }>("select public.purge_deleted_rows() as n"));
  const queued = async () =>
    (await db.query<{ path: string }>("select path from public.storage_cleanup")).rows.map((row) => row.path);

  it("purges the old tombstones and keeps live rows", async () => {
    const live = await taskWithFile("keep-me");
    const gone = await taskWithFile("purge-me");
    await db.query(`update public.tasks set deleted_at = ${longAgo} where id = $1`, [gone.task]);

    const purged = await purge();

    expect(Number(purged.rows[0]?.n)).toBeGreaterThanOrEqual(1);
    expect(await count("select 1 from public.tasks where id = $1", [gone.task])).toBe(0);
    expect(await count("select 1 from public.tasks where id = $1", [live.task])).toBe(1);
  });

  it("queues the file of every attachment row the purge drops, including rows removed by a cascade", async () => {
    const live = await taskWithFile("live-file");
    const oldTask = await taskWithFile("old-task");
    const oldAttachment = await taskWithFile("old-attachment");
    // A live task inside a project that was deleted long ago: the purge removes it with the project.
    const inProject = await taskWithFile("in-old-project");
    const project = (
      await db.query<{ id: string }>(
        "insert into public.projects (workspace_id, name, position) values ($1, 'Old', 'a0') returning id",
        [inProject.ws],
      )
    ).rows[0]!.id;
    await db.query("update public.tasks set project_id = $1 where id = $2", [project, inProject.task]);
    await db.query(`update public.projects set deleted_at = ${longAgo} where id = $1`, [project]);
    await db.query(`update public.tasks set deleted_at = ${longAgo} where id = $1`, [oldTask.task]);
    await db.query(`update public.attachments set deleted_at = ${longAgo} where storage_path = $1`, [oldAttachment.path]);

    await purge();

    const paths = await queued();
    expect(paths).toContain(oldTask.path);
    expect(paths).toContain(oldAttachment.path);
    expect(paths).toContain(inProject.path);
    expect(paths).not.toContain(live.path);
  });

  it("does not queue a file that a row that stays still points at", async () => {
    const shared = await taskWithFile("shared-path");
    await db.query(`update public.attachments set deleted_at = ${longAgo} where storage_path = $1`, [shared.path]);
    // Someone else in the workspace added a second, live row for the same file.
    await db.query(
      `insert into public.attachments (workspace_id, task_id, created_by, storage_path, file_name, size_bytes)
       values ($1, $2, $3, $4, 'same.txt', 1)`,
      [shared.ws, shared.task, shared.owner, shared.path],
    );

    await purge();

    expect(await queued()).not.toContain(shared.path);
    expect(await count("select 1 from public.attachments where storage_path = $1", [shared.path])).toBe(1);
  });

  it("hands queued files out in batches and forgets the ones reported as removed", async () => {
    const paths = ["a/1.txt", "a/2.txt", "a/3.txt"];
    for (const path of paths) await db.query("insert into public.storage_cleanup (path) values ($1) on conflict do nothing", [path]);
    const next = (batch: number) =>
      asService(db, () => db.query<{ p: string }>("select public.next_storage_cleanup($1) as p", [batch])).then((r) => r.rows.map((row) => row.p));

    const firstTwo = (await next(2)).filter((p) => paths.includes(p));
    expect(firstTwo).toHaveLength(2);
    await asService(db, () => db.query("select public.finish_storage_cleanup($1::text[])", [firstTwo]));

    const left = (await next(10)).filter((p) => paths.includes(p));
    expect(left).toHaveLength(1);
    expect(firstTwo).not.toContain(left[0]);
  });

  it("is for the server only", async () => {
    const person = await signUp(db, email("purge-user"));
    for (const sql of [
      "select public.purge_deleted_rows()",
      "select public.next_storage_cleanup(10)",
      "select public.finish_storage_cleanup(array['x'])",
      "select * from public.storage_cleanup",
    ]) {
      await expect(asUser(db, person, () => db.query(sql))).rejects.toThrow(/permission denied/);
    }
  });
});
