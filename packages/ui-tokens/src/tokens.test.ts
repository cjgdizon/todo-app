import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast.ts";
import { toCss } from "./css.ts";
import { colors, type ColorName } from "./tokens.ts";

const themes = ["light", "dark"] as const;

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("colour tokens meet WCAG 2.2 AA", () => {
  // [foreground, background, minimum ratio]
  const pairs: [ColorName, ColorName, number][] = [
    ["text", "bg", 4.5],
    ["text", "surface", 4.5],
    ["text", "surface-subtle", 4.5],
    ["text-muted", "bg", 4.5],
    ["text-muted", "surface", 4.5],
    ["text-muted", "surface-subtle", 4.5],
    ["accent-strong", "bg", 4.5],
    ["accent-strong", "surface", 4.5],
    ["accent-strong", "accent-subtle", 4.5],
    ["text", "accent-subtle", 4.5],
    ["on-accent", "accent", 4.5],
    ["danger", "bg", 4.5],
    ["danger", "surface", 4.5],
    ["warning", "bg", 4.5],
    ["warning", "surface", 4.5],
    ["priority-1", "surface", 4.5],
    ["priority-2", "surface", 4.5],
    ["priority-3", "surface", 4.5],
    // UI boundaries and focus indicators need 3:1.
    ["accent", "bg", 3],
    ["focus-ring", "bg", 3],
    ["focus-ring", "surface", 3],
  ];

  for (const theme of themes) {
    for (const [fg, bg, min] of pairs) {
      it(`${theme}: ${fg} on ${bg} is at least ${min}:1`, () => {
        const ratio = contrastRatio(colors[theme][fg], colors[theme][bg]);
        expect(
          ratio,
          `${colors[theme][fg]} on ${colors[theme][bg]} = ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(min);
      });
    }
  }
});

describe("tokens.css", () => {
  it("is the committed output of toCss()", () => {
    const committed = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");
    expect(committed).toBe(toCss());
  });

  it("defines every colour for both themes and honours a manual override", () => {
    const css = toCss();
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain(':root:not([data-theme="light"])');
    for (const name of Object.keys(colors.light)) {
      expect(css).toContain(`--${name}:`);
    }
  });
});
