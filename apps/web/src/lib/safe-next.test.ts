import { describe, expect, it } from "vitest";
import { inviteLink, safeNext } from "./safe-next";

const token = "a".repeat(64);

describe("safeNext", () => {
  it("allows the invite page with a token", () => {
    expect(safeNext(`/join?token=${token}`)).toBe(`/join?token=${token}`);
  });

  it.each([
    null,
    "",
    "/inbox",
    "/join",
    "/join?token=",
    `/join?token=${token}&x=1`,
    `/join?token=${token}#frag`,
    "/join?token=has space",
    "/join?token=%2e%2e",
    `//evil.example/join?token=${token}`,
    `https://evil.example/join?token=${token}`,
    `/join/../login?token=${token}`,
    `/join?token=${"a".repeat(129)}`,
    "\\join?token=abc",
  ])("rejects %s", (value) => {
    expect(safeNext(value)).toBeNull();
  });
});

describe("inviteLink", () => {
  it("builds a link that safeNext accepts", () => {
    const link = new URL(inviteLink("https://todo.example", token));
    expect(link.origin).toBe("https://todo.example");
    expect(safeNext(link.pathname + link.search)).toBe(`/join?token=${token}`);
  });
});
