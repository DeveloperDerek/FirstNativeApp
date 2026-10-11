// Sorting for the drag-to-arrange item rows in the character editor. The
// saved order lives in the database (api/itemOrder.ts).

/**
 * Sorts a row of items by the saved order. Items not in it yet (just
 * bought, or never moved) keep their default order after the ones that are.
 */
export function applyItemOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const placed = items.filter((x) => rank.has(x.id));
  placed.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...placed, ...items.filter((x) => !rank.has(x.id))];
}

/** The whole saved order after one row was rearranged into `rowIds`. */
export function mergeRowOrder(order: string[], rowIds: string[]): string[] {
  const row = new Set(rowIds);
  return [...order.filter((id) => !row.has(id)), ...rowIds];
}
