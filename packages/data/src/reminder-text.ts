const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** How a reminder offset reads: "At due time", "1 hour before", "2 days before". */
export function reminderLabel(offsetMin: number): string {
  if (offsetMin === 0) return "At due time";
  if (offsetMin % 1440 === 0) return `${plural(offsetMin / 1440, "day")} before`;
  if (offsetMin % 60 === 0) return `${plural(offsetMin / 60, "hour")} before`;
  return `${plural(offsetMin, "minute")} before`;
}

/** The choices the apps offer. Other offsets still display, but only these can be picked. */
export const REMINDER_PRESETS: readonly { offsetMin: number; label: string }[] = [0, 10, 60, 1440].map((offsetMin) => ({
  offsetMin,
  label: reminderLabel(offsetMin),
}));
