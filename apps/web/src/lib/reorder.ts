import { positionBetween, positionsBetween } from "@todo/core";

export interface PositionUpdate {
  id: string;
  position: string;
}

/**
 * New keys after moving `siblings[from]` to index `to`. `siblings` must be in
 * display order. Normally only the moved item gets a new key. If its new
 * neighbours have equal (or inverted) keys there is no room between them, so the
 * whole list is rebalanced. Returns [] when nothing moves.
 */
export function reorder(
  siblings: readonly { id: string; position: string }[],
  from: number,
  to: number,
): PositionUpdate[] {
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < siblings.length;
  if (from === to || !inRange(from) || !inRange(to)) return [];

  const order = [...siblings];
  const [moved] = order.splice(from, 1);
  if (!moved) return [];
  order.splice(to, 0, moved);

  const before = order[to - 1]?.position ?? null;
  const after = order[to + 1]?.position ?? null;
  try {
    return [{ id: moved.id, position: positionBetween(before, after) }];
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    const positions = positionsBetween(null, null, order.length);
    return order.map((item, index) => ({ id: item.id, position: positions[index] ?? item.position }));
  }
}
