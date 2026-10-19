import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Alert, AppState } from 'react-native';

import { listOwnedItems } from '@/api/coins';
import { saveMapTheme } from '@/api/mapTheme';
import { useAuth } from '@/auth/AuthProvider';
import { preloadItemIcons } from '@/avatar/ItemIcon';
import { loadMyItems } from '@/avatar/my-items';
import { errorMessage } from '@/lib/error-message';
import { lightTheme } from '@/track/lighting';
import { DEFAULT_THEME_ID, getTheme, type MapTheme } from '@/track/themes';

import { useDayPhase } from './use-day-phase';

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
  // The character editor's lists and item art load now too, so it opens
  // with them.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    // The editor's lists include what's owned, so the maps unlock from the
    // same read. If they fail (the editor loads them itself), owned is
    // read on its own so maps still unlock.
    loadMyItems(userId)
      .then((items) => new Set(items.owned))
      .catch(() => listOwnedItems())
      .then((ids) => alive && setOwned({ userId, ids }))
      .catch(() => {});
    preloadItemIcons().catch(() => {}); // each icon loads its own if this fails
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

  // Lit for the time of day, so every page changes light with the clock
  const phase = useDayPhase();
  const theme = lightTheme(getTheme(pending ?? profile?.map_theme), phase);

  // Dev only: how long a map pick takes to reach the screen, from the tap
  // to the first frame after every page has redrawn (Metro log)
  const pickedAt = useRef<number | null>(null);
  useEffect(() => {
    const start = pickedAt.current;
    if (!__DEV__ || start === null) return;
    pickedAt.current = null;
    requestAnimationFrame(() => {
      console.log(`[map theme] ${theme.id} on screen in ${Math.round(performance.now() - start)} ms`);
    });
  }, [theme.id]);

  const pickTheme = useCallback(
    async (id: string) => {
      if (!userId || id === theme.id) return;
      if (__DEV__) pickedAt.current = performance.now();
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
