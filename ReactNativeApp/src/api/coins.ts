import { supabase } from '@/lib/supabase';

// The app never writes coins or ownership directly. It only calls the
// database functions, which decide (supabase/migrations/*_coins_and_shop.sql).

export async function getBalance(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', userId)
    .maybeSingle(); // no row yet = 0 coins
  if (error) throw error;
  return data?.balance ?? 0;
}

/** Returns how many coins were just granted (0 if nothing new). Safe to call repeatedly. */
export async function claimDailyRewards(): Promise<number> {
  const { data, error } = await supabase.rpc('claim_daily_rewards');
  if (error) throw error;
  return data as number;
}

/**
 * The FULL pool of paid items and their prices. The character editor uses
 * it to know which items are locked; the Shop shows listDailyShop() instead.
 */
export async function listShopPrices(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('shop_items').select('id, price').eq('active', true);
  if (error) throw error;
  return Object.fromEntries(data.map((r) => [r.id, r.price]));
}

export type DailyShop = {
  items: { id: string; price: number }[];
  refreshesAt: Date | null;
};

/** Today's rotating selection, picked by the database and unique to this user. */
export async function listDailyShop(): Promise<DailyShop> {
  const { data, error } = await supabase.rpc('daily_shop');
  if (error) throw error;
  const rows = data as { id: string; price: number; refreshes_at: string }[];
  return {
    items: rows.map((r) => ({ id: r.id, price: r.price })),
    refreshesAt: rows.length ? new Date(rows[0].refreshes_at) : null,
  };
}

export async function listOwnedItems(): Promise<Set<string>> {
  return new Set(await listOwnedItemsInOrder());
}

/** Owned item ids, the first one bought first. */
export async function listOwnedItemsInOrder(): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_items') // RLS: own rows only
    .select('item_id')
    .order('acquired_at')
    .order('item_id'); // an admin's grant-all lands at one instant
  if (error) throw error;
  return data.map((r) => r.item_id);
}

/**
 * Check-in bonus for opening the app. granted = 0 means "not ready yet".
 * nextAt = null means the user is not sharing steps (no coins). Calling it
 * too often is harmless: the database answers "not yet".
 */
export async function claimCheckin(): Promise<{ granted: number; nextAt: Date | null }> {
  const { data, error } = await supabase.rpc('claim_checkin');
  if (error) throw error;
  const row = (data as { granted: number; next_at: string | null }[] | null)?.[0];
  return {
    granted: row?.granted ?? 0,
    nextAt: row?.next_at ? new Date(row.next_at) : null,
  };
}

export const SHOP_REFRESH_MS = 12 * 3_600_000; // matches refresh_shop()

/** When the next shop refresh is allowed. null = ready now. */
export async function getShopRefreshAt(userId: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from('wallets')
    .select('last_shop_refresh_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.last_shop_refresh_at) return null;
  const next = new Date(new Date(data.last_shop_refresh_at).getTime() + SHOP_REFRESH_MS);
  return next.getTime() > Date.now() ? next : null;
}

/**
 * Swaps today's shop for new items and pays the refresh bonus. refreshed =
 * false means it isn't ready yet; nextAt says when it is.
 */
export async function refreshShop(): Promise<{
  refreshed: boolean;
  granted: number;
  nextAt: Date;
}> {
  const { data, error } = await supabase.rpc('refresh_shop');
  if (error) throw error;
  const row = (data as { refreshed: boolean; granted: number; next_at: string }[])[0];
  return { refreshed: row.refreshed, granted: row.granted, nextAt: new Date(row.next_at) };
}

const MESSAGES: Record<string, string> = {
  NOT_ENOUGH_COINS: 'You do not have enough coins yet.',
  ALREADY_OWNED: 'You already own this item.',
  ITEM_NOT_FOR_SALE: 'This item is no longer available.',
  NOT_IN_TODAYS_SHOP: 'The shop just refreshed. This item is gone for now.',
  ITEM_NOT_OWNED: 'Your character is wearing an item you do not own. Pick a different one.',
};

/** Turns the database's error codes into something a person can read. */
export function coinErrorMessage(e: unknown, fallback: string): string {
  const message = (e as { message?: string } | null)?.message ?? '';
  const key = Object.keys(MESSAGES).find((k) => message.includes(k));
  return key ? MESSAGES[key] : fallback;
}

/** Returns the new balance. */
export async function purchaseItem(itemId: string): Promise<number> {
  const { data, error } = await supabase.rpc('purchase_item', { p_item: itemId });
  if (error) throw new Error(coinErrorMessage(error, 'Purchase failed. Try again.'));
  return data as number;
}
