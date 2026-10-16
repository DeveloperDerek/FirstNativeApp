import { myToday } from '@/api/steps';
import { supabase } from '@/lib/supabase';

// The daily goal and streaks (step-tracker-goals-streaks.txt). Everyone's
// goal is 10,000; the server keeps the goals of past days (from when people
// could pick their own) and works streaks out from the uploaded days.

export type MyGoal = {
  /** Today's goal: 10,000 (a past custom goal can still apply to the day it was removed) */
  today: number;
  /** Steps needed today for the daily coins: 7,000 to 10,000, different each day */
  coin_steps: number;
  /** The goal for each of the last 7 days, oldest first */
  recent: { day: string; goal: number }[];
};

export type MyStreak =
  | { sharing: false }
  | {
      sharing: true;
      current: number;
      best: number;
      today_done: boolean;
      goal_today: number;
    };

/** A friend's current streak; null if they don't share steps or aren't a friend. */
export async function getPlayerStreak(personId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('player_streak', {
    person: personId,
    my_today: myToday(),
  });
  if (error) throw error;
  return data;
}
