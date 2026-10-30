import "@/lib/polyfills";
import { Fraunces_300Light, Fraunces_400Regular } from "@expo-google-fonts/fraunces";
import { HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold } from "@expo-google-fonts/hanken-grotesk";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Providers, useSession } from "@/components/providers";
import { useOpenTaskFromNotification } from "@/lib/notification-taps";
import { fonts, useTheme } from "@/lib/theme";

// Keep the splash screen up until the fonts are ready, so text never jumps.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    [fonts.serifLight]: Fraunces_300Light,
    [fonts.serif]: Fraunces_400Regular,
    [fonts.sans]: HankenGrotesk_400Regular,
    [fonts.sansMedium]: HankenGrotesk_500Medium,
    [fonts.sansSemibold]: HankenGrotesk_600SemiBold,
  });
  // A font that fails to load falls back to the system font; the app still opens.
  const ready = loaded || error !== null;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

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
  useOpenTaskFromNotification(session.status === "in");
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
