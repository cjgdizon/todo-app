import { useCalendarIntegration, useDisconnectCalendar, useStartCalendarConnection } from "@todo/data";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";
import { useNotice } from "./notice";

/** Opt-in sync of tasks with due dates to a "Tasks" calendar in Google Calendar. */
export function CalendarSection() {
  const theme = useTheme();
  const { notify } = useNotice();
  const integration = useCalendarIntegration().data;
  const connect = useStartCalendarConnection();
  const disconnect = useDisconnectCalendar();
  const connected = integration?.enabled === true;

  async function onConnect() {
    try {
      // Google's sign-in happens in the browser; it returns to the web app's settings page.
      await Linking.openURL(await connect.mutateAsync());
    } catch {
      notify("Couldn't start the connection with Google. Check your connection and try again.", { tone: "error" });
    }
  }

  function onDisconnect() {
    const run = (removeEvents: boolean) =>
      disconnect.mutate(removeEvents, {
        onSuccess: () => notify(removeEvents ? "Disconnected, and the Tasks calendar was removed from Google." : "Disconnected. The events stay in Google."),
        onError: () => notify("Couldn't disconnect. Check your connection and try again.", { tone: "error" }),
      });
    Alert.alert("Disconnect Google Calendar?", "What should happen to the events in Google?", [
      { text: "Cancel", style: "cancel" },
      { text: "Keep them", onPress: () => run(false) },
      { text: "Remove them", style: "destructive", onPress: () => run(true) },
    ]);
  }

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
        Google Calendar
      </Text>
      <Text style={{ color: theme["text-muted"] }}>
        Optional. Tasks with a due date appear in a separate &ldquo;Tasks&rdquo; calendar, and changes to those events come back
        to the task. Your other calendars are never touched.
      </Text>
      {connected ? (
        <>
          <Text style={{ color: integration?.status === "error" ? theme.danger : theme.text }}>
            {integration?.status === "error"
              ? `⚠ ${integration.statusDetail ?? "Something went wrong."}`
              : `Connected${integration?.lastSyncedAt ? `. Last synced ${integration.lastSyncedAt.toLocaleString()}` : ". Syncing for the first time"}.`}
          </Text>
          <Pressable accessibilityRole="button" onPress={onDisconnect} style={styles.link}>
            <Text style={{ color: theme.danger, fontWeight: "600" }}>Disconnect</Text>
          </Pressable>
        </>
      ) : (
        <>
          {integration?.status === "revoked" ? (
            <Text style={{ color: theme.danger }}>⚠ {integration.statusDetail ?? "Google access was removed."}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: connect.isPending }}
            disabled={connect.isPending}
            onPress={() => void onConnect()}
            style={[styles.button, { backgroundColor: theme.accent, opacity: connect.isPending ? 0.5 : 1 }]}
          >
            <Text style={{ color: theme["on-accent"], fontWeight: "600" }}>
              {integration?.status === "revoked" ? "Connect again" : "Connect Google Calendar"}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  heading: { fontSize: 18, fontWeight: "600" },
  link: { minHeight: TOUCH, justifyContent: "center", alignSelf: "flex-start" },
  button: { minHeight: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: space.md },
});
