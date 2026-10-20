import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  addTask,
  asAnon,
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

/** First row of a query (superuser), or throws. */
async function one<T extends object>(sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (!row) throw new Error(`expected a row from: ${sql}`);
  return row;
}
const count = async (sql: string, params: unknown[] = []) =>
  (await one<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).n;
const id = async (sql: string, params: unknown[] = []) => (await one<{ id: string }>(sql, params)).id;

/** A project in `ws` (superuser). */
const addProject = (ws: string, name = "Project", position = "a0") =>
  id(
    "insert into public.projects (workspace_id, name, position) values ($1, $2, $3) returning id",
    [ws, name, position],
  );

/** An owner plus a member sharing the owner's Personal workspace. */
async function sharedPair() {
  const owner = await signUp(db, email("owner"));
  const member = await signUp(db, email("member"));
  const ws = await personalWorkspace(db, owner);
  await addMember(db, ws, member);
  return { owner, member, ws };
}

describe("account deletion keeps shared work", () => {
  it("nulls authorship and assignment when a collaborator deletes their account", async () => {
    const { member, ws } = await sharedPair();
    const task = await addTask(db, member, ws, "Made by member");
    await db.query("update public.tasks set assignee_id = $1 where id = $2", [member, task]);
    await db.query(
      "insert into public.comments (workspace_id, task_id, author_id, body) values ($1, $2, $3, 'hi')",
      [ws, task, member],
    );
    await db.query(
      `insert into public.attachments (workspace_id, task_id, created_by, storage_path, file_name, size_bytes)
       values ($1, $2, $3, 'p', 'f.txt', 1)`,
      [ws, task, member],
    );

    // Account deletion first removes the user's own, unshared workspace (the owner
    // restriction would otherwise refuse), then the account itself.
    await db.query("delete from public.workspaces where owner_id = $1", [member]);
    await db.query("delete from auth.users where id = $1", [member]);

    expect(
      await one("select created_by, assignee_id from public.tasks where id = $1", [task]),
    ).toEqual({ created_by: null, assignee_id: null });
    expect(await count("select 1 from public.comments where author_id is null and task_id = $1", [task])).toBe(1);
    expect(await count("select 1 from public.attachments where created_by is null and task_id = $1", [task])).toBe(1);
    expect(await count("select 1 from public.workspace_members where user_id = $1", [member])).toBe(0);
  });

  it("lets only a referential action null authorship, never a client", async () => {
    const { owner, member, ws } = await sharedPair();
    const task = await addTask(db, owner, ws);
    await asUser(db, member, async () => {
      await expect(
        db.query("update public.tasks set created_by = null where id = $1", [task]),
      ).rejects.toThrow(/cannot be changed/);
    });
  });

  it("refuses to delete an owner who still owns a workspace, and allows it after a transfer", async () => {
    const { owner, member, ws } = await sharedPair();
    const task = await addTask(db, owner, ws, "Shared work");

    await expect(db.query("delete from auth.users where id = $1", [owner])).rejects.toThrow(/foreign key/);

    await asUser(db, owner, () => db.query("select public.transfer_workspace($1, $2)", [ws, member]));
    await db.query("delete from auth.users where id = $1", [owner]);

    expect(await one("select owner_id from public.workspaces where id = $1", [ws])).toEqual({ owner_id: member });
    expect(await count("select 1 from public.tasks where id = $1", [task])).toBe(1);
  });
});

