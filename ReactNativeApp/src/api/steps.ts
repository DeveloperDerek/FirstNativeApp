import { supabase } from '@/lib/supabase';
import { dayKey } from '@/storage/stepStore';

/**
 * Upload daily totals. The caller passes the last few days it just read
 * from HealthKit / Health Connect, so late-arriving watch data gets
 * picked up. The database refuses this unless the user has consented.
 */
export async function syncSteps(userId: string, entries: [Date, number][]) {
  const updatedAt = new Date().toISOString();
  const rows = entries.map(([date, steps]) => ({
    user_id: userId,
    day: dayKey(date),
    // The database rejects days over 100,000 (an anti-cheat limit). Cap
    // here so one odd reading can't make the whole upload fail.
    steps: Math.min(steps, 100_000),
    updated_at: updatedAt,
  }));
  const { error } = await supabase.from('daily_steps').upsert(rows, { onConflict: 'user_id,day' });
  if (error) throw error;
}

export type Period = 'today' | 'week';

/**
 * The phone's local date, sent with a leaderboard period. The server
 * works out the days itself and only accepts a date that is "today"
 * somewhere on Earth (step-tracker-safety.txt, section 2).
 */
export const myToday = () => dayKey(new Date());

export type LeaderboardRow = {
  user_id: string;
  display_name: string | null;
  /** Raw JSON from the database; run it through normalizeAvatar() before drawing. */
  avatar: unknown;
  total_steps: number;
};
