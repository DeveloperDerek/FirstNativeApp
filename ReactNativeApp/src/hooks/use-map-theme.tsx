import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { listOwnedItems } from '@/api/coins';
import { saveMapTheme } from '@/api/mapTheme';
import { useAuth } from '@/auth/AuthProvider';
import { errorMessage } from '@/lib/error-message';
import { DEFAULT_THEME_ID, getTheme, type MapTheme } from '@/track/themes';

type MapThemeState = {
  theme: MapTheme;
  /** Free (the village) or owned. */
  canUse: (id: string) => boolean;
  /** Switches every page at once; puts it back if the database refuses. */
  pickTheme: (id: string) => Promise<void>;
  /** Call after a shop purchase so a new map unlocks straight away. */
  refreshOwned: () => Promise<void>;
};

const MapThemeContext = createContext<MapThemeState>({
  theme: getTheme(DEFAULT_THEME_ID),
  canUse: (id) => id === DEFAULT_THEME_ID,
  pickTheme: async () => {},
  refreshOwned: async () => {},
});

/**
 * The signed-in user's map (background), shared by every page. The choice
 * itself comes with the profile; this adds which maps they own and a way
 * to change it. Signed out (sign-in screen) is always the free village.
 */
export function MapThemeProvider({ children }: { children: ReactNode }) {
  const { session, profile, reloadProfile } = useAuth();
  const userId = session?.user.id;
  // Owned items remember whose they are, so a previous account's maps never unlock.
  const [owned, setOwned] = useState<{ userId: string; ids: Set<string> } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const refreshOwned = useCallback(async () => {
    if (!userId) return;
    try {
      setOwned({ userId, ids: await listOwnedItems() });
    } catch {
      // keep what we had; the next refresh tries again
    }
  }, [userId]);

  // Load on sign-in, and again whenever the app returns to the foreground.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    listOwnedItems()
      .then((ids) => alive && setOwned({ userId, ids }))
      .catch(() => {});
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshOwned();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [userId, refreshOwned]);

  const ownedIds = owned && owned.userId === userId ? owned.ids : null;
  const canUse = useCallback(
    (id: string) => id === DEFAULT_THEME_ID || Boolean(ownedIds?.has(id)),
    [ownedIds]
  );

  const theme = getTheme(pending ?? profile?.map_theme);

  const pickTheme = useCallback(
    async (id: string) => {
      if (!userId || id === theme.id) return;
      setPending(id); // every page switches now
      try {
        await saveMapTheme(userId, id);
        await reloadProfile();
      } catch (e) {
        Alert.alert('Background not changed', errorMessage(e));
      } finally {
        setPending(null);
      }
    },
    [userId, theme.id, reloadProfile]
  );

  return (
    <MapThemeContext.Provider value={{ theme, canUse, pickTheme, refreshOwned }}>
      {children}
    </MapThemeContext.Provider>
  );
}

export const useMapTheme = () => useContext(MapThemeContext);
