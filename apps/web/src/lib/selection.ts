/**
 * The selected set after a click on a row's checkbox. A plain click toggles that row. A
 * Shift-click selects everything from the anchor (the last row clicked) to this row,
 * keeping rows already selected. `order` is the rows in display order. Never mutates `selected`.
 */
export function toggleSelection(
  selected: ReadonlySet<string>,
  order: readonly string[],
  anchor: string | null,
  id: string,
  shift: boolean,
): Set<string> {
  const next = new Set(selected);
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(id);

  if (shift && from >= 0 && to >= 0) {
    const [start, end] = from <= to ? [from, to] : [to, from];
    for (const rangeId of order.slice(start, end + 1)) next.add(rangeId);
    return next;
  }
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