describe("transfer_workspace", () => {
  it("swaps owner and admin and keeps exactly one owner", async () => {
    const { owner, member, ws } = await sharedPair();
    await asUser(db, owner, () => db.query("select public.transfer_workspace($1, $2)", [ws, member]));

    const roles = await db.query<{ user_id: string; role: string }>(
      "select user_id, role from public.workspace_members where workspace_id = $1",
      [ws],
    );
    const byUser = Object.fromEntries(roles.rows.map((r) => [r.user_id, r.role]));
    expect(byUser).toEqual({ [owner]: "admin", [member]: "owner" });
    expect(await one("select owner_id from public.workspaces where id = $1", [ws])).toEqual({ owner_id: member });
  });

  it("rejects non-owners, non-members and anonymous callers", async () => {
    const { owner, member, ws } = await sharedPair();
    const outsider = await signUp(db, email("outsider"));

    await asUser(db, member, async () => {
      await expect(db.query("select public.transfer_workspace($1, $2)", [ws, member])).rejects.toThrow(
        /only the owner/,
      );
    });
    await asUser(db, owner, async () => {
      await expect(db.query("select public.transfer_workspace($1, $2)", [ws, outsider])).rejects.toThrow(
        /already be a member/,
      );
      await expect(db.query("select public.transfer_workspace($1, $2)", [ws, owner])).rejects.toThrow(
        /already own/,
      );
    });
    await asAnon(db, async () => {
      await expect(db.query("select public.transfer_workspace($1, $2)", [ws, member])).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("allows only one owner per workspace", async () => {
    const { member } = await sharedPair();
    await expect(
      db.query("update public.workspace_members set role = 'owner' where user_id = $1", [member]),
    ).rejects.toThrow(/unique|duplicate/);
  });
});

describe("soft delete and purge", () => {
  it("lets members soft-delete but never hard-delete tasks, projects and sections", async () => {
    const { member, ws } = await sharedPair();
    const project = await addProject(ws);
    const section = await id(
      "insert into public.sections (workspace_id, project_id, name, position) values ($1, $2, 'S', 'a0') returning id",
      [ws, project],
    );
    const task = await addTask(db, member, ws);

    await asUser(db, member, async () => {
      for (const [table, rowId] of [
        ["tasks", task],
        ["sections", section],
        ["projects", project],
      ] as const) {
        const res = await db.query(`delete from public.${table} where id = $1`, [rowId]);
        expect(res.affectedRows).toBe(0);
      }
      const soft = await db.query("update public.tasks set deleted_at = now() where id = $1", [task]);
      expect(soft.affectedRows).toBe(1);
    });
    // The tombstone is still readable, which is what an incremental sync needs.
    expect(await count("select 1 from public.tasks where id = $1 and deleted_at is not null", [task])).toBe(1);
  });

  it("purges only old tombstones and cascades to their children", async () => {
    const { owner, ws } = await sharedPair();
    const live = await addTask(db, owner, ws, "live");
    const old = await addTask(db, owner, ws, "old", "a1");
    const recent = await addTask(db, owner, ws, "recent", "a2");
    await db.query(
      "insert into public.comments (workspace_id, task_id, author_id, body) values ($1, $2, $3, 'child')",
      [ws, old, owner],
    );
    await db.query("update public.tasks set deleted_at = now() - interval '40 days' where id = $1", [old]);
    await db.query("update public.tasks set deleted_at = now() - interval '1 day' where id = $1", [recent]);

    const purged = await one<{ purged: string }>("select private.purge_deleted() as purged");
    expect(Number(purged.purged)).toBeGreaterThanOrEqual(1);

    expect(await count("select 1 from public.tasks where id = $1", [live])).toBe(1);
    expect(await count("select 1 from public.tasks where id = $1", [recent])).toBe(1);
    expect(await count("select 1 from public.tasks where id = $1", [old])).toBe(0);
    expect(await count("select 1 from public.comments where task_id = $1", [old])).toBe(0);
  });

  it("does not let API roles run the purge", async () => {
    const { owner } = await sharedPair();
    await asUser(db, owner, async () => {
      await expect(db.query("select private.purge_deleted()")).rejects.toThrow(/permission denied/);
    });
  });

  it("frees a label name once the label is soft-deleted", async () => {
    const { owner, ws } = await sharedPair();
    const insert = () =>
      asUser(db, owner, () =>
        db.query("insert into public.labels (workspace_id, name) values ($1, 'Home')", [ws]),
      );
    await insert();
    await expect(insert()).rejects.toThrow(/unique|duplicate/);
    await db.query("update public.labels set deleted_at = now() where workspace_id = $1", [ws]);
    await expect(insert()).resolves.toBeDefined();
  });
});

describe("server-owned sync columns", () => {
  it("ignores client-supplied version, timestamps, updated_by and deleted_at on insert", async () => {
    const { owner, member, ws } = await sharedPair();
    const taskId = await asUser(db, owner, async () => {
      const res = await db.query<{ id: string }>(
        `insert into public.tasks
           (workspace_id, title, position, created_by, version, created_at, updated_at, updated_by, deleted_at)
         values ($1, 'forged', 'a0', $2, 99, '2000-01-01', '2000-01-01', $3, now())
         returning id`,
        [ws, owner, member],
      );
      return res.rows[0]!.id;
    });
    const row = await one<{ version: number; recent: boolean; updated_by: string; deleted_at: string | null }>(
      `select version, created_at > '2020-01-01' and updated_at > '2020-01-01' as recent,
              updated_by, deleted_at from public.tasks where id = $1`,
      [taskId],
    );
    expect(row).toEqual({ version: 1, recent: true, updated_by: owner, deleted_at: null });
  });

  it("bumps the version by one, keeps created_at and records who updated", async () => {
    const { owner, member, ws } = await sharedPair();
    const task = await addTask(db, owner, ws);
    const before = await one<{ created_at: string }>("select created_at from public.tasks where id = $1", [task]);

    await asUser(db, member, () =>
      db.query(
        "update public.tasks set title = 'Edited', version = 50, created_at = '2001-01-01' where id = $1",
        [task],
      ),
    );
    const after = await one<{ version: number; created_at: string; updated_by: string }>(
      "select version, created_at, updated_by from public.tasks where id = $1",
      [task],
    );
    expect(after.version).toBe(2);
    expect(after.created_at).toEqual(before.created_at);
    expect(after.updated_by).toBe(member);
  });

  it("has an incremental-pull index on every synced table", async () => {
    const res = await db.query<{ tablename: string }>(
      "select tablename from pg_indexes where schemaname = 'public' and indexname like '%\\_sync\\_idx' order by tablename",
    );
    expect(res.rows.map((r) => r.tablename)).toEqual([
      "attachments",
      "comments",
      "labels",
      "projects",
      "reminders",
      "saved_filters",
      "sections",
      "task_labels",
      "tasks",
      "time_entries",
    ]);
  });
});

describe("task hierarchy", () => {
  async function task(ws: string, title: string, over: { project?: string | null; parent?: string | null } = {}) {
    return id(
      `insert into public.tasks (workspace_id, project_id, parent_id, title, position)
       values ($1, $2, $3, $4, 'a0') returning id`,
      [ws, over.project ?? null, over.parent ?? null, title],
    );
  }

  it("requires a subtask to be in the same project as its parent", async () => {
    const { ws } = await sharedPair();
    const project = await addProject(ws);
    const parent = await task(ws, "parent", { project });
    await expect(task(ws, "child", { project: null, parent })).rejects.toThrow(/same project/);
    await expect(task(ws, "child", { project, parent })).resolves.toBeDefined();
  });

  it("rejects cycles", async () => {
    const { ws } = await sharedPair();
    const a = await task(ws, "a");
    const b = await task(ws, "b", { parent: a });
    const c = await task(ws, "c", { parent: b });
    await expect(db.query("update public.tasks set parent_id = $1 where id = $2", [c, a])).rejects.toThrow(
      /own ancestor/,
    );
  });

  it("allows five levels and rejects a sixth", async () => {
    const { ws } = await sharedPair();
    let parent: string | null = null;
    for (let level = 1; level <= 5; level++) {
      parent = await task(ws, `level ${level}`, { parent });
    }
    await expect(task(ws, "level 6", { parent })).rejects.toThrow(/at most 5 levels/);
  });

  it("lets a whole subtree change project in one statement, but not a parent alone", async () => {
    const { ws } = await sharedPair();
    const p1 = await addProject(ws, "P1", "a0");
    const p2 = await addProject(ws, "P2", "a1");
    const parent = await task(ws, "parent", { project: p1 });
    const child = await task(ws, "child", { project: p1, parent });

    await expect(
      db.query("update public.tasks set project_id = $1 where id = $2", [p2, parent]),
    ).rejects.toThrow(/same project/);
    await db.query("update public.tasks set project_id = $1 where id in ($2, $3)", [p2, parent, child]);
    expect(await count("select 1 from public.tasks where project_id = $1", [p2])).toBe(2);
  });
});

describe("completion history", () => {
  it("lets members record and read completions, but not forge, edit or delete them", async () => {
    const { owner, member, ws } = await sharedPair();
    const outsider = await signUp(db, email("outsider"));
    const task = await addTask(db, owner, ws);
    const insert = (uid: string, completedBy: string) =>
      asUser(db, uid, () =>
        db.query(
          "insert into public.task_completions (workspace_id, task_id, completed_by, occurrence_due_at) values ($1, $2, $3, now())",
          [ws, task, completedBy],
        ),
      );

    await insert(member, member);
    await expect(insert(member, owner)).rejects.toThrow(/row-level security/);

    await asUser(db, member, async () => {
      expect((await db.query("select 1 from public.task_completions where task_id = $1", [task])).rows).toHaveLength(1);
      expect((await db.query("update public.task_completions set completed_at = now()")).affectedRows).toBe(0);
      expect((await db.query("delete from public.task_completions")).affectedRows).toBe(0);
    });
    await asUser(db, outsider, async () => {
      expect((await db.query("select 1 from public.task_completions")).rows).toHaveLength(0);
    });
  });
});

describe("move_project", () => {
  it("moves a project with everything attached and keeps data intact", async () => {
    const owner = await signUp(db, email("owner"));
    const member = await signUp(db, email("member")); // target only
    const outsider = await signUp(db, email("outsider")); // source only
    const src = await personalWorkspace(db, owner);
    const shared = await asUser(db, owner, async () =>
      id("insert into public.workspaces (name, owner_id) values ('Shared', $1) returning id", [owner]),
    );
    await addMember(db, shared, member);
    await addMember(db, src, outsider);

    const project = await addProject(src, "Launch");
    const section = await id(
      "insert into public.sections (workspace_id, project_id, name, position) values ($1, $2, 'Todo', 'a0') returning id",
      [src, project],
    );
    const t1 = await id(
      `insert into public.tasks (workspace_id, project_id, section_id, assignee_id, title, position)
       values ($1, $2, $3, $4, 'one', 'a0') returning id`,
      [src, project, section, owner],
    );
    const t2 = await id(
      `insert into public.tasks (workspace_id, project_id, parent_id, title, position)
       values ($1, $2, $3, 'two', 'a0') returning id`,
      [src, project, t1],
    );
    const t3 = await id(
      `insert into public.tasks (workspace_id, project_id, assignee_id, title, position)
       values ($1, $2, $3, 'three', 'a1') returning id`,
      [src, project, outsider],
    );

    // Labels: "urgent" exists in the target as "Urgent"; "home" does not.
    const urgent = await id("insert into public.labels (workspace_id, name) values ($1, 'urgent') returning id", [src]);
    const home = await id("insert into public.labels (workspace_id, name) values ($1, 'home') returning id", [src]);
    const targetUrgent = await id(
      "insert into public.labels (workspace_id, name) values ($1, 'Urgent') returning id",
      [shared],
    );
    await db.query(
      "insert into public.task_labels (task_id, label_id, workspace_id) values ($1, $2, $3), ($4, $5, $3)",
      [t1, urgent, src, t2, home],
    );

    // Things hanging off the tasks, including rows for a user who is NOT in the target.
    await db.query(
      "insert into public.reminders (workspace_id, task_id, user_id, remind_at) values ($1, $2, $3, now())",
      [src, t1, outsider],
    );
    await db.query(
      "insert into public.comments (workspace_id, task_id, author_id, body) values ($1, $2, $3, 'note')",
      [src, t1, owner],
    );
    await db.query(
      "insert into public.time_entries (workspace_id, task_id, user_id, started_at) values ($1, $2, $3, now())",
      [src, t1, outsider],
    );
    await db.query(
      "insert into public.task_completions (workspace_id, task_id, completed_by) values ($1, $2, $3)",
      [src, t1, owner],
    );

    await asUser(db, owner, () => db.query("select public.move_project($1, $2)", [project, shared]));

    // Everything now lives in the target workspace; nothing is left in the source.
    expect(
      (await one<{ workspace_id: string }>("select workspace_id from public.projects where id = $1", [project]))
        .workspace_id,
    ).toBe(shared);
    expect(await count("select 1 from public.tasks where project_id = $1 and workspace_id <> $2", [project, shared])).toBe(0);
    expect(await count("select 1 from public.tasks where project_id = $1", [project])).toBe(3);
    expect(await count("select 1 from public.sections where id = $1 and workspace_id = $2", [section, shared])).toBe(1);
    expect(await count("select 1 from public.tasks where workspace_id = $1 and project_id = $2", [src, project])).toBe(0);
    for (const table of ["reminders", "comments", "time_entries", "task_completions"]) {
      expect(
        await count(`select 1 from public.${table} where task_id = $1 and workspace_id = $2`, [t1, shared]),
      ).toBe(1);
    }

    // An assignee who is not in the target is cleared; one who is stays.
    expect(
      (await one<{ assignee_id: string | null }>("select assignee_id from public.tasks where id = $1", [t3]))
        .assignee_id,
    ).toBeNull();
    expect(
      (await one<{ assignee_id: string | null }>("select assignee_id from public.tasks where id = $1", [t1]))
        .assignee_id,
    ).toBe(owner);

    // Labels: matched by name (case-insensitive), created when missing; source labels untouched.
    const links = await db.query<{ task_id: string; name: string; label_id: string; workspace_id: string }>(
      `select tl.task_id, l.name, l.id as label_id, tl.workspace_id
       from public.task_labels tl join public.labels l on l.id = tl.label_id
       where tl.task_id in ($1, $2)`,
      [t1, t2],
    );
    // t1 got the target's existing "Urgent"; t2 got a newly created "home".
    expect(Object.fromEntries(links.rows.map((r) => [r.task_id, r.name]))).toEqual({
      [t1]: "Urgent",
      [t2]: "home",
    });
    expect(links.rows.every((r) => r.workspace_id === shared)).toBe(true);
    expect(links.rows.find((r) => r.name === "Urgent")?.label_id).toBe(targetUrgent);
    expect(await count("select 1 from public.labels where workspace_id = $1 and deleted_at is null", [src])).toBe(2);
    expect(await count("select 1 from public.labels where workspace_id = $1", [shared])).toBe(2);

    // Sync sees the move (versions bump) and access follows the new workspace.
    expect(
      (await one<{ version: number }>("select version from public.tasks where id = $1", [t1])).version,
    ).toBeGreaterThan(1);
    await asUser(db, member, async () => {
      expect((await db.query("select 1 from public.tasks where id = $1", [t1])).rows).toHaveLength(1);
    });
    await asUser(db, outsider, async () => {
      expect((await db.query("select 1 from public.tasks where id = $1", [t1])).rows).toHaveLength(0);
    });
  });

  it("rejects bad requests without leaking whether a project exists", async () => {
    const owner = await signUp(db, email("owner"));
    const stranger = await signUp(db, email("stranger"));
    const src = await personalWorkspace(db, owner);
    const strangerWs = await personalWorkspace(db, stranger);
    const project = await addProject(src);

    await asUser(db, owner, async () => {
      await expect(db.query("select public.move_project($1, $2)", [project, strangerWs])).rejects.toThrow(
        /not a member of the target/,
      );
      await expect(db.query("select public.move_project($1, $2)", [project, src])).rejects.toThrow(
        /already in that workspace/,
      );
    });
    await asUser(db, stranger, async () => {
      // Someone else's project and a project that does not exist look the same.
      await expect(db.query("select public.move_project($1, $2)", [project, strangerWs])).rejects.toThrow(
        /project not found/,
      );
      await expect(
        db.query("select public.move_project('00000000-0000-0000-0000-000000000000', $1)", [strangerWs]),
      ).rejects.toThrow(/project not found/);
    });
    await asAnon(db, async () => {
      await expect(db.query("select public.move_project($1, $2)", [project, src])).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("is the only way to change a project's workspace", async () => {
    const owner = await signUp(db, email("owner"));
    const src = await personalWorkspace(db, owner);
    const other = await asUser(db, owner, async () =>
      id("insert into public.workspaces (name, owner_id) values ('Other', $1) returning id", [owner]),
    );
    const project = await addProject(src);
    await asUser(db, owner, async () => {
      await expect(
        db.query("update public.projects set workspace_id = $1 where id = $2", [other, project]),
      ).rejects.toThrow(/cannot be changed/);
    });
  });
});
