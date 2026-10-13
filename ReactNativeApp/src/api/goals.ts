import { myToday } from '@/api/steps';
import { supabase } from '@/lib/supabase';

// Your daily goal and streaks (step-tracker-goals-streaks.txt). The server
// keeps the goal history and works streaks out from the uploaded days.

export type MyGoal = {
  /** Today's goal (10,000 until one is picked) */
  today: number;
  /** Steps needed today for the daily coins: 7,000 to 10,000, different each day */
  coin_steps: number;
  /** A change waiting to start, if any */
  upcoming: { goal: number; starts_on: string } | null;
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

export async function getMyGoal(): Promise<MyGoal> {
  const { data, error } = await supabase.rpc('my_goal', { my_today: myToday() });
  if (error) throw error;
  return data;
}

/** Saves a new goal; returns the day it starts ('YYYY-MM-DD'). */
export async function setDailyGoal(goal: number): Promise<string> {
  const { data, error } = await supabase.rpc('set_daily_goal', {
    p_goal: goal,
    my_today: myToday(),
  });
  if (error) throw error;
  return data;
}

export async function getMyStreak(): Promise<MyStreak> {
  const { data, error } = await supabase.rpc('my_streak', { my_today: myToday() });
  if (error) throw error;
  return data;
}

/** A friend's current streak; null if they don't share steps or aren't a friend. */
export async function getPlayerStreak(personId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('player_streak', {
    person: personId,
    my_today: myToday(),
  });
  if (error) throw error;
  return data;
}
