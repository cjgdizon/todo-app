import * as Haptics from "expo-haptics";

/** One light tap when a task is completed. Devices without haptics do nothing. */
export function completionTap(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

/** One selection tick when a swipe passes the point where releasing commits. */
export function thresholdTick(): void {
  Haptics.selectionAsync().catch(() => undefined);
}
