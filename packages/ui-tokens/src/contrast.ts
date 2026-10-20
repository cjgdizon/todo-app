/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new RangeError(`Expected a #rrggbb colour, got "${hex}"`);
  const n = parseInt(match[1], 16);
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
