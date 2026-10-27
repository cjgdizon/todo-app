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
const service = (sql: string, params: unknown[] = []) => asService(db, () => db.query(sql, params));

/** A person with their personal workspace and a second workspace they own and share with a colleague. */
async function setup() {
  const me = await signUp(db, email("me"));
  const colleague = await signUp(db, email("colleague"));
  const personal = await personalWorkspace(db, me);
  const shared = (
    await as(me, "insert into public.workspaces (name, owner_id) values ('Team', $1) returning id", [me])
  ).rows[0] as { id: string };
  await addMember(db, shared.id, colleague);
  return { me, colleague, personal, shared: shared.id };
}

describe("what stops someone deleting their account", () => {
  it("lists the workspaces they own that other people belong to, and no others", async () => {
    const { me, colleague, shared } = await setup();
    const blockers = (await as(me, "select workspace_id, name, member_count from public.account_deletion_blockers()")).rows as {
      workspace_id: string;
      name: string;
      member_count: string | number;
    }[];
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ workspace_id: shared, name: "Team" });
    expect(Number(blockers[0]?.member_count)).toBe(2);
    // Someone who only belongs to a workspace is not blocked by it.
    expect((await as(colleague, "select 1 from public.account_deletion_blockers()")).rows).toHaveLength(0);
  });

  it("can be checked by the server for any person, before it does anything it cannot undo", async () => {
    const { me, colleague } = await setup();
    expect(((await service("select public.has_account_deletion_blockers($1) as blocked", [me])).rows[0] as { blocked: boolean }).blocked).toBe(true);
    expect(((await service("select public.has_account_deletion_blockers($1) as blocked", [colleague])).rows[0] as { blocked: boolean }).blocked).toBe(false);
    await expect(as(me, "select public.has_account_deletion_blockers($1)", [me])).rejects.toThrow(/permission denied/);
  });

  it("clears once the workspace is handed over", async () => {
    const { me, colleague, shared } = await setup();
    await as(me, "select public.transfer_workspace($1, $2)", [shared, colleague]);
    expect((await as(me, "select 1 from public.account_deletion_blockers()")).rows).toHaveLength(0);
  });
});

describe("removing what only the person owns", () => {
  it("is refused while a shared workspace is still theirs", async () => {
    const { me } = await setup();
    await expect(service("select public.delete_owned_workspaces($1)", [me])).rejects.toThrow(/hand over/);
  });

  it("deletes the unshared workspaces and keeps the ones handed over", async () => {
    const { me, colleague, personal, shared } = await setup();
    await as(me, "select public.transfer_workspace($1, $2)", [shared, colleague]);
    const removed = (await service("select public.delete_owned_workspaces($1) as n", [me])).rows[0] as { n: number };
    expect(removed.n).toBe(1);
    expect((await db.query("select 1 from public.workspaces where id = $1", [personal])).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.workspaces where id = $1", [shared])).rows).toHaveLength(1);
    // The account itself can now go; the handed-over workspace and its work survive.
    await db.query("delete from auth.users where id = $1", [me]);
    expect((await db.query("select 1 from public.workspaces where id = $1", [shared])).rows).toHaveLength(1);
  });

  it("lists the files that go with them, and only those", async () => {
    const { me, colleague, personal, shared } = await setup();
    const mine = await addTask(db, me, personal, "Mine");
    const teams = await addTask(db, me, shared, "Team task");
    for (const [ws, task, name] of [
      [personal, mine, "mine.txt"],
      [shared, teams, "team.txt"],
    ] as const) {
      await db.query(
        `insert into public.attachments (workspace_id, task_id, created_by, storage_path, file_name, size_bytes)
         values ($1, $2, $3, $4, $5, 1)`,
        [ws, task, me, `${task}/${name}`, name],
      );
    }
    const paths = (await service("select * from public.attachment_paths_of_owned_workspaces($1) as path", [me])).rows.map(
      (row) => Object.values(row as Record<string, string>)[0],
    );
    expect(paths).toEqual([`${mine}/mine.txt`]);
    expect(colleague).toBeTruthy();
  });

  it("is for the server only", async () => {
    const { me } = await setup();
    await expect(as(me, "select public.delete_owned_workspaces($1)", [me])).rejects.toThrow(/permission denied/);
    await expect(as(me, "select * from public.attachment_paths_of_owned_workspaces($1)", [me])).rejects.toThrow(/permission denied/);
  });
});
