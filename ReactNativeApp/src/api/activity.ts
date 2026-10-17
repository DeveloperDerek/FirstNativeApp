import type { ActivityCursor, ActivityLine } from '@/activity/activity';
import { myToday } from '@/api/steps';
import { supabase } from '@/lib/supabase';

/**
 * A page of the activity board in Friends (step-tracker-activity-board.txt):
 * yours and your friends' lines, newest first, 30 days back. Without a
 * cursor, the first page; with one, the page after that line.
 */
export async function friendsActivity(after?: ActivityCursor | null): Promise<ActivityLine[]> {
  const { data, error } = await supabase.rpc('friends_activity', {
    my_today: myToday(),
    ...(after ? { before_day: after.day, before_at: after.at, before_id: after.user_id } : {}),
  });
  if (error) throw error;
  return data as ActivityLine[];
}
