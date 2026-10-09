import { useAuth } from '@/auth/AuthProvider';
import { getTheme, type MapTheme } from '@/track/themes';

/** The signed-in user's chosen map theme (the village before sign-in). */
export function useMapTheme(): MapTheme {
  const { profile } = useAuth();
  return getTheme(profile?.map_theme);
}
