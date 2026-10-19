import { myToday } from '@/api/steps';
import { supabase } from '@/lib/supabase';

export type NotificationCounts = {
  /** Pending requests sent TO you (never the ones you sent). */
  friendRequests: number;
  /** Quests in your groups waiting for your vote, deadline still ahead. */
  questVotes: number;
  /** Soonest deadline among those quests; null if none. */
  nextVoteDeadline: Date | null;
  /** Kudos on your lines you haven't been shown (step-tracker-kudos.txt). */
  newKudos: number;
};

export const NO_COUNTS: NotificationCounts = {
  friendRequests: 0,
  questVotes: 0,
  nextVoteDeadline: null,
  newKudos: 0,
};

/** Every tab bar count in one trip (step-tracker-notifications.txt). */
export async function getNotificationCounts(): Promise<NotificationCounts> {
  // The date is for new kudos, which are counted over the board's 30 days.
  // A server from before kudos has no such argument (PGRST202): ask the
  // old way, so the friend request badge still works.
  let { data, error } = await supabase.rpc('notification_counts', { my_today: myToday() });
  if (error?.code === 'PGRST202') ({ data, error } = await supabase.rpc('notification_counts'));
  if (error) throw error;
  const row = data as {
    friend_requests?: number;
    quest_votes?: number;
    next_vote_deadline?: string | null;
    new_kudos?: number;
  } | null;
  return {
    friendRequests: row?.friend_requests ?? 0,
    questVotes: row?.quest_votes ?? 0,
    nextVoteDeadline: row?.next_vote_deadline ? new Date(row.next_vote_deadline) : null,
    newKudos: row?.new_kudos ?? 0,
  };
}

/**
 * Calls onChange whenever a friend request sent to this user is created
 * or changes status (accepted, declined, cancelled), and every time the
 * live connection (re)connects, since updates sent while disconnected are
 * lost. Returns a function that stops listening.
 */
export function watchFriendRequests(userId: string, onChange: () => void): () => void {
  const filter = `addressee_id=eq.${userId}`;
  const channel = supabase
    .channel(`friend-requests:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friendships', filter }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friendships', filter }, onChange)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onChange();
    });
  return () => {
    supabase.removeChannel(channel);
  };
}
