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

const setReminder = (uid: string, task: string, offsetMin: number) =>
  as(uid, "select public.set_task_reminder($1, $2)", [task, offsetMin]);

interface ReminderRow {
  remind_at: Date;
  sent_at: Date | null;
  offset_min: number;
  deleted_at: Date | null;
}

const reminders = async (task: string, uid: string) =>
  (
    await db.query<ReminderRow>(
      "select remind_at, sent_at, offset_min, deleted_at from public.reminders where task_id = $1 and user_id = $2 order by created_at",
      [task, uid],
    )
  ).rows;

const setDue = (task: string, dueAt: string, zone = "UTC", allDay = false) =>
  db.query("update public.tasks set due_at = $2, due_tz = $3, due_all_day = $4 where id = $1", [
    task,
    dueAt,
    zone,
    allDay,
  ]);

async function workspaceWithTask() {
  const owner = await signUp(db, email("owner"));
  const ws = await personalWorkspace(db, owner);
  const task = await addTask(db, owner, ws, "Call the bank");
  return { owner, ws, task };
}

describe("setting and clearing reminders", () => {
  it("fires the chosen number of minutes before the due time", async () => {
    const { owner, task } = await workspaceWithTask();
    await setDue(task, "2030-03-15T10:00:00Z");
    await setReminder(owner, task, 60);
    const [row] = await reminders(task, owner);
    expect(row?.remind_at.toISOString()).toBe("2030-03-15T09:00:00.000Z");
    expect(row?.sent_at).toBeNull();
  });

  it("fires an all-day task at 09:00 local time on its day", async () => {
    const { owner, task } = await workspaceWithTask();
    await setDue(task, "2030-03-14T16:00:00Z", "Asia/Manila", true); // midnight 15 March in Manila
    await setReminder(owner, task, 0);
    expect((await reminders(task, owner))[0]?.remind_at.toISOString()).toBe("2030-03-15T01:00:00.000Z");
  });

  it("needs a due date, a future time, and a task the caller can see", async () => {
    const { owner, task } = await workspaceWithTask();
    await expect(setReminder(owner, task, 0)).rejects.toThrow(/no due date/);

    await db.query("update public.tasks set due_at = now() + interval '30 minutes', due_tz = 'UTC' where id = $1", [task]);
    await expect(setReminder(owner, task, 60)).rejects.toThrow(/already passed/);

    const outsider = await signUp(db, email("outsider"));
    await setDue(task, "2030-03-15T10:00:00Z");
    await expect(setReminder(outsider, task, 0)).rejects.toThrow(/task not found/);
    await expect(setReminder(owner, task, -5)).rejects.toThrow();
  });

  it("keeps one reminder per person per task, and people have their own", async () => {
    const { owner, ws, task } = await workspaceWithTask();
    const member = await signUp(db, email("member"));
    await addMember(db, ws, member);
    await setDue(task, "2030-03-15T10:00:00Z");

    await setReminder(owner, task, 60);
    await setReminder(owner, task, 15);
    await setReminder(member, task, 1440);
    const mine = (await reminders(task, owner)).filter((r) => r.deleted_at === null);
    expect(mine.map((r) => r.offset_min)).toEqual([15]);
    expect((await reminders(task, member))[0]?.offset_min).toBe(1440);

    expect((await as(member, "select 1 from public.reminders where user_id = $1", [owner])).rows).toHaveLength(0);
  });

  it("can be cleared", async () => {
    const { owner, task } = await workspaceWithTask();
    await setDue(task, "2030-03-15T10:00:00Z");
    await setReminder(owner, task, 60);
    await as(owner, "select public.clear_task_reminder($1)", [task]);
    expect((await reminders(task, owner)).every((r) => r.deleted_at !== null)).toBe(true);
    await setReminder(owner, task, 30); // and set again afterwards
    expect((await reminders(task, owner)).filter((r) => r.deleted_at === null)).toHaveLength(1);
  });

  it("follows the task when it is rescheduled, and goes when the due date does", async () => {
    const { owner, task } = await workspaceWithTask();
    await setDue(task, "2030-03-15T10:00:00Z");
    await setReminder(owner, task, 60);
    await db.query("update public.reminders set sent_at = now() where task_id = $1", [task]);

    await setDue(task, "2030-03-20T12:00:00Z");
    const [moved] = await reminders(task, owner);
    expect(moved?.remind_at.toISOString()).toBe("2030-03-20T11:00:00.000Z");
    expect(moved?.sent_at).toBeNull();

    await db.query("update public.tasks set due_at = null, due_tz = null, due_all_day = false where id = $1", [task]);
    expect((await reminders(task, owner))[0]?.deleted_at).not.toBeNull();
  });

  it("cannot be written to directly by a client", async () => {
    const { owner, ws, task } = await workspaceWithTask();
    await expect(
      as(
        owner,
        "insert into public.reminders (workspace_id, task_id, user_id, remind_at) values ($1, $2, $3, now())",
        [ws, task, owner],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("claiming due reminders", () => {
  async function dueReminder(options: { tokens?: string[] } = {}) {
    const { owner, ws, task } = await workspaceWithTask();
    await setDue(task, "2030-03-15T10:00:00Z");
    await setReminder(owner, task, 0);
    for (const token of options.tokens ?? []) {
      await db.query("insert into public.push_tokens (token, user_id, platform) values ($1, $2, 'android')", [token, owner]);
    }
    await db.query("update public.reminders set remind_at = now() - interval '1 minute' where task_id = $1", [task]);
    return { owner, ws, task };
  }

  const claim = () => asService(db, () => db.query<{ task_id: string; user_id: string; title: string; tokens: string[]; time_zone: string }>("select * from public.claim_due_reminders()"));

  it("hands over each due reminder once, with the person's devices", async () => {
    const { task } = await dueReminder({ tokens: ["ExponentPushToken[aaaaaaaa]", "ExponentPushToken[bbbbbbbb]"] });
    const first = (await claim()).rows.filter((r) => r.task_id === task);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ title: "Call the bank", time_zone: "UTC" });
    expect([...(first[0]?.tokens ?? [])].sort()).toEqual(["ExponentPushToken[aaaaaaaa]", "ExponentPushToken[bbbbbbbb]"]);
    expect((await claim()).rows.filter((r) => r.task_id === task)).toHaveLength(0);
  });

  it("sends to at most a person's 10 newest devices", async () => {
    const { owner, task } = await dueReminder();
    await db.query(
      "insert into public.push_tokens (token, user_id, platform, updated_at) select 'ExponentPushToken[bulk' || lpad(i::text, 3, '0') || 'xxxxxxxxxx]', $1, 'android', now() - (i || ' minutes')::interval from generate_series(1, 12) as i",
      [owner],
    );
    const row = (await claim()).rows.find((r) => r.task_id === task);
    expect(row?.tokens).toHaveLength(10);
    expect(row?.tokens).toContain("ExponentPushToken[bulk001xxxxxxxxxx]");
    expect(row?.tokens).not.toContain("ExponentPushToken[bulk012xxxxxxxxxx]");
  });

  it("skips reminders that are not due yet", async () => {
    const { owner, task } = await workspaceWithTask();
    await setDue(task, "2030-03-15T10:00:00Z");
    await setReminder(owner, task, 0);
    expect((await claim()).rows.filter((r) => r.task_id === task)).toHaveLength(0);
  });

  it("skips finished and deleted tasks and people who left the workspace", async () => {
    const done = await dueReminder();
    await db.query("update public.tasks set completed_at = now() where id = $1", [done.task]);
    const trashed = await dueReminder();
    await db.query("update public.tasks set deleted_at = now() where id = $1", [trashed.task]);
    const left = await dueReminder();
    const guest = await signUp(db, email("guest"));
    await addMember(db, left.ws, guest);
    await setReminder(guest, left.task, 0);
    await db.query("update public.reminders set remind_at = now() - interval '1 minute' where user_id = $1", [guest]);
    await db.query("delete from public.workspace_members where workspace_id = $1 and user_id = $2", [left.ws, guest]);

    const claimed = (await claim()).rows;
    const tasks = claimed.map((r) => r.task_id);
    expect(claimed.filter((r) => r.user_id === left.owner && r.task_id === left.task)).toHaveLength(1);
    expect(claimed.some((r) => r.user_id === guest)).toBe(false);
    expect(tasks).not.toContain(done.task);
    expect(tasks).not.toContain(trashed.task);
  });

  it("drops reminders that are more than a day late instead of sending them", async () => {
    const { task } = await dueReminder();
    await db.query("update public.reminders set remind_at = now() - interval '2 days' where task_id = $1", [task]);
    expect((await claim()).rows.filter((r) => r.task_id === task)).toHaveLength(0);
    const [row] = (await db.query<{ sent_at: Date | null }>("select sent_at from public.reminders where task_id = $1", [task])).rows;
    expect(row?.sent_at).not.toBeNull();
  });

  it("is for the server only", async () => {
    const { owner } = await dueReminder();
    await expect(as(owner, "select * from public.claim_due_reminders()")).rejects.toThrow(/permission denied/);
    await expect(as(owner, "select public.forget_push_tokens(array['x'])")).rejects.toThrow(/permission denied/);
  });

  it("forgets push tokens the push service says are dead", async () => {
    await dueReminder({ tokens: ["ExponentPushToken[deadtoken]"] });
    await asService(db, () => db.query("select public.forget_push_tokens(array['ExponentPushToken[deadtoken]'])"));
    const left = await db.query("select 1 from public.push_tokens where token = 'ExponentPushToken[deadtoken]'");
    expect(left.rows).toHaveLength(0);
  });
});
