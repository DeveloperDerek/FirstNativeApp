import { myToday } from '@/api/steps';
import { supabase } from '@/lib/supabase';

// The daily goal and streaks (step-tracker-goals-streaks.txt). A day's goal
// is the player's coin target for that day (GOAL-16); older days keep the
// goal they had then. The server works streaks out from the uploaded days.

export type MyGoal = {
  /** Today's goal: 7,000 to 10,000, different each day; reaching it pays the daily coins */
  today: number;
  /** Steps needed today for the daily coins: the same as today's goal (GOAL-16) */
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
