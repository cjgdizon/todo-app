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
