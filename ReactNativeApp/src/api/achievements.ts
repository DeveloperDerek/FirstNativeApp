import type {
  EarnedAchievement,
  MyAchievements,
  NewAchievement,
} from '@/achievements/achievements';
import { supabase } from '@/lib/supabase';

// Achievements (step-tracker-achievements.txt). The server decides what's
// earned, from the uploaded days, goals and quests; the app only reads it
// and says when it has shown the message.

/** Yours: what's earned and, while you share, how far along the rest are. */
export async function getMyAchievements(): Promise<MyAchievements> {
  const { data, error } = await supabase.rpc('my_achievements');
  if (error) throw error;
  return data;
}

/** Yours not shown yet, oldest first. */
export async function getNewAchievements(): Promise<NewAchievement[]> {
  const { data, error } = await supabase.rpc('new_achievements');
  if (error) throw error;
  return data;
}

/** The message with these has been shown. Safe to repeat. */
export async function markAchievementsSeen(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('mark_achievements_seen', { ids });
  if (error) throw error;
}

/**
 * Someone's earned ones for their player card: ids and days only. null for
 * anyone who isn't you or a friend you can see (group mates come through
 * group_member_card instead).
 */
export async function getPlayerAchievements(personId: string): Promise<EarnedAchievement[] | null> {
  const { data, error } = await supabase.rpc('player_achievements', { person: personId });
  if (error) throw error;
  return data;
}
