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
    steps,
    updated_at: updatedAt,
  }));
  const { error } = await supabase.from('daily_steps').upsert(rows, { onConflict: 'user_id,day' });
  if (error) throw error;
}

export type Period = 'today' | 'week';

/** Inclusive local-day range for a leaderboard period. */
export function periodRange(period: Period) {
  const end = new Date();
  const start = new Date(end);
  if (period === 'week') start.setDate(start.getDate() - 6);
  return { fromDay: dayKey(start), toDay: dayKey(end) };
}

export type LeaderboardRow = {
  user_id: string;
  display_name: string | null;
  /** Raw JSON from the database; run it through normalizeAvatar() before drawing. */
  avatar: unknown;
  total_steps: number;
};
