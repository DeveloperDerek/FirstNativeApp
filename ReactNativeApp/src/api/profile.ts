import { normalizeAvatar } from '@/avatar/catalog';
import type { AvatarConfig } from '@/avatar/types';
import { supabase } from '@/lib/supabase';

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  sharing_consent_at: string | null;
  avatar: AvatarConfig;
  /** Selected step-road map (a shop item id); see src/track/themes.ts. */
  map_theme: string;
};

export async function getMyProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, sharing_consent_at, avatar, map_theme')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return { ...data, avatar: normalizeAvatar(data.avatar) };
}

/** Usernames are 3-20 characters: lowercase letters, numbers, underscore. */
export const normalizeUsername = (raw: string) => raw.trim().toLowerCase();
export const isValidUsername = (username: string) => /^[a-z0-9_]{3,20}$/.test(username);

export async function updateProfile(
  userId: string,
  changes: { username: string; display_name: string }
) {
  const { error } = await supabase.from('profiles').update(changes).eq('id', userId);
  if (error?.code === '23505') throw new Error('That username is already taken.');
  if (error) throw error;
}
