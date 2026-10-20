import { describe, expect, it } from "vitest";
import { fromFloating, instantToLocal, localToInstant, toFloating, zoned } from "./zoned.ts";

describe("localToInstant", () => {
  it("reads a date and time in the given zone", () => {
    expect(localToInstant("2026-10-21", "09:00", "Asia/Manila")).toEqual(new Date("2026-10-21T01:00:00Z"));
  });

  it("uses the start of the local day when there is no time", () => {
    expect(localToInstant("2026-10-21", null, "Asia/Manila")).toEqual(new Date("2026-10-20T16:00:00Z"));
  });

  it("moves a time that does not exist (spring-forward gap) forward", () => {
    // 02:30 on 2026-03-08 never happens in New York; clocks jump from 02:00 to 03:00.
    expect(localToInstant("2026-03-08", "02:30", "America/New_York")).toEqual(
      new Date("2026-03-08T07:30:00Z"),
    );
  });

  it.each([
    ["banana", "09:00"],
    ["2026-13-40", "09:00"],
    ["2026-10-21", "25:00"],
    ["2026-10-21", "9am"],
    ["", null],
  ])("returns null for %s %s", (date, time) => {
    expect(localToInstant(date, time, "UTC")).toBeNull();
  });
});

describe("instantToLocal", () => {
  it("returns the wall-clock date and time in the zone", () => {
    expect(instantToLocal(new Date("2026-10-21T01:00:00Z"), "Asia/Manila")).toEqual({
      date: "2026-10-21",
      time: "09:00",
    });
  });

  it("rolls the date over for zones ahead of UTC", () => {
    expect(instantToLocal(new Date("2026-10-20T20:30:00Z"), "Asia/Manila")).toEqual({
      date: "2026-10-21",
      time: "04:30",
    });
  });

  it("round-trips with localToInstant", () => {
    const original = new Date("2026-11-05T14:45:00Z");
    const { date, time } = instantToLocal(original, "America/Los_Angeles");
    expect(localToInstant(date, time, "America/Los_Angeles")).toEqual(original);
  });
});

describe("floating time", () => {
  it("round-trips a wall-clock time through the floating representation", () => {
    const instant = new Date("2026-10-21T01:00:00Z");
    const floating = toFloating(zoned(instant, "Asia/Manila"));
    expect(floating.toISOString()).toBe("2026-10-21T09:00:00.000Z");
    expect(fromFloating(floating, "Asia/Manila")).toEqual(instant);
  });

  it("rejects an unknown time zone", () => {
    expect(() => zoned(new Date(), "Not/AZone")).toThrow(RangeError);
  });
});
