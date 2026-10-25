import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import type { TodoClient } from "@todo/data";
import { Platform } from "react-native";

// A reminder that arrives while the app is open still shows, instead of being swallowed.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Asks for notification permission and registers this device with the server, so reminders (M6)
 * can reach it. Does nothing where it cannot work: simulators, a denied permission, a build without
 * an EAS project id (`eas init`), or Expo Go (remote push is not available there).
 */
export async function registerDevice(client: TodoClient): Promise<void> {
  if (!Device.isDevice) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== "string") return;

  try {
    if (Platform.OS === "android") {
      // The sender names this channel (`channelId` in @todo/core reminders), so it must exist.
      await Notifications.setNotificationChannelAsync("reminders", {
        name: "Reminders",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;

    const device = await Notifications.getExpoPushTokenAsync({ projectId });
    const platform = Platform.OS === "ios" ? "ios" : "android";
    const { error } = await client.rpc("register_push_token", { p_token: device.data, p_platform: platform });
    if (error) throw new Error(error.message);
  } catch {
    // Registration is best effort and retried at every launch: a failure here (Expo Go, no network,
    // no Google services) must never get in the user's way.
  }
}
