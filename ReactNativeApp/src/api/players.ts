import { normalizeAvatar } from '@/avatar/catalog';
import type { AvatarConfig } from '@/avatar/types';
import { supabase } from '@/lib/supabase';

export type PlayerProfile = {
  username: string;
  displayName: string | null;
  avatar: AvatarConfig;
  mapTheme: string | null;
};

/**
 * Someone's public profile for the player card. Only these columns on
 * purpose: never select('*'), since profiles also holds
 * sharing_consent_at, which other users have no reason to see.
 */
export async function loadPlayerProfile(userId: string): Promise<PlayerProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('username, display_name, avatar, map_theme')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return {
    username: data.username,
    displayName: data.display_name,
    avatar: normalizeAvatar(data.avatar),
    mapTheme: data.map_theme,
  };
}
