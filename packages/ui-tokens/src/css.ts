import { colors, motion, radius, shadows } from "./tokens.ts";

function block(theme: "light" | "dark", indent: string): string {
  const lines = Object.entries(colors[theme]).map(([name, value]) => `${indent}--${name}: ${value};`);
  lines.push(`${indent}--shadow-popover: ${shadows[theme]};`);
  return lines.join("\n");
}

/**
 * The CSS custom properties for both themes. Light is the default; dark follows
 * the system unless the page opts out with `data-theme="light"`, and
 * `data-theme="dark"` forces dark. Output is committed as `tokens.css`.
 */
export function toCss(): string {
  const shared = [
    ...Object.entries(radius).map(([name, value]) => `  --radius-${name}: ${value};`),
    ...Object.entries(motion.duration).map(([name, value]) => `  --duration-${name}: ${value};`),
    ...Object.entries(motion.easing).map(([name, value]) => `  --ease-${name}: ${value};`),
  ].join("\n");

  return `/* Generated from src/tokens.ts by scripts/generate-css.ts. Do not edit. */
:root {
${block("light", "  ")}
${shared}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${block("dark", "    ")}
  }
}

:root[data-theme="dark"] {
${block("dark", "  ")}
}
`;
}
