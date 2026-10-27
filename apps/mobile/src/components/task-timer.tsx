import { formatClock, formatMinutes, useStartTimer, useStopTimer, useTimeEntries, type Task } from "@todo/data";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";
import { useNotice } from "./notice";

const MS_PER_MINUTE = 60_000;

/** The current time in milliseconds, refreshed every second while `active` (for the running clock). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Time tracking for one task: start or stop a timer, and the total tracked so far. */
export function TaskTimer({ task }: { task: Task }) {
  const theme = useTheme();
  const { notify } = useNotice();
  const entries = useTimeEntries().data ?? [];
  const start = useStartTimer();
  const stop = useStopTimer();
  const running = entries.find((entry) => entry.endedAt === null);
  const onThisTask = running?.taskId === task.id;
  const now = useNow(onThisTask);

  const trackedMs = entries
    .filter((entry) => entry.taskId === task.id)
    .reduce((total, entry) => total + Math.max(0, (entry.endedAt?.getTime() ?? now) - entry.startedAt.getTime()), 0);
  const onError = () => notify("Couldn't update the timer. Try again.", { tone: "error" });

  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: theme["text-muted"] }]}>
        Tracked, last 31 days: {formatMinutes(trackedMs / MS_PER_MINUTE)}
        {onThisTask && running ? `  ·  running ${formatClock(now - running.startedAt.getTime())}` : ""}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={onThisTask ? "Stop timer" : "Start timer"}
        onPress={() =>
          onThisTask && running
            ? stop.mutate({ id: running.id, at: new Date() }, { onError })
            : start.mutate({ id: crypto.randomUUID(), taskId: task.id, at: new Date() }, { onError })
        }
        style={[styles.button, { backgroundColor: onThisTask ? "transparent" : theme.accent, borderColor: theme.accent }]}
      >
        <Text style={{ color: onThisTask ? theme.text : theme["on-accent"], fontWeight: "600" }}>
          {onThisTask ? "Stop timer" : "Start timer"}
        </Text>
      </Pressable>
      {running && !onThisTask ? (
        <Text style={{ color: theme["text-muted"] }}>Starting here stops the timer that is running on another task.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  label: { fontSize: 14, lineHeight: 20, marginTop: space.sm },
  button: { minHeight: TOUCH, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: space.md },
});
