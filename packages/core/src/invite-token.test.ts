import { describe, expect, it } from "vitest";
import { inviteTokenFrom } from "./invite-token.ts";

const token = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("inviteTokenFrom", () => {
  it("takes a bare invite code", () => {
    expect(inviteTokenFrom(token)).toBe(token);
    expect(inviteTokenFrom(`  ${token}\n`)).toBe(token);
  });

  it("takes the code out of a pasted invite link", () => {
    expect(inviteTokenFrom(`https://todo.example.com/join?token=${token}`)).toBe(token);
    expect(inviteTokenFrom(`todo.example.com/join?token=${token}&utm=x`)).toBe(token);
    expect(inviteTokenFrom(`Join me: https://todo.example.com/join?token=${token}`)).toBe(token);
  });

  it.each([
    "",
    "   ",
    "hello world",
    "https://todo.example.com/join",
    "https://todo.example.com/join?token=",
    "https://todo.example.com/join?token=has space",
    "../../etc/passwd",
    "a".repeat(129),
    "tok en",
    "<script>alert(1)</script>",
  ])("gives nothing for %j", (text) => {
    expect(inviteTokenFrom(text)).toBeNull();
  });
});
