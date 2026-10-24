import { useProjects } from "@todo/data";
import { useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SyncBanner } from "@/components/sync-banner";
import { useSignOut } from "@/components/providers";
import { space, TOUCH, useTheme } from "@/lib/theme";

export default function Projects() {
  const theme = useTheme();
  const router = useRouter();
  const projects = useProjects();
  const signOut = useSignOut();

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SyncBanner />
      <FlatList
        data={projects.data ?? []}
        keyExtractor={(project) => project.id}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme["text-muted"] }]}>
            {projects.isPending ? "Loading…" : "No projects yet. Create one on the web app."}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Project: ${item.name}`}
            onPress={() => router.push({ pathname: "/project/[id]", params: { id: item.id } })}
            style={[styles.row, { borderBottomColor: theme.border }]}
          >
            <Text style={[styles.name, { color: theme.text }]}>{item.name}</Text>
          </Pressable>
        )}
        ListFooterComponent={
          <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.signOut}>
            <Text style={{ color: theme["text-muted"], fontWeight: "600" }}>Sign out</Text>
          </Pressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, lineHeight: 22 },
  empty: { padding: space.lg, textAlign: "center" },
  signOut: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.md, marginTop: space.lg },
});
