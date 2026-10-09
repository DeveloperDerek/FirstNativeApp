import { supabase } from '@/lib/supabase';

// Loading happens with the profile (profile.map_theme). The database
// refuses a paid map the user has not bought.
export async function saveMapTheme(userId: string, themeId: string) {
  const { error } = await supabase.from('profiles').update({ map_theme: themeId }).eq('id', userId);
  if (error) {
    throw new Error(
      error.message.includes('ITEM_NOT_OWNED')
        ? 'Buy this map in the shop first.'
        : 'Could not change the map. Try again.'
    );
  }
}
