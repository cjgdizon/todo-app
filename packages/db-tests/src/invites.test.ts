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

async function invite(uid: string, ws: string, role?: "admin" | "member"): Promise<string> {
  return asUser(db, uid, async () => {
    const res = role
      ? await db.query<{ t: string }>("select public.create_workspace_invite($1, $2) as t", [ws, role])
      : await db.query<{ t: string }>("select public.create_workspace_invite($1) as t", [ws]);
    return res.rows[0]!.t;
  });
}

const accept = (uid: string, token: string) =>
  asUser(db, uid, async () =>
    (await db.query<{ ws: string }>("select public.accept_workspace_invite($1) as ws", [token])).rows[0]!.ws,
  );

describe("workspace invites", () => {
  it("lets an owner invite someone, who then joins as a member and sees the shared work", async () => {
    const owner = await signUp(db, email("owner"));
    const guest = await signUp(db, email("guest"));
    const ws = await personalWorkspace(db, owner);
    const taskId = await addTask(db, owner, ws, "Shared task");

    const token = await invite(owner, ws);
    expect(token.length).toBeGreaterThanOrEqual(48);
    expect(await accept(guest, token)).toBe(ws);

    const role = await db.query<{ role: string }>("select role from public.workspace_members where workspace_id = $1 and user_id = $2", [ws, guest]);
    expect(role.rows[0]?.role).toBe("member");
    await asUser(db, guest, async () => {
      expect((await db.query("select 1 from public.tasks where id = $1", [taskId])).rows).toHaveLength(1);
    });
  });

  it("never stores the token itself", async () => {
    const owner = await signUp(db, email("owner"));
    const ws = await personalWorkspace(db, owner);
    const token = await invite(owner, ws);
    const stored = await db.query<{ row: string }>("select (w.*)::text as row from public.workspace_invites w where workspace_id = $1", [ws]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.row).not.toContain(token);
  });

  it("works once only, and not after it expires or is revoked", async () => {
    const owner = await signUp(db, email("owner"));
    const a = await signUp(db, email("a"));
    const b = await signUp(db, email("b"));
    const ws = await personalWorkspace(db, owner);

    const once = await invite(owner, ws);
    await accept(a, once);
    await expect(accept(b, once)).rejects.toThrow(/invalid or expired/);

    const old = await invite(owner, ws);
    await db.query("update public.workspace_invites set expires_at = now() - interval '1 minute' where workspace_id = $1 and accepted_at is null", [ws]);
    await expect(accept(b, old)).rejects.toThrow(/invalid or expired/);

    const revoked = await invite(owner, ws);
    const id = (await db.query<{ id: string }>("select id from public.workspace_invites where workspace_id = $1 and accepted_at is null and expires_at > now()", [ws])).rows[0]!.id;
    await asUser(db, owner, () => db.query("select public.revoke_workspace_invite($1)", [id]));
    await expect(accept(b, revoked)).rejects.toThrow(/invalid or expired/);
  });

  it("rejects guesses and anonymous callers", async () => {
    const guest = await signUp(db, email("guest"));
    await expect(accept(guest, "not-a-real-token")).rejects.toThrow(/invalid or expired/);
    await asAnon(db, async () => {
      await expect(db.query("select public.accept_workspace_invite('x')")).rejects.toThrow(/permission denied/);
    });
  });

  it("does not use up an invite when the caller is already a member", async () => {
    const owner = await signUp(db, email("owner"));
    const member = await signUp(db, email("member"));
    const other = await signUp(db, email("other"));
    const ws = await personalWorkspace(db, owner);
    await addMember(db, ws, member);

    const token = await invite(owner, ws);
    await expect(accept(member, token)).rejects.toThrow(/already a member/);
    await accept(other, token); // still valid for someone else
  });

  it("limits who can invite and at which role", async () => {
    const owner = await signUp(db, email("owner"));
    const admin = await signUp(db, email("admin"));
    const member = await signUp(db, email("member"));
    const outsider = await signUp(db, email("outsider"));
    const ws = await personalWorkspace(db, owner);
    await addMember(db, ws, admin, "admin");
    await addMember(db, ws, member);

    await invite(admin, ws, "member"); // admins may invite members
    await expect(invite(admin, ws, "admin")).rejects.toThrow(/owner/);
    await invite(owner, ws, "admin"); // only the owner may invite admins
    await expect(invite(member, ws)).rejects.toThrow(/not allowed/);
    await expect(invite(outsider, ws)).rejects.toThrow(/not allowed/);
    await asUser(db, owner, async () => {
      await expect(db.query("select public.create_workspace_invite($1, 'owner')", [ws])).rejects.toThrow();
    });
  });

  it("shows pending invites to admins only, and clients cannot write the table", async () => {
    const owner = await signUp(db, email("owner"));
    const member = await signUp(db, email("member"));
    const ws = await personalWorkspace(db, owner);
    await addMember(db, ws, member);
    await invite(owner, ws);

    await asUser(db, owner, async () => {
      expect((await db.query("select 1 from public.workspace_invites where workspace_id = $1", [ws])).rows).toHaveLength(1);
    });
    await asUser(db, member, async () => {
      expect((await db.query("select 1 from public.workspace_invites where workspace_id = $1", [ws])).rows).toHaveLength(0);
    });
    await asUser(db, owner, async () => {
      await expect(
        db.query("insert into public.workspace_invites (workspace_id, token_hash) values ($1, '\\x00')", [ws]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("caps the number of open invites per workspace", async () => {
    const owner = await signUp(db, email("owner"));
    const ws = await personalWorkspace(db, owner);
    for (let i = 0; i < 20; i++) await invite(owner, ws);
    await expect(invite(owner, ws)).rejects.toThrow(/too many/i);
  });
});
