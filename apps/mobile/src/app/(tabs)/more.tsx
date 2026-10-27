import {
  describeActivity,
  formatMinutes,
  setActiveWorkspace,
  useActivity,
  useData,
  useMembers,
  useMemberships,
  useStats,
} from "@todo/data";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";

const WEEK = 7;
const ACTIVITY_SHOWN = 20;

export default function More() {
  const theme = useTheme();
  const { userId, workspaceId } = useData();
  const memberships = useMemberships().data ?? [];
  const members = useMembers().data ?? [];
  const activity = useActivity().data ?? [];
  const { completed, tracked, streak } = useStats(WEEK);
  const names = new Map(members.map((member) => [member.userId, member.displayName]));
  const total = (days: readonly { count: number }[]) => days.reduce((sum, day) => sum + day.count, 0);
  const muted = { color: theme["text-muted"] };

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={styles.content}>
      {memberships.length > 1 ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
            Workspace
          </Text>
          <View style={styles.chips}>
            {memberships.map((workspace) => {
              const selected = workspace.id === workspaceId;
              return (
                <Pressable
                  key={workspace.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to ${workspace.name}`}
                  accessibilityState={{ selected }}
                  onPress={() => setActiveWorkspace(userId, workspace.id)}
                  style={[
                    styles.chip,
                    { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme["accent-subtle"] : "transparent" },
                  ]}
                >
                  <Text style={{ color: theme.text, fontWeight: "600" }}>{workspace.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
          This week
        </Text>
        <Text style={{ color: theme.text, fontSize: 16 }}>
          Streak: {streak === 1 ? "1 day" : `${streak} days`}
        </Text>
        <Text style={{ color: theme.text, fontSize: 16 }}>Tasks done: {total(completed)}</Text>
        <Text style={{ color: theme.text, fontSize: 16 }}>Time tracked: {formatMinutes(total(tracked))}</Text>
        <Text style={muted}>A repeating task counts when you finish it for good, not when you move it to its next date.</Text>
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
          Activity
        </Text>
        {activity.length === 0 ? (
          <Text style={muted}>Nothing yet. Activity is recorded once someone else has joined this workspace.</Text>
        ) : (
          activity.slice(0, ACTIVITY_SHOWN).map((entry) => (
            <View key={entry.id} style={[styles.entry, { borderColor: theme.border }]}>
              <Text style={{ color: theme.text, fontSize: 16 }}>{describeActivity(entry, { me: userId, names })}</Text>
              <Text style={{ color: theme["text-muted"], fontSize: 13 }}>{entry.createdAt.toLocaleString()}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.md, gap: space.lg },
  section: { gap: space.sm },
  heading: { fontSize: 18, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minHeight: TOUCH, minWidth: TOUCH, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  entry: { gap: 2, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
});
