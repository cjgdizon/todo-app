import { StyleSheet, Text, View } from "react-native";
import { useSyncStatus } from "@/lib/offline";
import { getBackend } from "@/lib/supabase";
import { space, useTheme } from "@/lib/theme";

/** A quiet bar that says when edits are only on this phone (offline) or still being sent. */
export function SyncBanner() {
  const { online, pending } = useSyncStatus(getBackend().queue);
  const theme = useTheme();
  if (online && pending === 0) return null;

  const waiting = pending > 0 ? ` ${pending} ${pending === 1 ? "change is" : "changes are"} waiting to sync.` : "";
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.bar, { backgroundColor: theme["surface-subtle"], borderColor: theme.border }]}
    >
      <Text style={[styles.text, { color: theme["text-muted"] }]}>
        {online ? `Syncing…${waiting}` : `You're offline. Changes are saved on this phone and sync when you reconnect.${waiting}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: 1 },
  text: { fontSize: 14, lineHeight: 20 },
});
