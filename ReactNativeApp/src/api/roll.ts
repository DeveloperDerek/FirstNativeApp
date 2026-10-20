import { myToday } from '@/api/steps';
import { findShopEntry } from '@/lib/shop-entries';
import { supabase } from '@/lib/supabase';
import { type PoolItem, type Prize, rarityOf } from '@/roll/roll';

// The daily roll (step-tracker-daily-roll.txt). The server picks the prize
// and pays it (supabase/migrations/*_daily_roll.sql); the app only shows it.

/**
 * Rolls today's prize, or returns the one already rolled (new = false), so
 * a second tap, a retry or a second phone never rolls twice.
 */
export async function rollDailyPrize(): Promise<Prize & { new: boolean }> {
  const { data, error } = await supabase.rpc('roll_daily_prize', { my_today: myToday() });
  if (error) throw error;
  const row = (data as (Prize & { new: boolean })[])[0];
  return { item_id: row.item_id, rarity: row.rarity, coins: row.coins, new: row.new };
}

/** The prize has been shown, so the next open doesn't show it again. */
export async function markRollSeen(): Promise<void> {
  const { error } = await supabase.rpc('mark_roll_seen', { my_today: myToday() });
  if (error) throw error;
}

/**
 * What the player could still win, for the reel's other tiles (they are
 * only for show): on sale, not an achievement item, not owned.
 */
export async function listRollPool(): Promise<PoolItem[]> {
  const [items, owned] = await Promise.all([
    supabase.from('shop_items').select('id, price').eq('active', true).is('unlocked_by', null),
    supabase.from('user_items').select('item_id'), // RLS: own rows only
  ]);
  if (items.error) throw items.error;
  if (owned.error) throw owned.error;
  const mine = new Set(owned.data.map((r) => r.item_id));
  return items.data
    // Only what this app can draw: an item it has no art for would be a blank tile
    .filter((r) => r.price !== null && !mine.has(r.id) && findShopEntry(r.id))
    .map((r) => ({ id: r.id, rarity: rarityOf(r.price) }));
}
