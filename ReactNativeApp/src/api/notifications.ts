import { supabase } from '@/lib/supabase';

export type NotificationCounts = {
  /** Pending requests sent TO you (never the ones you sent). */
  friendRequests: number;
};

export const NO_COUNTS: NotificationCounts = { friendRequests: 0 };

/** Every tab bar count in one trip (step-tracker-notifications.txt, Phase 1). */
export async function getNotificationCounts(): Promise<NotificationCounts> {
  const { data, error } = await supabase.rpc('notification_counts');
  if (error) throw error;
  const row = data as { friend_requests?: number } | null;
  return { friendRequests: row?.friend_requests ?? 0 };
}
