import { instantToLocal, type ViewContext } from "@todo/core";
import { nextUpTask, todayProgress, useCompleteTask, type Task } from "@todo/data";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { completionTap } from "@/lib/haptics";
import { fonts, space, TOUCH, useTheme } from "@/lib/theme";
import { useNotice } from "./notice";

/** Progress line and the Next up card at the top of the Today screen. */
export function TodaySummary({
  tasks,
  ctx,
  projectName,
}: {
  tasks: readonly Task[];
  ctx: ViewContext;
  projectName: (task: Task) => string | null;
}) {
  const theme = useTheme();
  const completeTask = useCompleteTask();
  const { notify } = useNotice();
  const { done, total } = todayProgress(tasks, ctx);
  if (total === 0) return null;

  const next = nextUpTask(tasks, ctx);
  const finished = done === total;

  async function complete(task: Task) {
    completionTap();
    try {
      const result = await completeTask(task);
      notify(result.kind === "advance" ? "Moved to the next date." : "Task completed.", {
        action: { label: "Undo", run: result.undo },
      });
    } catch {
      notify("Couldn't update that task. Try again.", { tone: "error" });
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={[styles.count, { color: theme["text-muted"] }]}>{`${done} of ${total} done`}</Text>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Tasks done today"
        accessibilityValue={{ min: 0, max: total, now: done }}
        style={[styles.track, { backgroundColor: theme.border }]}
      >
        <View style={[styles.fill, { backgroundColor: theme.accent, width: `${(done / total) * 100}%` }]} />
      </View>

      {finished ? (
        <Text accessibilityLiveRegion="polite" style={[styles.finished, { color: theme["text-muted"] }]}>
          Nothing left today
        </Text>
      ) : next ? (
        <View
          accessibilityLabel="Next up"
          style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <View style={styles.cardTop}>
            <Text style={[styles.label, { color: theme["text-muted"] }]}>Next up</Text>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`Complete next up: ${next.title}`}
              accessibilityState={{ checked: false }}
              onPress={() => void complete(next)}
              style={styles.check}
            >
              <View style={[styles.box, { borderColor: theme.accent }]} />
            </Pressable>
          </View>
          <Text style={[styles.time, { color: theme["accent-strong"] }]}>
            {next.dueAt ? instantToLocal(next.dueAt, ctx.timeZone).time : ""}
          </Text>
          <Text style={[styles.title, { color: theme.text }]}>{next.title}</Text>
          <Text style={[styles.meta, { color: theme["text-muted"] }]}>
            {[next.priority < 4 ? `P${next.priority}` : null, projectName(next)].filter(Boolean).join("  ")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.md },
  count: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, marginBottom: space.sm },
  track: { height: 2, borderRadius: 1, overflow: "hidden", marginBottom: space.md },
  fill: { height: "100%", borderRadius: 1 },
  finished: { fontFamily: fonts.serifLight, fontSize: 30, lineHeight: 36 },
  card: { borderRadius: 20, borderWidth: 1, padding: space.md + 4 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18 },
  check: { width: TOUCH, height: TOUCH, marginRight: -space.sm, marginTop: -space.sm, alignItems: "center", justifyContent: "center" },
  box: { width: 26, height: 26, borderRadius: 13, borderWidth: 2 },
  time: { fontFamily: fonts.serifLight, fontSize: 48, lineHeight: 48, marginTop: -space.sm },
  title: { fontFamily: fonts.serif, fontSize: 21, lineHeight: 26, marginTop: space.sm },
  meta: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, marginTop: space.sm },
});
