import { DarkTheme, DefaultTheme, Tabs, ThemeProvider } from "expo-router";
import { useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, useTheme } from "@/lib/theme";

export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // The gaps around the floating dock show the navigator background, so it must match the app theme.
  const base = useColorScheme() === "dark" ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background: theme.bg } }}>
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        sceneStyle: { backgroundColor: theme.bg },
        // A rounded dock floating above the screen edge.
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          borderWidth: 1,
          borderTopWidth: 1,
          borderRadius: 24,
          height: 68,
          marginHorizontal: 14,
          // Stay clear of the home indicator / system gesture area.
          marginBottom: insets.bottom + 8,
          paddingBottom: 0,
        },
        tabBarActiveTintColor: theme["accent-strong"],
        tabBarInactiveTintColor: theme["text-muted"],
        // Labels only: the five destinations are few and the words are clearer than icons.
        tabBarIcon: () => null,
        tabBarIconStyle: { display: "none" },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 13 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Inbox" }} />
      <Tabs.Screen name="today" options={{ title: "Today" }} />
      <Tabs.Screen name="upcoming" options={{ title: "Upcoming" }} />
      <Tabs.Screen name="projects" options={{ title: "Projects" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
    </Tabs>
    </ThemeProvider>
  );
}
