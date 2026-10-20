import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { addTask, asAnon, asUser, createDb, personalWorkspace, signUp, uniqueEmail as email } from "./db";

let db: PGlite;
let owner: string;
let ws: string;
let task: string;

beforeAll(async () => {
  db = await createDb();
  owner = await signUp(db, email("owner"));
  ws = await personalWorkspace(db, owner);
  task = await addTask(db, owner, ws, "t");
}, 60_000);

const asOwner = <T>(fn: () => Promise<T>) => asUser(db, owner, fn);

describe("text column length limits", () => {
  // Each case runs the statement with a value of length n as the owner.
  const cases: { name: string; max: number; run: (n: number) => Promise<unknown> }[] = [
    {
      name: "tasks.notes",
      max: 50_000,
      run: (n) => db.query("update public.tasks set notes = repeat('n', $1) where id = $2", [n, task]),
    },
    {
      name: "tasks.rrule",
      max: 500,
      run: (n) =>
        db.query(
          "update public.tasks set rrule = repeat('R', $1), due_at = now(), due_tz = 'UTC' where id = $2",
          [n, task],
        ),
    },
    {
      name: "tasks.position",
      max: 128,
      run: (n) => db.query("update public.tasks set position = repeat('p', $1) where id = $2", [n, task]),
    },
    {
      name: "projects.position",
      max: 128,
      run: (n) =>
        db.query("insert into public.projects (workspace_id, name, position) values ($1, 'p', repeat('p', $2))", [ws, n]),
    },
    {
      name: "projects.color",
      max: 32,
      run: (n) =>
        db.query("insert into public.projects (workspace_id, name, position, color) values ($1, 'p', 'a0', repeat('c', $2))", [ws, n]),
    },
    {
      name: "labels.color",
      max: 32,
      run: (n) =>
        db.query("insert into public.labels (workspace_id, name, color) values ($1, $2, repeat('c', $3))", [ws, `l${n}`, n]),
    },
    {
      name: "profiles.avatar_url",
      max: 2048,
      run: (n) => db.query("update public.profiles set avatar_url = repeat('u', $1) where id = $2", [n, owner]),
    },
    {
      name: "attachments.mime_type",
      max: 255,
      run: (n) =>
        db.query(
          `insert into public.attachments (workspace_id, task_id, storage_path, file_name, size_bytes, mime_type)
           values ($1, $2, $3 || '/a', 'a.txt', 1, repeat('m', $4))`,
          [ws, task, task, n],
        ),
    },
  ];

  it.each(cases)("$name accepts $max characters and rejects one more", async ({ run, max }) => {
    await expect(asOwner(() => run(max))).resolves.toBeDefined();
    await expect(asOwner(() => run(max + 1))).rejects.toThrow(/check constraint/);
  });
});

describe("time zone validation", () => {
  const insertTask = (tz: string) =>
    asOwner(() =>
      db.query(
        "insert into public.tasks (workspace_id, title, position, due_at, due_tz, created_by) values ($1, 'tz', 'a0', now(), $2, $3)",
        [ws, tz, owner],
      ),
    );
  const setProfileZone = (tz: string) =>
    asOwner(() => db.query("update public.profiles set timezone = $1 where id = $2", [tz, owner]));

  it.each(["Asia/Manila", "UTC", "America/Argentina/Buenos_Aires", "Europe/Paris"])(
    "accepts the IANA zone %s",
    async (tz) => {
      await expect(insertTask(tz)).resolves.toBeDefined();
      await expect(setProfileZone(tz)).resolves.toBeDefined();
    },
  );

  it.each(["Not/AZone", "EST", "PST8PDT", "Asia/Manila; select 1", "x".repeat(65)])(
    "rejects %s on tasks and profiles",
    async (tz) => {
      await expect(insertTask(tz)).rejects.toThrow();
      await expect(setProfileZone(tz)).rejects.toThrow();
    },
  );

  it("explains the problem", async () => {
    await expect(insertTask("Not/AZone")).rejects.toThrow(/time zone/i);
  });
});

describe("foreign key support indexes", () => {
  it("has a non-partial index for the tasks -> projects foreign key", async () => {
    const res = await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'public' and indexname = 'tasks_project_fk_idx'",
    );
    const def = res.rows[0]?.indexdef ?? "";
    expect(def).toContain("(project_id, workspace_id)");
    expect(def).not.toMatch(/where/i);
  });
});

describe("attachment storage paths", () => {
  const insertPath = (path: string) =>
    asOwner(() =>
      db.query(
        "insert into public.attachments (workspace_id, task_id, storage_path, file_name, size_bytes) values ($1, $2, $3, 'a.txt', 1)",
        [ws, task, path],
      ),
    );

  it("accepts a path inside the attachment's own task folder", async () => {
    await expect(insertPath(`${task}/file.txt`)).resolves.toBeDefined();
    await expect(insertPath(`${task}/nested/dir/file.txt`)).resolves.toBeDefined();
  });

  it("rejects paths outside the task folder, traversal and oversized paths", async () => {
    const otherTask = "00000000-0000-0000-0000-000000000001";
    await expect(insertPath(`${otherTask}/file.txt`)).rejects.toThrow(/check constraint/);
    await expect(insertPath(`${ws}/${task}/file.txt`)).rejects.toThrow(/check constraint/);
    await expect(insertPath("file.txt")).rejects.toThrow(/check constraint/);
    await expect(insertPath(`${task}/../${otherTask}/file.txt`)).rejects.toThrow(/check constraint/);
    await expect(insertPath(`${task}/${"a".repeat(1100)}`)).rejects.toThrow(/check constraint/);
  });

  it("freezes the path once stored", async () => {
    await insertPath(`${task}/frozen.txt`);
    await expect(
      asOwner(() => db.query("update public.attachments set storage_path = $1 where storage_path = $2", [`${task}/other.txt`, `${task}/frozen.txt`])),
    ).rejects.toThrow(/cannot be changed/);
  });
});

describe("table privileges", () => {
  const priv = async (role: string, table: string, privilege: string) =>
    (await db.query<{ ok: boolean }>("select has_table_privilege($1, $2, $3) as ok", [role, table, privilege])).rows[0]!.ok;

  it("keeps normal access for signed-in users but not TRUNCATE, REFERENCES or TRIGGER", async () => {
    for (const p of ["SELECT", "INSERT", "UPDATE"]) expect(await priv("authenticated", "public.tasks", p)).toBe(true);
    for (const p of ["TRUNCATE", "REFERENCES", "TRIGGER"]) expect(await priv("authenticated", "public.tasks", p)).toBe(false);
    await asOwner(async () => {
      await expect(db.query("truncate public.activity_log")).rejects.toThrow(/permission denied/);
    });
  });

  it("gives anonymous callers no table privileges at all", async () => {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect(await priv("anon", "public.tasks", p), p).toBe(false);
    }
    await asAnon(db, async () => {
      await expect(db.query("select 1 from public.tasks")).rejects.toThrow(/permission denied/);
      await expect(db.query("truncate public.activity_log")).rejects.toThrow(/permission denied/);
    });
  });

  it("applies the same rules to tables created later", async () => {
    await db.query("create table public.zz_future (id int primary key)");
    expect(await priv("anon", "public.zz_future", "SELECT")).toBe(false);
    expect(await priv("authenticated", "public.zz_future", "SELECT")).toBe(true);
    expect(await priv("authenticated", "public.zz_future", "TRUNCATE")).toBe(false);
  });
});
