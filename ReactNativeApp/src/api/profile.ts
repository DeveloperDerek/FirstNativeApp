import { rethrow } from '@/api/register';
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

export async function updateDisplayName(userId: string, displayName: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', userId);
  // The server checks the name (BAD_DISPLAY_NAME, NAME_NOT_ALLOWED)
  if (error) rethrow(error);
}
