import { describe, expect, it } from "vitest";
import { REMINDER_PRESETS, reminderLabel } from "./reminder-text.ts";

describe("reminderLabel", () => {
  it.each([
    [0, "At due time"],
    [1, "1 minute before"],
    [10, "10 minutes before"],
    [60, "1 hour before"],
    [90, "90 minutes before"],
    [120, "2 hours before"],
    [1440, "1 day before"],
    [2880, "2 days before"],
  ])("words %i minutes as %s", (minutes, text) => {
    expect(reminderLabel(minutes)).toBe(text);
  });
});

describe("REMINDER_PRESETS", () => {
  it("offers a short, ordered list that uses the same wording", () => {
    expect(REMINDER_PRESETS.map((p) => p.offsetMin)).toEqual([0, 10, 60, 1440]);
    for (const preset of REMINDER_PRESETS) expect(preset.label).toBe(reminderLabel(preset.offsetMin));
  });
});
