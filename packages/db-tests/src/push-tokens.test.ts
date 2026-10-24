import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createDb, signUp, uniqueEmail as email } from "./db";

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 60_000);

const TOKEN = "ExponentPushToken[abcdefghijklmnopqrstuv]";

describe("push tokens", () => {
  it("registers a device for the caller and lets only them see it", async () => {
    const alice = await signUp(db, email("alice"));
    const bob = await signUp(db, email("bob"));

    await asUser(db, alice, () => db.query("select public.register_push_token($1, 'android')", [TOKEN]));

    await asUser(db, alice, async () => {
      const rows = (await db.query<{ token: string }>("select token from public.push_tokens")).rows;
      expect(rows.map((r) => r.token)).toEqual([TOKEN]);
    });
    await asUser(db, bob, async () => {
      expect((await db.query("select 1 from public.push_tokens")).rows).toHaveLength(0);
    });
  });

  it("moves a device to the next user who signs in on it, and registering twice is harmless", async () => {
    const carol = await signUp(db, email("carol"));
    const dave = await signUp(db, email("dave"));
    const shared = "ExponentPushToken[sharedsharedsharedshare]";

    await asUser(db, carol, () => db.query("select public.register_push_token($1, 'ios')", [shared]));
    await asUser(db, carol, () => db.query("select public.register_push_token($1, 'ios')", [shared]));
    await asUser(db, dave, () => db.query("select public.register_push_token($1, 'ios')", [shared]));

    const owners = await db.query<{ user_id: string }>("select user_id from public.push_tokens where token = $1", [shared]);
    expect(owners.rows.map((r) => r.user_id)).toEqual([dave]);
  });

  it("does not let clients write the table directly or unregister someone else's device", async () => {
    const erin = await signUp(db, email("erin"));
    const frank = await signUp(db, email("frank"));
    const token = "ExponentPushToken[erinerinerinerinerinerin]";
    await asUser(db, erin, () => db.query("select public.register_push_token($1, 'android')", [token]));

    await asUser(db, frank, async () => {
      await expect(
        db.query("insert into public.push_tokens (token, user_id, platform) values ('ExponentPushToken[forged]', $1, 'ios')", [frank]),
      ).rejects.toThrow(/permission denied/);
      await db.query("select public.unregister_push_token($1)", [token]); // not his: no effect
    });
    await asUser(db, erin, async () => {
      expect((await db.query("select 1 from public.push_tokens where token = $1", [token])).rows).toHaveLength(1);
      await db.query("select public.unregister_push_token($1)", [token]);
      expect((await db.query("select 1 from public.push_tokens where token = $1", [token])).rows).toHaveLength(0);
    });
  });

  it("rejects malformed tokens and platforms, and anonymous callers", async () => {
    const gina = await signUp(db, email("gina"));
    await asUser(db, gina, async () => {
      await expect(db.query("select public.register_push_token('short', 'ios')")).rejects.toThrow();
      await expect(db.query("select public.register_push_token($1, 'windows')", [TOKEN])).rejects.toThrow();
    });
    await asAnon(db, async () => {
      await expect(db.query("select public.register_push_token($1, 'ios')", [TOKEN])).rejects.toThrow(/permission denied/);
    });
  });

  it("is removed with the account", async () => {
    const fk = await db.query<{ confdeltype: string }>(
      "select confdeltype from pg_constraint where conrelid = 'public.push_tokens'::regclass and contype = 'f'",
    );
    expect(fk.rows.map((r) => r.confdeltype)).toEqual(["c"]);
  });
});
