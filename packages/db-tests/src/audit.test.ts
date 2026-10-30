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

// Kept below the first describe so later tasks append here.
void asService;
