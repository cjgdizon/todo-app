"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

function apply(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** The saved theme choice. "system" follows the OS; the pre-paint script in the layout applies light/dark. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {
      // Storage can be blocked (private windows); the theme then lasts for the session.
    }
  }, []);

  const cycle = useCallback(() => {
    setTheme((current) => {
      const next = NEXT[current];
      apply(next);
      try {
        if (next === "system") localStorage.removeItem("theme");
        else localStorage.setItem("theme", next);
      } catch {
        // See above.
      }
      return next;
    });
  }, []);

  return { theme, label: LABEL[theme], cycle };
}

export function ThemeToggle() {
  const { label, cycle } = useTheme();
  return (
    <button type="button" onClick={cycle} className="rounded-sm px-2 py-1 text-left text-sm text-text-muted">
      Theme: {label}
    </button>
  );
}
