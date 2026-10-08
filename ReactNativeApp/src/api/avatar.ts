import { normalizeAvatar } from '@/avatar/catalog';
import type { AvatarConfig } from '@/avatar/types';
import { supabase } from '@/lib/supabase';

// Loading happens with the profile (see api/profile.ts), which runs the
// stored JSON through normalizeAvatar() so old or unknown ids still work.

export async function saveAvatar(userId: string, avatar: AvatarConfig) {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar: normalizeAvatar(avatar) })
    .eq('id', userId);
  if (error) throw error;
}
