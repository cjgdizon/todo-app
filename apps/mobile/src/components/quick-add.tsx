import { parseQuickAdd } from "@todo/core";
import {
  describeRecurrence,
  formatDue,
  taskInputFromQuickAdd,
  useCreateTask,
  useData,
  useLabels,
  useProjects,
} from "@todo/data";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";
import { useNotice } from "./notice";

export interface QuickAddDefaults {
  /** Where a task goes when the text names no `#project`. */
  projectId: string | null;
  /** Give a task without a date today's date (the Today tab). */
  dueToday: boolean;
}

/** The add-a-task bar. Reads dates, repeats, priority, #project and @label from the text as you type. */
export function QuickAdd({ defaults }: { defaults: QuickAddDefaults }) {
  const theme = useTheme();
  const { timeZone } = useData();
  const projects = useProjects();
  const labels = useLabels();
  const { create } = useCreateTask();
  const { notify } = useNotice();
  const [text, setText] = useState("");

  const parsed = useMemo(() => {
    const now = new Date();
    const plain = parseQuickAdd(text, { now, timeZone });
    // In the Today tab a task with no date of its own is due today.
    if (defaults.dueToday && plain.title && !plain.due) return parseQuickAdd(`${text} today`, { now, timeZone });
    return plain;
  }, [text, timeZone, defaults.dueToday]);

  const understood: string[] = [];
  if (parsed.due) understood.push(formatDue({ dueAt: parsed.due.at, dueAllDay: parsed.due.allDay }, { now: new Date(), timeZone }).label);
  if (parsed.rrule) understood.push(describeRecurrence(parsed.rrule, parsed.recurAfterCompletion));
  if (parsed.priority) understood.push(`P${parsed.priority}`);
  if (parsed.project) understood.push(`#${parsed.project}`);
  for (const label of parsed.labels) understood.push(`@${label}`);

  const ready = projects.data !== undefined && labels.data !== undefined;

  async function submit() {
    const input = taskInputFromQuickAdd(parsed, {
      projects: projects.data ?? [],
      labels: labels.data ?? [],
      timeZone,
    });
    if (!input) return;
    const submitted = text;
    setText("");
    try {
      await create({ ...input, projectId: input.projectId ?? (parsed.project ? null : defaults.projectId) });
      if (input.unknownProject) {
        notify(`There is no project named "${input.unknownProject}", so the task is in your Inbox.`);
      }
    } catch {
      setText(submitted);
      notify("Couldn't add that task. Try again.", { tone: "error" });
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.bar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {understood.length > 0 && (
          <Text style={[styles.preview, { color: theme["text-muted"] }]} accessibilityLiveRegion="polite">
            {understood.join(" · ")}
          </Text>
        )}
        <View style={styles.inputRow}>
          <TextInput
            testID="quick-add-input"
            accessibilityLabel="Add a task"
            placeholder="Add a task, e.g. Pay rent every 1st p2 #home"
            placeholderTextColor={theme["text-muted"]}
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => void submit()}
            returnKeyType="done"
            blurOnSubmit={false}
            style={[styles.input, { color: theme.text, backgroundColor: theme["surface-subtle"] }]}
          />
          <Pressable
            testID="quick-add-submit"
            accessibilityRole="button"
            accessibilityLabel="Add task"
            accessibilityState={{ disabled: !ready || !parsed.title }}
            disabled={!ready || !parsed.title}
            onPress={() => void submit()}
            style={[styles.add, { backgroundColor: theme.accent, opacity: ready && parsed.title ? 1 : 0.5 }]}
          >
            <Text style={[styles.addLabel, { color: theme["on-accent"] }]}>Add</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: 1, padding: space.sm, gap: space.xs },
  preview: { fontSize: 14, lineHeight: 20, paddingHorizontal: space.xs },
  inputRow: { flexDirection: "row", gap: space.sm },
  input: { flex: 1, minHeight: TOUCH, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16 },
  add: { minHeight: TOUCH, minWidth: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  addLabel: { fontSize: 16, fontWeight: "600" },
});
