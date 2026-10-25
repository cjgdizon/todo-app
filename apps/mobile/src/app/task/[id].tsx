import { instantToLocal, localToInstant, snoozeTarget } from "@todo/core";
import {
  describeRecurrence,
  useCompleteTask,
  useData,
  useTasks,
  useTrashTask,
  useUpdateTask,
  type Task,
  type TaskChange,
} from "@todo/data";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useNotice } from "@/components/notice";
import { ReminderChips } from "@/components/reminder-chips";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tasks = useTasks();
  const theme = useTheme();
  const task = tasks.data?.find((t) => t.id === id);

  if (!task) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.bg }]}>
        <Text style={{ color: theme["text-muted"] }}>{tasks.isPending ? "Loading…" : "This task is no longer here."}</Text>
      </View>
    );
  }
  return <Details key={task.id} task={task} />;
}

function Details({ task }: { task: Task }) {
  const theme = useTheme();
  const router = useRouter();
  const { timeZone } = useData();
  const update = useUpdateTask();
  const completeTask = useCompleteTask();
  const trashTask = useTrashTask();
  const { notify } = useNotice();

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  // The task can change under the open screen (refreshed from the server, or edited on another device).
  // A field the user has not touched follows the new value; one being edited stays.
  const [synced, setSynced] = useState({ title: task.title, notes: task.notes ?? "" });
  if (synced.title !== task.title || synced.notes !== (task.notes ?? "")) {
    if (title === synced.title) setTitle(task.title);
    if (notes === synced.notes) setNotes(task.notes ?? "");
    setSynced({ title: task.title, notes: task.notes ?? "" });
  }

  const save = (change: TaskChange) =>
    update.mutate(
      { id: task.id, change },
      { onError: () => notify("Couldn't save that change. Try again.", { tone: "error" }) },
    );

  const today = localToInstant(instantToLocal(new Date(), timeZone).date, null, timeZone);
  const due = task.dueAt ? instantToLocal(task.dueAt, timeZone) : null;
  const dueText = due ? `${due.date}${task.dueAllDay ? "" : ` ${due.time}`}` : "No date";

  async function complete() {
    const result = await completeTask(task);
    notify(result.kind === "advance" ? "Moved to the next date." : "Task completed.", {
      action: { label: "Undo", run: result.undo },
    });
    router.back();
  }

  function remove() {
    Alert.alert("Delete this task?", "Its subtasks are deleted too. You can undo right after.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void trashTask(task).then((result) => {
            notify(result.count > 1 ? `Deleted "${task.title}" and its subtasks.` : `Deleted "${task.title}".`, {
              action: { label: "Undo", run: result.undo },
            });
            router.back();
          });
        },
      },
    ]);
  }

  const field = [styles.field, { color: theme.text, backgroundColor: theme["surface-subtle"], borderColor: theme.border }];
  const chip = (selected: boolean) => [
    styles.chip,
    { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme["accent-subtle"] : "transparent" },
  ];

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "Task" }} />

      <Text style={[styles.label, { color: theme["text-muted"] }]}>Title</Text>
      <TextInput
        accessibilityLabel="Title"
        value={title}
        onChangeText={setTitle}
        onEndEditing={() => {
          const next = title.trim();
          if (next && next !== task.title) save({ title: next });
          else setTitle(task.title);
        }}
        style={field}
      />

      <Text style={[styles.label, { color: theme["text-muted"] }]}>Notes</Text>
      <TextInput
        accessibilityLabel="Notes"
        value={notes}
        onChangeText={setNotes}
        onEndEditing={() => notes !== (task.notes ?? "") && save({ notes })}
        multiline
        textAlignVertical="top"
        style={[...field, styles.notes]}
      />

      <Text style={[styles.label, { color: theme["text-muted"] }]}>Priority</Text>
      <View style={styles.chips}>
        {([1, 2, 3, 4] as const).map((p) => (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityLabel={p === 4 ? "No priority" : `Priority ${p}`}
            accessibilityState={{ selected: task.priority === p }}
            onPress={() => save({ priority: p })}
            style={chip(task.priority === p)}
          >
            <Text style={{ color: theme.text, fontWeight: "600" }}>{p === 4 ? "None" : `P${p}`}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.label, { color: theme["text-muted"] }]}>Due: {dueText}</Text>
      <View style={styles.chips}>
        <Pressable
          accessibilityRole="button"
          onPress={() => today && save({ dueAt: today, dueAllDay: true, dueTz: timeZone })}
          style={chip(false)}
        >
          <Text style={{ color: theme.text, fontWeight: "600" }}>Today</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => save(snoozeTarget(task, new Date(), timeZone))}
          style={chip(false)}
        >
          <Text style={{ color: theme.text, fontWeight: "600" }}>Tomorrow</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: task.dueAt === null }}
          disabled={task.dueAt === null}
          onPress={() => save({ dueAt: null, dueAllDay: false, dueTz: null, rrule: null, recurAfterCompletion: false })}
          style={[...chip(false), { opacity: task.dueAt === null ? 0.5 : 1 }]}
        >
          <Text style={{ color: theme.text, fontWeight: "600" }}>No date</Text>
        </Pressable>
      </View>
      {task.rrule && (
        <Text style={{ color: theme["text-muted"] }}>Repeats: {describeRecurrence(task.rrule, task.recurAfterCompletion)}</Text>
      )}

      <ReminderChips task={task} />

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void complete()}
          style={[styles.primary, { backgroundColor: theme.accent }]}
        >
          <Text style={{ color: theme["on-accent"], fontWeight: "600", fontSize: 16 }}>Complete</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={remove} style={styles.danger}>
          <Text style={{ color: theme.danger, fontWeight: "600" }}>Delete</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  missing: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg },
  content: { padding: space.md, gap: space.sm },
  label: { fontSize: 14, lineHeight: 20, marginTop: space.sm },
  field: { minHeight: TOUCH, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 16 },
  notes: { minHeight: 120 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minHeight: TOUCH, minWidth: TOUCH, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  actions: { marginTop: space.lg, gap: space.sm },
  primary: { minHeight: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  danger: { minHeight: TOUCH, alignItems: "center", justifyContent: "center" },
});
