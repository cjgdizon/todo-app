import "@/lib/polyfills";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Providers, useSession } from "@/components/providers";
import { useTheme } from "@/lib/theme";

export default function RootLayout() {
  return (
    <Providers>
      <StatusBar style="auto" />
      <RootStack />
    </Providers>
  );
}

/** Signed-in screens exist only while there is a session, sign-in only while there is not. */
function RootStack() {
  const theme = useTheme();
  const session = useSession();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Protected guard={session.status === "in"}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="project/[id]" options={{ title: "Project" }} />
        <Stack.Screen name="task/[id]" options={{ title: "Task", presentation: "modal" }} />
      </Stack.Protected>
      <Stack.Protected guard={session.status === "out"}>
        <Stack.Screen name="sign-in" options={{ title: "Sign in", headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
