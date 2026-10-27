import { useMembers, useUpdateTask, type Task } from "@todo/data";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";
import { useNotice } from "./notice";

/** Who the task is assigned to. Only shown once the workspace has more than one member. */
export function AssigneeChips({ task }: { task: Task }) {
  const theme = useTheme();
  const { notify } = useNotice();
  const members = useMembers().data ?? [];
  const update = useUpdateTask();
  if (members.length < 2) return null;

  const options: { userId: string | null; label: string }[] = [
    { userId: null, label: "Unassigned" },
    ...members.map((member) => ({ userId: member.userId, label: member.displayName })),
  ];
  const current = task.assigneeId ? (members.find((member) => member.userId === task.assigneeId)?.displayName ?? "Former member") : "Unassigned";

  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: theme["text-muted"] }]}>Assignee: {current}</Text>
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = option.userId === task.assigneeId;
          return (
            <Pressable
              key={option.userId ?? "none"}
              accessibilityRole="button"
              accessibilityLabel={option.userId === null ? "Unassign" : `Assign to ${option.label}`}
              accessibilityState={{ selected }}
              onPress={() =>
                update.mutate(
                  { id: task.id, change: { assigneeId: option.userId } },
                  { onError: () => notify("Couldn't save that change. Try again.", { tone: "error" }) },
                )
              }
              style={[
                styles.chip,
                { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme["accent-subtle"] : "transparent" },
              ]}
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
