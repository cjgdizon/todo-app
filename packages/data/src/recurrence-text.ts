const DAY_NAMES: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

const WEEKDAYS = "MO,TU,WE,TH,FR";

/** The repeat choices offered in the task editor. Anything else is shown as "Custom". */
export const PRESETS = [
  { value: "none", label: "Does not repeat", rule: null },
  { value: "daily", label: "Every day", rule: "FREQ=DAILY" },
  { value: "weekdays", label: "Every weekday", rule: `FREQ=WEEKLY;BYDAY=${WEEKDAYS}` },
  { value: "weekly", label: "Every week", rule: "FREQ=WEEKLY" },
  { value: "monthly", label: "Every month", rule: "FREQ=MONTHLY" },
  { value: "yearly", label: "Every year", rule: "FREQ=YEARLY" },
] as const;

export type PresetValue = (typeof PRESETS)[number]["value"];

export function presetRule(value: PresetValue): string | null {
  return PRESETS.find((p) => p.value === value)?.rule ?? null;
}

/** The preset that matches `rule` exactly, or "custom" (e.g. one typed in quick add). */
export function presetFor(rule: string | null): PresetValue | "custom" {
  if (rule === null) return "none";
  return PRESETS.find((p) => p.rule === rule)?.value ?? "custom";
}

const UNITS: Record<string, [singular: string, plural: string, every: string]> = {
  DAILY: ["day", "days", "Daily"],
  WEEKLY: ["week", "weeks", "Weekly"],
  MONTHLY: ["month", "months", "Monthly"],
  YEARLY: ["year", "years", "Yearly"],
};

/** A short summary of an RRULE ("Weekly on Mon, Wed"), or "Repeats" for rules it does not recognise. */
export function describeRecurrence(rule: string, afterCompletion = false): string {
  const parts = new Map<string, string>();
  for (const part of rule.split(";")) {
    const [key, value] = part.split("=");
    if (key && value) parts.set(key.toUpperCase(), value);
  }
  const suffix = afterCompletion ? " after completion" : "";

  const freq = parts.get("FREQ");
  const unit = freq ? UNITS[freq] : undefined;
  const known = ["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY"];
  if (!unit || [...parts.keys()].some((key) => !known.includes(key))) return "Repeats";

  const interval = Number(parts.get("INTERVAL") ?? "1");
  if (!Number.isInteger(interval) || interval < 1) return "Repeats";

  const byDay = parts.get("BYDAY");
  const days = byDay?.split(",") ?? [];
  if (days.some((day) => !(day in DAY_NAMES))) return "Repeats";

  let text: string;
  if (freq === "WEEKLY" && byDay === WEEKDAYS && interval === 1) {
    text = "Weekdays";
  } else if (interval > 1) {
    text = `Every ${interval} ${unit[1]}`;
    if (freq === "WEEKLY" && days.length > 0) text += ` on ${days.map((d) => DAY_NAMES[d]).join(", ")}`;
  } else if (freq === "WEEKLY" && days.length > 0) {
    text = `Weekly on ${days.map((d) => DAY_NAMES[d]).join(", ")}`;
  } else if (freq === "MONTHLY" && parts.has("BYMONTHDAY")) {
    text = `Monthly on day ${parts.get("BYMONTHDAY")}`;
  } else {
    text = unit[2];
  }
  return text + suffix;
}
