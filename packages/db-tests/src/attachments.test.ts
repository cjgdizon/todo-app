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

const can = async (uid: string, fn: "can_access_attachment_path" | "can_delete_attachment_path", path: string) =>
  asUser(db, uid, async () => (await db.query<{ ok: boolean }>(`select private.${fn}($1) as ok`, [path])).rows[0]?.ok);

/** An owner, a plain member, an admin and an outsider, with one attachment uploaded by the member. */
async function setup() {
  const owner = await signUp(db, email("owner"));
  const member = await signUp(db, email("member"));
  const admin = await signUp(db, email("admin"));
  const outsider = await signUp(db, email("outsider"));
  const ws = await personalWorkspace(db, owner);
  await addMember(db, ws, member);
  await addMember(db, ws, admin, "admin");
  const task = await addTask(db, owner, ws, "Contract");
  const id = crypto.randomUUID();
  const path = `${task}/${id}-contract.pdf`;
  await asUser(db, member, () =>
    db.query(
      `insert into public.attachments (id, workspace_id, task_id, storage_path, file_name, size_bytes, created_by)
       values ($1, $2, $3, $4, 'contract.pdf', 1000, $5)`,
      [id, ws, task, path, member],
    ),
  );
  return { owner, member, admin, outsider, ws, task, path };
}

describe("storage access for attachment files", () => {
  it("lets members of the task's workspace read and add files, and nobody else", async () => {
    const { owner, member, outsider, task, path } = await setup();
    expect(await can(owner, "can_access_attachment_path", path)).toBe(true);
    expect(await can(member, "can_access_attachment_path", path)).toBe(true);
    expect(await can(member, "can_access_attachment_path", `${task}/anything-new.png`)).toBe(true);
    expect(await can(outsider, "can_access_attachment_path", path)).toBe(false);
    expect(await can(outsider, "can_access_attachment_path", `${task}/anything-new.png`)).toBe(false);
  });

  it("refuses paths that do not name one of the caller's tasks", async () => {
    const { member } = await setup();
    const stranger = crypto.randomUUID();
    for (const path of [`${stranger}/a.png`, "a.png", "", "not-a-uuid/a.png", "../etc/passwd", `${stranger}`]) {
      expect(await can(member, "can_access_attachment_path", path)).toBe(false);
    }
  });

  it("lets only the uploader or an admin remove a file", async () => {
    const { owner, member, admin, outsider, path } = await setup();
    expect(await can(member, "can_delete_attachment_path", path)).toBe(true);
    expect(await can(admin, "can_delete_attachment_path", path)).toBe(true);
    expect(await can(owner, "can_delete_attachment_path", path)).toBe(true); // the owner administers the workspace
    expect(await can(outsider, "can_delete_attachment_path", path)).toBe(false);
  });

  it("does not let a plain member remove someone else's file, or a file with no record", async () => {
    const { owner, task } = await setup();
    const other = await signUp(db, email("other-member"));
    const ws = (await db.query<{ workspace_id: string }>("select workspace_id from public.tasks where id = $1", [task])).rows[0]!.workspace_id;
    await addMember(db, ws, other);
    const ownersFile = `${task}/${crypto.randomUUID()}-notes.txt`;
    await asUser(db, owner, () =>
      db.query(
        `insert into public.attachments (workspace_id, task_id, storage_path, file_name, size_bytes, created_by)
         values ($1, $2, $3, 'notes.txt', 5, $4)`,
        [ws, task, ownersFile, owner],
      ),
    );
    expect(await can(other, "can_delete_attachment_path", ownersFile)).toBe(false);
    expect(await can(other, "can_delete_attachment_path", `${task}/no-record.txt`)).toBe(false);
  });
});
