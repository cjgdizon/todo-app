import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";

// Base colors from DESIGN.md. The full set moves to packages/ui-tokens in M2.
const colors = {
  light: { bg: "#FAFAF8", text: "#1F2421" },
  dark: { bg: "#121413", text: "#E8EAE6" },
} as const;

export default function RootLayout() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const { bg, text } = colors[scheme];

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: bg },
          headerTintColor: text,
          contentStyle: { backgroundColor: bg },
        }}
      />
    </>
  );
}
