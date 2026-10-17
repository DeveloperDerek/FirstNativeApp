import { listOwnedItemsInOrder, listShopItemIds } from '@/api/coins';
import { getItemOrder } from '@/api/itemOrder';

// What the character editor needs to list someone's items, kept in memory
// so it opens with them already there. Fetched once the user signs in
// (MapThemeProvider), shown straight away, and fetched again each time the
// editor opens. Only ever handed back for the user it was loaded for.

export type MyItems = {
  /** Every item that needs owning; anything else is a free starter item */
  inShop: Set<string>;
  /** Owned items, in the order they were bought */
  owned: string[];
  /** The order the user dragged them into */
  order: string[];
};

let cache: { userId: string; items: MyItems } | null = null;
// Bumped by every local change, so an answer that left before it can't undo it
let version = 0;

/** The last lists loaded for this user, or null if there are none yet. */
export function cachedItems(userId: string): MyItems | null {
  return cache?.userId === userId ? cache.items : null;
}

/** Loads the lists from the database and keeps them. */
export async function loadMyItems(userId: string): Promise<MyItems> {
  const started = version;
  const [inShop, owned, order] = await Promise.all([
    listShopItemIds(),
    listOwnedItemsInOrder(),
    // Only the arrangement: without it items show in their default order
    getItemOrder(userId).catch(() => []),
  ]);
  const items = { inShop, owned, order };
  // A purchase, a drag or a sign-out happened meanwhile: what's kept is newer
  if (version !== started) return cachedItems(userId) ?? items;
  cache = { userId, items };
  return items;
}

/** Keeps a change made here (a new order) without waiting for a reload. */
export function setCachedItems(userId: string, items: MyItems) {
  version++;
  cache = { userId, items };
}

/** A purchase: the item shows in the editor straight away. */
export function addOwnedItem(userId: string, itemId: string) {
  const items = cachedItems(userId);
  if (!items || items.owned.includes(itemId)) return;
  setCachedItems(userId, { ...items, owned: [...items.owned, itemId] });
}

/** On sign-out, so nothing of theirs stays in memory. */
export function forgetMyItems() {
  version++;
  cache = null;
}
