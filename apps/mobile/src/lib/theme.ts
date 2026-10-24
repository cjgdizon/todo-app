import { colors, type ColorName } from "@todo/ui-tokens";
import { useColorScheme } from "react-native";

/** The design tokens for the current light/dark setting (the same values the web app uses). */
export function useTheme(): Record<ColorName, string> {
  return colors[useColorScheme() === "dark" ? "dark" : "light"];
}

/** Colour of the P1 to P3 flags; P4 (no priority) has none. */
export function priorityColor(theme: Record<ColorName, string>, priority: number): string | null {
  if (priority === 1) return theme["priority-1"];
  if (priority === 2) return theme["priority-2"];
  if (priority === 3) return theme["priority-3"];
  return null;
}

export const space = { xs: 4, sm: 8, md: 16, lg: 24 } as const;
export const radius = { sm: 6, md: 10, lg: 16 } as const;
/** Minimum touch target (iOS 44pt, Android 48dp). */
export const TOUCH = 48;
