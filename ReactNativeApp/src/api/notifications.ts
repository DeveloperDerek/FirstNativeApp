import { supabase } from '@/lib/supabase';

export type NotificationCounts = {
  /** Pending requests sent TO you (never the ones you sent). */
  friendRequests: number;
  /** Quests in your groups waiting for your vote, deadline still ahead. */
  questVotes: number;
  /** Soonest deadline among those quests; null if none. */
  nextVoteDeadline: Date | null;
};

export const NO_COUNTS: NotificationCounts = {
  friendRequests: 0,
  questVotes: 0,
  nextVoteDeadline: null,
};

/** Every tab bar count in one trip (step-tracker-notifications.txt). */
export async function getNotificationCounts(): Promise<NotificationCounts> {
  const { data, error } = await supabase.rpc('notification_counts');
  if (error) throw error;
  const row = data as {
    friend_requests?: number;
    quest_votes?: number;
    next_vote_deadline?: string | null;
  } | null;
  return {
    friendRequests: row?.friend_requests ?? 0,
    questVotes: row?.quest_votes ?? 0,
    nextVoteDeadline: row?.next_vote_deadline ? new Date(row.next_vote_deadline) : null,
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
