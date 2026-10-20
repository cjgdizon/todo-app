import { describe, expect, it } from "vitest";
import { describeRecurrence, presetRule, PRESETS } from "./recurrence-text";

describe("describeRecurrence", () => {
  it.each([
    ["FREQ=DAILY", "Daily"],
    ["FREQ=DAILY;INTERVAL=3", "Every 3 days"],
    ["FREQ=WEEKLY", "Weekly"],
    ["FREQ=WEEKLY;INTERVAL=2", "Every 2 weeks"],
    ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "Weekdays"],
    ["FREQ=WEEKLY;BYDAY=MO,WE", "Weekly on Mon, Wed"],
    ["FREQ=MONTHLY", "Monthly"],
    ["FREQ=MONTHLY;BYMONTHDAY=15", "Monthly on day 15"],
    ["FREQ=MONTHLY;INTERVAL=3", "Every 3 months"],
    ["FREQ=YEARLY", "Yearly"],
  ])("describes %s as %s", (rule, text) => {
    expect(describeRecurrence(rule)).toBe(text);
  });

  it("falls back to a generic label for rules it cannot summarise", () => {
    expect(describeRecurrence("FREQ=MONTHLY;BYDAY=2TU")).toBe("Repeats");
  });

  it("appends 'after completion' for rules that count from the completion day", () => {
    expect(describeRecurrence("FREQ=DAILY;INTERVAL=3", true)).toBe("Every 3 days after completion");
  });
});

describe("presets", () => {
  it("maps each preset to a rule and back", () => {
    for (const preset of PRESETS) {
      expect(presetRule(preset.value)).toBe(preset.rule);
    }
    expect(presetRule("none")).toBeNull();
  });

  it("offers the common repeats", () => {
    expect(PRESETS.map((p) => p.value)).toEqual(["none", "daily", "weekdays", "weekly", "monthly", "yearly"]);
  });
});
