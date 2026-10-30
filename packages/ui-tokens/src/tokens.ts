/**
 * Design tokens from DESIGN.md ("Obsidian Today"). This module is the source of
 * truth: the web CSS (`tokens.css`) is generated from it and the mobile app
 * imports it directly. Change DESIGN.md first, then this file.
 */

const light = {
  bg: "#ffffff",
  surface: "#fafbfc",
  "surface-subtle": "#f2f4f6",
  border: "#e3e4e4",
  text: "#151a20",
  "text-muted": "#566069",
  accent: "#4a5565",
  "accent-strong": "#3b4553",
  "accent-subtle": "#e9ecf1",
  "on-accent": "#f5f7fa",
  danger: "#a83a2e",
  warning: "#8a5f0c",
  success: "#4a5565",
  "focus-ring": "#3b4553",
  "priority-1": "#a83a2e",
  "priority-2": "#8a5f0c",
  "priority-3": "#3f6f9e",
} as const;

export type ColorName = keyof typeof light;

const dark: Record<ColorName, string> = {
  bg: "#0c0d0f",
  surface: "#17191c",
  "surface-subtle": "#1f2225",
  border: "#2a2d31",
  text: "#ecedef",
  "text-muted": "#a6abb2",
  accent: "#b9c0cc",
  "accent-strong": "#dde2ea",
  "accent-subtle": "#1e2228",
  "on-accent": "#0e1116",
  danger: "#e5877d",
  warning: "#e0b35a",
  success: "#b9c0cc",
  "focus-ring": "#dde2ea",
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
