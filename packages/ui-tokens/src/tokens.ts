/**
 * Design tokens from DESIGN.md ("Calm minimal"). This module is the source of
 * truth: the web CSS (`tokens.css`) is generated from it and the mobile app
 * imports it directly. Change DESIGN.md first, then this file.
 */

const light = {
  bg: "#fafaf8",
  surface: "#ffffff",
  "surface-subtle": "#f4f4f1",
  border: "#e6e5e0",
  text: "#1f2421",
  "text-muted": "#5f655f",
  accent: "#3f7d6b",
  "accent-strong": "#2f6354",
  "accent-subtle": "#e4f0ec",
  "on-accent": "#ffffff",
  danger: "#b3382c",
  warning: "#9a6a12",
  success: "#3f7d6b",
  "focus-ring": "#2f6354",
  "priority-1": "#b3382c",
  "priority-2": "#9a6a12",
  "priority-3": "#3f6f9e",
} as const;

export type ColorName = keyof typeof light;

const dark: Record<ColorName, string> = {
  bg: "#121413",
  surface: "#1a1d1b",
  "surface-subtle": "#212522",
  border: "#2a2e2b",
  text: "#e8eae6",
  "text-muted": "#a1a8a1",
  accent: "#6fb5a0",
  "accent-strong": "#8ccbb7",
  "accent-subtle": "#1e2f29",
  "on-accent": "#0f1a16",
  danger: "#e5877d",
  warning: "#e0b35a",
  success: "#6fb5a0",
  "focus-ring": "#8ccbb7",
  "priority-1": "#e5877d",
  "priority-2": "#e0b35a",
  "priority-3": "#7fb0e0",
};

export const colors: Record<"light" | "dark", Record<ColorName, string>> = { light, dark };

/** Only popovers, dialogs and the command palette are elevated. */
export const shadows = {
  light: "0 8px 24px rgb(0 0 0 / 0.08)",
  dark: "0 8px 24px rgb(0 0 0 / 0.4)",
} as const;

export const radius = { sm: "6px", md: "10px", lg: "16px" } as const;

export const motion = {
  duration: { fast: "120ms", base: "180ms", slow: "240ms" },
  easing: { enter: "cubic-bezier(0.2, 0, 0, 1)", leave: "cubic-bezier(0.4, 0, 1, 1)" },
} as const;
