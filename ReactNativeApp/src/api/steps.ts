import type { MyGoal, MyStreak } from '@/api/goals';
import type { MyQuest } from '@/api/quests';
import { pinned, type RequestAuth } from '@/lib/request-auth';
import { supabase } from '@/lib/supabase';
import { dayKey } from '@/storage/stepStore';

export type SyncResult = {
  /** Coins just paid for days over the coin target (0 if none) */
  earned: number;
  /** Group quests that need me; empty when not sharing */
  quests: MyQuest[];
  goal: MyGoal;
  streak: MyStreak;
};

/**
 * The refresh in one round trip (supabase/migrations/*_sync_day.sql):
 * uploads the daily totals, claims coins for them, and returns my quests,
 * goal and streak. The caller passes the last few days it just read from
 * HealthKit / Health Connect, so late-arriving watch data gets picked up,
 * or none when steps can't be read (then nothing is uploaded or claimed).
 * The database refuses an upload unless the user has consented. With
 * `auth`, the call is sent as the account the refresh started for.
 */
export async function syncDay(entries: [Date, number][], auth?: RequestAuth): Promise<SyncResult> {
  const days = entries.map(([date, steps]) => ({
    day: dayKey(date),
    // The database rejects days over 100,000 (an anti-cheat limit). Cap
    // here so one odd reading can't make the whole upload fail.
    steps: Math.min(steps, 100_000),
  }));
  const { data, error } = await pinned(
    supabase.rpc('sync_day', { my_today: myToday(), p_days: days }),
    auth
  );
  if (error) throw error;
  return data as SyncResult;
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

/** The leaderboard functions' rows, with total_steps as a number (bigint arrives as a number or string). */
export const toLeaderboardRows = (data: (Omit<LeaderboardRow, 'total_steps'> & { total_steps: number | string })[]) =>
  data.map((r): LeaderboardRow => ({ ...r, total_steps: Number(r.total_steps) }));
