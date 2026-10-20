import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addTask as insertTask,
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

const addTask = (uid: string, ws: string, title?: string, position?: string) =>
  insertTask(db, uid, ws, title, position);

describe("sign-up bootstrap", () => {
  it("creates a profile, a Personal workspace and an owner membership", async () => {
    const uid = await signUp(db, email("boot"), "Boot Strap");
    const profile = await db.query<{ display_name: string }>(
      "select display_name from public.profiles where id = $1",
      [uid],
    );
    expect(profile.rows[0]?.display_name).toBe("Boot Strap");

    const ws = await personalWorkspace(db, uid);
    const member = await db.query<{ role: string }>(
      "select role from public.workspace_members where workspace_id = $1 and user_id = $2",
      [ws, uid],
    );
    expect(member.rows[0]?.role).toBe("owner");
  });

  it("falls back to the email prefix when no name is given", async () => {
    const uid = await signUp(db, "fallback.person@example.com");
    const res = await db.query<{ display_name: string }>(
      "select display_name from public.profiles where id = $1",
      [uid],
    );
    expect(res.rows[0]?.display_name).toBe("fallback.person");
  });
});

describe("tenant isolation", () => {
  it("hides other users' data and blocks cross-tenant writes", async () => {
    const alice = await signUp(db, email("alice"));
    const bob = await signUp(db, email("bob"));
    const aliceWs = await personalWorkspace(db, alice);
    const taskId = await addTask(alice, aliceWs);

    await asUser(db, bob, async () => {
      expect((await db.query("select 1 from public.tasks where id = $1", [taskId])).rows).toHaveLength(0);
      expect((await db.query("select 1 from public.workspaces where id = $1", [aliceWs])).rows).toHaveLength(0);
      expect((await db.query("select 1 from public.profiles where id = $1", [alice])).rows).toHaveLength(0);

      const upd = await db.query("update public.tasks set title = 'pwned' where id = $1", [taskId]);
      expect(upd.affectedRows).toBe(0);
      const del = await db.query("delete from public.tasks where id = $1", [taskId]);
      expect(del.affectedRows).toBe(0);

      await expect(
        db.query(
          "insert into public.tasks (workspace_id, title, position, created_by) values ($1, 'x', 'a0', $2)",
          [aliceWs, bob],
        ),
      ).rejects.toThrow(/row-level security/);
    });

    const check = await db.query<{ title: string }>("select title from public.tasks where id = $1", [taskId]);
    expect(check.rows[0]?.title).toBe("Buy milk");
  });

  it("lets a user see and use their own workspace", async () => {
    const carol = await signUp(db, email("carol"));
    const ws = await personalWorkspace(db, carol);
    const id = await addTask(carol, ws, "Mine");
    await asUser(db, carol, async () => {
      const res = await db.query("select 1 from public.tasks where id = $1", [id]);
      expect(res.rows).toHaveLength(1);
    });
  });

  it("gives anonymous callers no rows and no writes", async () => {
    const dave = await signUp(db, email("dave"));
    const ws = await personalWorkspace(db, dave);
    await addTask(dave, ws);

    await asAnon(db, async () => {
      // anon has no table privileges at all, so reads fail loudly instead of returning nothing.
      await expect(db.query("select 1 from public.tasks")).rejects.toThrow(/permission denied/);
      await expect(db.query("select 1 from public.workspaces")).rejects.toThrow(/permission denied/);
      await expect(
        db.query("insert into public.tasks (workspace_id, title, position) values ($1, 'x', 'a0')", [ws]),
      ).rejects.toThrow();
    });
  });

  it("does not let a user forge the task creator", async () => {
    const erin = await signUp(db, email("erin"));
    const frank = await signUp(db, email("frank"));
    const ws = await personalWorkspace(db, erin);
    await asUser(db, erin, async () => {
      await expect(
        db.query(
          "insert into public.tasks (workspace_id, title, position, created_by) values ($1, 'x', 'a0', $2)",
          [ws, frank],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });
});

describe("workspace membership and roles", () => {
  it("does not let an owner or admin put someone into a workspace without consent", async () => {
    const owner = await signUp(db, email("owner"));
    const admin = await signUp(db, email("admin"));
    const target = await signUp(db, email("target"));
    const ws = await personalWorkspace(db, owner);
    await db.query(
      "insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin')",
      [ws, admin],
    );

    for (const actor of [owner, admin]) {
      await asUser(db, actor, async () => {
        await expect(
          db.query("insert into public.workspace_members (workspace_id, user_id) values ($1, $2)", [ws, target]),
        ).rejects.toThrow(/row-level security/);
      });
    }
  });

  it("freezes workspace_id and user_id on memberships", async () => {
    const owner = await signUp(db, email("owner"));
    const member = await signUp(db, email("member"));
    const other = await signUp(db, email("other"));
    const ws = await personalWorkspace(db, owner);
    await db.query("insert into public.workspace_members (workspace_id, user_id) values ($1, $2)", [ws, member]);

    await asUser(db, owner, async () => {
      await expect(
        db.query("update public.workspace_members set user_id = $1 where user_id = $2", [other, member]),
      ).rejects.toThrow(/cannot be changed/);
    });
  });

  it("lets members of a workspace work and see each other", async () => {
    const owner = await signUp(db, email("owner"), "Olivia Owner");
    const member = await signUp(db, email("member"));
    const ws = await personalWorkspace(db, owner);
    // Members normally join through the server-side invite flow; set up directly here.
    await db.query("insert into public.workspace_members (workspace_id, user_id) values ($1, $2)", [ws, member]);

    const taskId = await addTask(owner, ws, "Shared");
    await asUser(db, member, async () => {
      expect((await db.query("select 1 from public.tasks where id = $1", [taskId])).rows).toHaveLength(1);
      const prof = await db.query<{ display_name: string }>(
        "select display_name from public.profiles where id = $1",
        [owner],
      );
      expect(prof.rows[0]?.display_name).toBe("Olivia Owner");
    });
    // The member can also create tasks in the shared workspace.
    await addTask(member, ws, "From member", "a1");
  });

  it("stops plain members from managing the workspace", async () => {
    const owner = await signUp(db, email("owner"));
    const member = await signUp(db, email("member"));
    const outsider = await signUp(db, email("outsider"));
    const ws = await personalWorkspace(db, owner);
    await db.query("insert into public.workspace_members (workspace_id, user_id) values ($1, $2)", [ws, member]);

    await asUser(db, member, async () => {
      await expect(
        db.query("insert into public.workspace_members (workspace_id, user_id) values ($1, $2)", [ws, outsider]),
      ).rejects.toThrow(/row-level security/);
      const rename = await db.query("update public.workspaces set name = 'mine' where id = $1", [ws]);
      expect(rename.affectedRows).toBe(0);
    });
  });

  it("keeps the owner membership immutable and the owner id frozen", async () => {
    const owner = await signUp(db, email("owner"));
    const admin = await signUp(db, email("admin"));
    const ws = await personalWorkspace(db, owner);
    await db.query(
      "insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin')",
      [ws, admin],
    );

    await asUser(db, admin, async () => {
      // Admins cannot demote, remove, or replace the owner...
      expect(
        (await db.query("update public.workspace_members set role = 'member' where user_id = $1", [owner]))
          .affectedRows,
      ).toBe(0);
      expect(
        (await db.query("delete from public.workspace_members where user_id = $1", [owner])).affectedRows,
      ).toBe(0);
      // ...cannot promote themselves to owner...
      await expect(
        db.query("update public.workspace_members set role = 'owner' where user_id = $1", [admin]),
      ).rejects.toThrow(/row-level security/);
      // ...and cannot take over the workspace by changing owner_id.
      await expect(
        db.query("update public.workspaces set owner_id = $1 where id = $2", [admin, ws]),
      ).rejects.toThrow(/cannot be changed/);
    });

    await asUser(db, owner, async () => {
      expect(
        (await db.query("delete from public.workspace_members where user_id = $1", [owner])).affectedRows,
      ).toBe(0);
    });
  });

  it("lets a member leave on their own", async () => {
    const owner = await signUp(db, email("owner"));
    const member = await signUp(db, email("member"));
    const ws = await personalWorkspace(db, owner);
    await db.query("insert into public.workspace_members (workspace_id, user_id) values ($1, $2)", [ws, member]);

    await asUser(db, member, async () => {
      const res = await db.query("delete from public.workspace_members where user_id = $1", [member]);
      expect(res.affectedRows).toBe(1);
    });
  });
});

describe("data integrity", () => {
  it("rejects references that cross workspaces", async () => {
    const a = await signUp(db, email("a"));
    const b = await signUp(db, email("b"));
    const wsA = await personalWorkspace(db, a);
    const wsB = await personalWorkspace(db, b);
    const project = await db.query<{ id: string }>(
      "insert into public.projects (workspace_id, name, position) values ($1, 'A', 'a0') returning id",
      [wsA],
    );
    const parent = await db.query<{ id: string }>(
      "insert into public.tasks (workspace_id, title, position, created_by) values ($1, 'p', 'a0', $2) returning id",
      [wsA, a],
    );

    await expect(
      db.query(
        "insert into public.tasks (workspace_id, project_id, title, position, created_by) values ($1, $2, 't', 'a0', $3)",
        [wsB, project.rows[0]!.id, b],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query(
        "insert into public.tasks (workspace_id, parent_id, title, position, created_by) values ($1, $2, 't', 'a0', $3)",
        [wsB, parent.rows[0]!.id, b],
      ),
    ).rejects.toThrow(/foreign key/);
    // An assignee must be a member of the task's workspace.
    await expect(
      db.query(
        "insert into public.tasks (workspace_id, assignee_id, title, position, created_by) values ($1, $2, 't', 'a0', $3)",
        [wsA, b, a],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("freezes workspace_id and created_by on tasks", async () => {
    const a = await signUp(db, email("a"));
    const b = await signUp(db, email("b"));
    const wsA = await personalWorkspace(db, a);
    const wsB = await personalWorkspace(db, b);
    const id = await addTask(a, wsA);

    await expect(
      db.query("update public.tasks set workspace_id = $1 where id = $2", [wsB, id]),
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      db.query("update public.tasks set created_by = $1 where id = $2", [b, id]),
    ).rejects.toThrow(/cannot be changed/);
  });

  it("enforces task column rules", async () => {
    const a = await signUp(db, email("a"));
    const ws = await personalWorkspace(db, a);
    const insert = (cols: string, vals: unknown[]) =>
      db.query(
        `insert into public.tasks (workspace_id, position, created_by, ${cols}) values ($1, 'a0', $2, ${vals
          .map((_, i) => `$${i + 3}`)
          .join(", ")})`,
        [ws, a, ...vals],
      );

    await expect(insert("title", ["   "])).rejects.toThrow(/check/);
    await expect(insert("title", ["x".repeat(501)])).rejects.toThrow(/check/);
    await expect(insert("title, priority", ["x", 5])).rejects.toThrow(/check/);
    await expect(insert("title, rrule", ["x", "FREQ=DAILY"])).rejects.toThrow(/check/); // needs due_at
    await expect(
      insert("title, rrule, due_at", ["x", "FREQ=DAILY", "2026-11-01T09:00:00Z"]),
    ).rejects.toThrow(/check/); // needs due_tz so recurrence is the same for every member
    await expect(insert("title, due_tz", ["x", "not a zone!"])).rejects.toThrow(/check|IANA/);
    await expect(insert("title, estimate_min", ["x", 0])).rejects.toThrow(/check/);
    await expect(
      insert("title, rrule, due_at, due_tz", ["x", "FREQ=DAILY", "2026-11-01T09:00:00Z", "Asia/Manila"]),
    ).resolves.toBeDefined();
  });

  it("bumps version and updated_at on update", async () => {
    const a = await signUp(db, email("a"));
    const ws = await personalWorkspace(db, a);
    const id = await addTask(a, ws);
    await asUser(db, a, async () => {
      await db.query("update public.tasks set title = 'Renamed' where id = $1", [id]);
    });
    const res = await db.query<{ version: number; fresh: boolean }>(
      "select version, updated_at >= created_at as fresh from public.tasks where id = $1",
      [id],
    );
    expect(res.rows[0]).toEqual({ version: 2, fresh: true });
  });

  it("cascades project deletes to tasks and detaches deleted sections", async () => {
    const a = await signUp(db, email("a"));
    const ws = await personalWorkspace(db, a);
    const project = (
      await db.query<{ id: string }>(
        "insert into public.projects (workspace_id, name, position) values ($1, 'P', 'a0') returning id",
        [ws],
      )
    ).rows[0]!.id;
    const section = (
      await db.query<{ id: string }>(
        "insert into public.sections (workspace_id, project_id, name, position) values ($1, $2, 'S', 'a0') returning id",
        [ws, project],
      )
    ).rows[0]!.id;
    const task = (
      await db.query<{ id: string }>(
        "insert into public.tasks (workspace_id, project_id, section_id, title, position, created_by) values ($1, $2, $3, 't', 'a0', $4) returning id",
        [ws, project, section, a],
      )
    ).rows[0]!.id;

    await db.query("delete from public.sections where id = $1", [section]);
    const kept = await db.query<{ project_id: string | null; section_id: string | null }>(
      "select project_id, section_id from public.tasks where id = $1",
      [task],
    );
    expect(kept.rows[0]).toEqual({ project_id: project, section_id: null });

    await db.query("delete from public.projects where id = $1", [project]);
    expect((await db.query("select 1 from public.tasks where id = $1", [task])).rows).toHaveLength(0);
  });

  it("allows only one running timer per user", async () => {
    const a = await signUp(db, email("a"));
    const ws = await personalWorkspace(db, a);
    const t1 = await addTask(a, ws, "one", "a0");
    const t2 = await addTask(a, ws, "two", "a1");
    const start = (task: string) =>
      asUser(db, a, () =>
        db.query(
          "insert into public.time_entries (workspace_id, task_id, user_id, started_at) values ($1, $2, $3, now())",
          [ws, task, a],
        ),
      );
    await start(t1);
    await expect(start(t2)).rejects.toThrow(/unique|duplicate/);
  });

  it("supports full-text search on title and notes", async () => {
    const a = await signUp(db, email("a"));
    const ws = await personalWorkspace(db, a);
    await addTask(a, ws, "Pay electricity bill", "a0");
    await addTask(a, ws, "Call dentist", "a1");
    const res = await db.query<{ title: string }>(
      "select title from public.tasks where workspace_id = $1 and search @@ plainto_tsquery('simple', 'electricity')",
      [ws],
    );
    expect(res.rows.map((r) => r.title)).toEqual(["Pay electricity bill"]);
  });
});

describe("function privileges", () => {
  it("keeps policy helpers in a private schema that anonymous callers cannot reach", async () => {
    await asAnon(db, async () => {
      await expect(db.query("select * from private.my_workspace_ids()")).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("does not leave callable membership helpers in the exposed public schema", async () => {
    const res = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public'
         and p.proname in ('is_workspace_member', 'is_workspace_admin', 'shares_workspace_with')`,
    );
    expect(res.rows[0]?.n).toBe(0);
  });

  it("does not let signed-in users call the sign-up trigger functions", async () => {
    const a = await signUp(db, email("a"));
    await asUser(db, a, async () => {
      await expect(db.query("select public.handle_new_user()")).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.add_owner_membership()")).rejects.toThrow(/permission denied/);
    });
  });
});
