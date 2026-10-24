import { snoozeTarget, type ViewContext } from "@todo/core";
import {
  describeRecurrence,
  formatDue,
  useCompleteTask,
  useData,
  useUpdateTask,
  type Task,
} from "@todo/data";
import { useRouter } from "expo-router";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { priorityColor, space, TOUCH, useTheme } from "@/lib/theme";
import { useNotice } from "./notice";
import { SwipeRow } from "./swipe-row";

interface TaskRowProps {
  task: Task;
  /** How deep the task sits under its parents (0 for top level). */
  depth: number;
  ctx: ViewContext;
}

/** One task: a checkbox, its title and a line of details. Swipe right to complete, left to snooze. */
export const TaskRow = memo(function TaskRow({ task, depth, ctx }: TaskRowProps) {
  const router = useRouter();
  const theme = useTheme();
  const { timeZone } = useData();
  const completeTask = useCompleteTask();
  const update = useUpdateTask();
  const { notify } = useNotice();

  async function complete() {
    try {
      const result = await completeTask(task);
      notify(result.kind === "advance" ? "Moved to the next date." : "Task completed.", {
        action: { label: "Undo", run: result.undo },
      });
    } catch {
      notify("Couldn't update that task. Try again.", { tone: "error" });
    }
  }

  function snooze() {
    const target = snoozeTarget(task, new Date(), timeZone);
    update.mutate(
      { id: task.id, change: target },
      { onError: () => notify("Couldn't snooze that task. Try again.", { tone: "error" }) },
    );
    notify("Snoozed to tomorrow.", {
      action: {
        label: "Undo",
        run: () => update.mutate({ id: task.id, change: { dueAt: task.dueAt, dueAllDay: task.dueAllDay, dueTz: task.dueTz } }),
      },
    });
  }

  const details: string[] = [];
  if (task.dueAt) details.push(formatDue({ dueAt: task.dueAt, dueAllDay: task.dueAllDay }, ctx).label);
  if (task.rrule) details.push(describeRecurrence(task.rrule, task.recurAfterCompletion));
  if (task.priority < 4) details.push(`P${task.priority}`);
  const flag = priorityColor(theme, task.priority);

  return (
    <SwipeRow rightLabel="Complete" onSwipeRight={() => void complete()} leftLabel="Snooze" onSwipeLeft={snooze}>
      <View style={[styles.row, { paddingLeft: space.sm + depth * space.lg }]}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`Complete: ${task.title}`}
          accessibilityState={{ checked: false }}
          onPress={() => void complete()}
          style={styles.check}
        >
          <View style={[styles.box, { borderColor: flag ?? theme["text-muted"] }]} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[task.title, ...details].join(", ")}
          accessibilityActions={[
            { name: "activate", label: "Open" },
            { name: "magicTap", label: "Complete" },
            { name: "longpress", label: "Snooze to tomorrow" },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "magicTap") void complete();
            else if (event.nativeEvent.actionName === "longpress") snooze();
          }}
          onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}
          style={styles.body}
        >
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
            {task.title}
          </Text>
          {details.length > 0 && (
            <Text style={[styles.details, { color: flag && task.priority < 3 ? flag : theme["text-muted"] }]}>
              {details.join(" · ")}
            </Text>
          )}
        </Pressable>
      </View>
    </SwipeRow>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", minHeight: TOUCH, paddingRight: space.md },
  check: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
  box: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  body: { flex: 1, minHeight: TOUCH, justifyContent: "center", paddingVertical: space.sm },
  title: { fontSize: 16, lineHeight: 22 },
  details: { fontSize: 14, lineHeight: 20 },
});
