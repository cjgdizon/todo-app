import { Tabs } from "expo-router";
import { useTheme } from "@/lib/theme";

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        sceneStyle: { backgroundColor: theme.bg },
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        tabBarActiveTintColor: theme["accent-strong"],
        tabBarInactiveTintColor: theme["text-muted"],
        // Labels only: the four destinations are few and the words are clearer than icons.
        tabBarIcon: () => null,
        tabBarIconStyle: { display: "none" },
        tabBarLabelStyle: { fontSize: 14, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Inbox" }} />
      <Tabs.Screen name="today" options={{ title: "Today" }} />
      <Tabs.Screen name="upcoming" options={{ title: "Upcoming" }} />
      <Tabs.Screen name="projects" options={{ title: "Projects" }} />
    </Tabs>
  );
}
