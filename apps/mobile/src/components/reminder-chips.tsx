import {
  DataError,
  REMINDER_PRESETS,
  reminderLabel,
  useClearReminder,
  useReminders,
  useSetReminder,
  type Task,
} from "@todo/data";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";
import { useNotice } from "./notice";

function messageFor(error: unknown): string {
  if (error instanceof DataError && /already passed/i.test(error.message)) {
    return "That time has already passed. Pick a later reminder, or a later due date.";
  }
  return "Couldn't save the reminder. Check your connection and try again.";
}

/** "Remind me" for the signed-in person: a notification on this phone before the task is due. */
export function ReminderChips({ task }: { task: Task }) {
  const theme = useTheme();
  const { notify } = useNotice();
  const reminder = useReminders().data?.find((item) => item.taskId === task.id);
  const setReminder = useSetReminder();
  const clearReminder = useClearReminder();
  if (!task.dueAt) return null;

  const onError = (error: unknown) => notify(messageFor(error), { tone: "error" });
  const chip = (selected: boolean) => [
    styles.chip,
    { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme["accent-subtle"] : "transparent" },
  ];
  const options: { offsetMin: number | null; label: string }[] = [
    { offsetMin: null, label: "None" },
    ...REMINDER_PRESETS,
    ...(reminder && !REMINDER_PRESETS.some((preset) => preset.offsetMin === reminder.offsetMin)
      ? [{ offsetMin: reminder.offsetMin, label: reminderLabel(reminder.offsetMin) }]
      : []),
  ];
  const current = reminder ? reminderLabel(reminder.offsetMin) : "None";

  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: theme["text-muted"] }]}>
        Reminder: {current}
        {reminder?.sent ? " (already sent)" : ""}
      </Text>
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = option.offsetMin === (reminder?.offsetMin ?? null);
          return (
            <Pressable
              key={option.label}
              accessibilityRole="button"
              accessibilityLabel={option.offsetMin === null ? "No reminder" : `Remind me: ${option.label}`}
              accessibilityState={{ selected }}
              onPress={() =>
                option.offsetMin === null
                  ? clearReminder.mutate(task.id, { onError })
                  : setReminder.mutate({ taskId: task.id, offsetMin: option.offsetMin }, { onError })
              }
              style={chip(selected)}
            >
              <Text style={{ color: theme.text, fontWeight: "600" }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  label: { fontSize: 14, lineHeight: 20, marginTop: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minHeight: TOUCH, minWidth: TOUCH, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
});
