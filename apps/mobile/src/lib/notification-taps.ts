import { taskIdFromPush } from "@todo/core";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";

/**
 * Opens the task a reminder notification is about when the person taps it, whether the app was
 * closed, in the background or open. Only while signed in: a tap before that is dropped, never
 * remembered for the next person on the phone.
 */
export function useOpenTaskFromNotification(signedIn: boolean): void {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    if (!signedIn) return;
    handled.current = id;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const taskId = taskIdFromPush(response.notification.request.content.data);
    if (taskId) router.push({ pathname: "/task/[id]", params: { id: taskId } });
  }, [response, signedIn, router]);
}
