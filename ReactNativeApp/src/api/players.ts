import { myToday } from '@/api/steps';
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
  /** You blocked them (only known on a card opened from a group you share). */
  blockedByMe: boolean;
};

/**
 * Someone's public profile for the player card, or null when they aren't
 * available to you (blocked either way, or no longer active: the server
 * doesn't say which). Only these columns on purpose: never select('*'),
 * since profiles also holds sharing_consent_at, which other users have no
 * reason to see.
 */
export async function loadPlayerProfile(userId: string): Promise<PlayerProfile | null> {
  const [{ data, error }, lastSeen] = await Promise.all([
    supabase
      .from('profiles')
      .select('username, display_name, avatar, map_theme')
      .eq('id', userId)
      .maybeSingle(),
    loadLastSeen(userId),
  ]);
  if (error) throw error;
  if (!data) return null;
  return {
    username: data.username,
    displayName: data.display_name,
    avatar: normalizeAvatar(data.avatar),
    mapTheme: data.map_theme,
    lastSeen,
    blockedByMe: false,
  };
}

/**
 * The player card opened from a group: read through the server's group
 * function, which shows any member of a group you share, including
 * someone you blocked or who blocked you (decision 1).
 */
export async function loadGroupMemberCard(groupId: string, userId: string): Promise<PlayerProfile> {
  const { data, error } = await supabase.rpc('group_member_card', {
    gid: groupId,
    person: userId,
    my_today: myToday(),
  });
  if (error) throw error;
  return {
    username: data.username,
    displayName: data.display_name,
    avatar: normalizeAvatar(data.avatar),
    mapTheme: data.map_theme,
    lastSeen: data.last_seen ? new Date(data.last_seen) : null,
    blockedByMe: Boolean(data.blocked_by_me),
  };
}

// The database only answers for yourself and friends (group mates come
// through loadGroupMemberCard). A failure just hides the line rather than
// the whole card.
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
