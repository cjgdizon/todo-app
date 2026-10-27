import { describe, expect, it } from "vitest";
import { findMentions, MAX_MENTIONS, splitMentions } from "./mentions.ts";

const members = [
  { userId: "ana", displayName: "Ana" },
  { userId: "ana-maria", displayName: "Ana Maria" },
  { userId: "ben", displayName: "Ben Reyes" },
  { userId: "cj", displayName: "CJ" },
];

describe("findMentions", () => {
  it("finds members named with @", () => {
    expect(findMentions("Can you check this, @Ben Reyes?", members)).toEqual(["ben"]);
  });

  it("prefers the longest matching name", () => {
    expect(findMentions("@Ana Maria please look", members)).toEqual(["ana-maria"]);
    expect(findMentions("@Ana please look", members)).toEqual(["ana"]);
  });

  it("ignores case and lists each person once, in order of appearance", () => {
    expect(findMentions("@cj and @ANA and @cj again", members)).toEqual(["cj", "ana"]);
  });

  it("needs the @ at the start of a word and a whole name after it", () => {
    expect(findMentions("mail me at x@Ana.com", members)).toEqual([]);
    expect(findMentions("@Anabel is not here", members)).toEqual([]);
    expect(findMentions("Ana without the at sign", members)).toEqual([]);
    expect(findMentions("(@Ana) and ,@CJ.", members)).toEqual(["ana", "cj"]);
  });

  it("ignores names that cannot be matched safely and people who are not listed", () => {
    expect(findMentions("@ and @x and @", members)).toEqual([]);
    expect(findMentions("@Zed", members)).toEqual([]);
    expect(findMentions("@A", [{ userId: "a", displayName: "A" }])).toEqual([]);
  });

  it("stops at a sensible number of people", () => {
    const many = Array.from({ length: MAX_MENTIONS + 5 }, (_, i) => ({ userId: `u${i}`, displayName: `User${i}x` }));
    const body = many.map((member) => `@${member.displayName}`).join(" ");
    expect(findMentions(body, many)).toHaveLength(MAX_MENTIONS);
  });
});

describe("splitMentions", () => {
  it("cuts a comment into plain text and mentions, keeping every character", () => {
    const parts = splitMentions("Hi @Ben Reyes, and @CJ!", members);
    expect(parts).toEqual([
      { text: "Hi " },
      { text: "@Ben Reyes", userId: "ben" },
      { text: ", and " },
      { text: "@CJ", userId: "cj" },
      { text: "!" },
    ]);
    expect(parts.map((part) => part.text).join("")).toBe("Hi @Ben Reyes, and @CJ!");
  });

  it("returns the whole text when nobody is mentioned", () => {
    expect(splitMentions("Nothing here", members)).toEqual([{ text: "Nothing here" }]);
    expect(splitMentions("", members)).toEqual([]);
  });
});
