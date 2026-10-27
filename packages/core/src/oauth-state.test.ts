import { describe, expect, it } from "vitest";
import { signOAuthState, verifyOAuthState } from "./oauth-state.ts";

const secret = "a-long-random-server-secret-0123456789abcdef";
const now = new Date("2030-03-15T10:00:00Z");
const payload = { userId: "6f1c1d0e-3b1f-4c55-9a53-0a6c7a1c2d3e", workspaceId: "0b9f2a62-6a53-4d3c-8e6a-5b1f4c2d9e10" };

describe("OAuth state", () => {
  it("round-trips who is connecting and to which workspace", async () => {
    const state = await signOAuthState(payload, secret, now);
    expect(await verifyOAuthState(state, secret, new Date(now.getTime() + 60_000))).toEqual(payload);
  });

  it("is safe to put in a URL", async () => {
    const state = await signOAuthState(payload, secret, now);
    expect(state).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("is different every time, so one cannot be reused as another", async () => {
    expect(await signOAuthState(payload, secret, now)).not.toBe(await signOAuthState(payload, secret, now));
  });

  it("expires after ten minutes", async () => {
    const state = await signOAuthState(payload, secret, now);
    expect(await verifyOAuthState(state, secret, new Date(now.getTime() + 9 * 60_000))).toEqual(payload);
    expect(await verifyOAuthState(state, secret, new Date(now.getTime() + 11 * 60_000))).toBeNull();
  });

  it("is refused if the secret differs or any part was changed", async () => {
    const state = await signOAuthState(payload, secret, now);
    const later = new Date(now.getTime() + 1000);
    expect(await verifyOAuthState(state, "another-secret-another-secret-12345678", later)).toBeNull();

    const [body, signature] = state.split(".") as [string, string];
    const forged = JSON.stringify({ ...JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))), u: "someone-else" });
    const forgedBody = btoa(forged).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyOAuthState(`${forgedBody}.${signature}`, secret, later)).toBeNull();
    expect(await verifyOAuthState(`${body}.${signature.slice(0, -2)}AA`, secret, later)).toBeNull();
  });

  it.each(["", "nodot", "a.b.c", ".", "x.", ".y", "!!!.???", "e30.e30"])("rejects malformed state %j", async (state) => {
    expect(await verifyOAuthState(state, secret, now)).toBeNull();
  });

  it("refuses to sign with a weak secret", async () => {
    await expect(signOAuthState(payload, "short", now)).rejects.toThrow();
    expect(await verifyOAuthState("a.b", "short", now)).toBeNull();
  });
});
