import type { ActivityCursor, ActivityLine, Giver, NewKudos } from '@/activity/activity';
import { myToday } from '@/api/steps';
import { supabase } from '@/lib/supabase';

/**
 * A page of the activity board in Friends (step-tracker-activity-board.txt):
 * yours and your friends' lines, one per thing done, newest first, 30 days
 * back. Without a cursor, the first page; with one, the page after that line.
 */
export async function friendsActivity(after?: ActivityCursor | null): Promise<ActivityLine[]> {
  const { data, error } = await supabase.rpc('activity_feed', {
    my_today: myToday(),
    ...(after
      ? {
          before_day: after.day,
          before_at: after.at,
          before_id: after.user_id,
          before_kind: after.kind,
          before_ref: after.ref,
        }
      : {}),
  });
  if (error) throw error;
  return data as ActivityLine[];
}

// Kudos (step-tracker-kudos.txt, section 7)

/** Kudos on a friend's line. Returns the line's count. */
export async function giveKudos(line: ActivityLine): Promise<number> {
  const { data, error } = await supabase.rpc('give_kudos', {
    p_user: line.user_id,
    p_day: line.day,
    p_kind: line.kind,
    p_ref: line.ref,
    my_today: myToday(),
  });
  if (error) throw error;
  return data as number;
}

/** Who gave kudos on your own line, newest first. */
export async function lineKudos(line: ActivityLine): Promise<Giver[]> {
  const { data, error } = await supabase.rpc('line_kudos', {
    p_day: line.day,
    p_kind: line.kind,
    p_ref: line.ref,
    my_today: myToday(),
  });
  if (error) throw error;
  return data as Giver[];
}

/** Every kudos you haven't been shown, one entry per line. Marks nothing. */
export async function newKudos(): Promise<NewKudos> {
  const { data, error } = await supabase.rpc('new_kudos', { my_today: myToday() });
  if (error) throw error;
  return data as NewKudos;
}

/** The "New kudos" list was shown, up to its newest kudos (the list's up_to, as sent). */
export async function markKudosSeen(upTo: string): Promise<void> {
  const { error } = await supabase.rpc('mark_kudos_seen', { p_up_to: upTo });
  if (error) throw error;
}
