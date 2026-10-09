import { normalizeAvatar } from '@/avatar/catalog';
import type { AvatarConfig } from '@/avatar/types';
import { supabase } from '@/lib/supabase';

export type PlayerProfile = {
  username: string;
  displayName: string | null;
  avatar: AvatarConfig;
  mapTheme: string | null;
  /** null = never seen, not sharing, or not someone you can see */
  lastSeen: Date | null;
};

/**
 * Someone's public profile for the player card. Only these columns on
 * purpose: never select('*'), since profiles also holds
 * sharing_consent_at, which other users have no reason to see.
 */
export async function loadPlayerProfile(userId: string): Promise<PlayerProfile> {
  const [{ data, error }, lastSeen] = await Promise.all([
    supabase
      .from('profiles')
      .select('username, display_name, avatar, map_theme')
      .eq('id', userId)
      .single(),
    loadLastSeen(userId),
  ]);
  if (error) throw error;
  return {
    username: data.username,
    displayName: data.display_name,
    avatar: normalizeAvatar(data.avatar),
    mapTheme: data.map_theme,
    lastSeen,
  };
}

// The database only answers for yourself, friends and group mates. A
// failure just hides the line rather than the whole card.
async function loadLastSeen(userId: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from('last_seen')
    .select('seen_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return new Date(data.seen_at);
}

/** Records that the signed-in user is using the app right now. */
export async function markSeen() {
  const { error } = await supabase.rpc('mark_seen');
  if (error) throw error;
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago" */
export function timeAgo(when: Date, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - when.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
