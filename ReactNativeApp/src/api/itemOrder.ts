import { supabase } from '@/lib/supabase';

// The order the user dragged their items into in the character editor
// (supabase/migrations/*_item_order.sql). Only affects how tiles are
// listed; ownership is still checked by the database on every save.

export async function getItemOrder(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('item_order') // RLS: own row only
    .select('ids')
    .eq('user_id', userId)
    .maybeSingle(); // no row yet = never rearranged
  if (error) throw error;
  return data?.ids ?? [];
}

export async function saveItemOrder(userId: string, ids: string[]) {
  const { error } = await supabase
    .from('item_order')
    .upsert({ user_id: userId, ids, updated_at: new Date().toISOString() });
  if (error) throw error;
}
