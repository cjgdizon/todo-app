import { PRIORITIES } from "@todo/core";
import { Stack } from "expo-router";
import { StyleSheet, Text, View, useColorScheme } from "react-native";

// Placeholder for M0: proves the mobile app resolves the shared @todo/core package.
// Replaced by the real inbox in M5.
export default function Home() {
  const dark = useColorScheme() === "dark";
  const text = dark ? "#E8EAE6" : "#1F2421";
  const muted = dark ? "#A1A8A1" : "#5F655F";

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Tasks" }} />
      <Text style={[styles.heading, { color: text }]}>Tasks</Text>
      <Text style={[styles.body, { color: muted }]}>
        Nothing here yet. Priorities available: {PRIORITIES.map((p) => `P${p}`).join(", ")}.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 24 },
  heading: { fontSize: 28, lineHeight: 36, fontWeight: "600" },
  body: { marginTop: 8, fontSize: 14, lineHeight: 20 },
});
