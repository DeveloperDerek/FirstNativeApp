import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { getNotificationCounts, NO_COUNTS, type NotificationCounts } from '@/api/notifications';
import { useAuth } from '@/auth/AuthProvider';

type CountsState = {
  counts: NotificationCounts;
  /** Ask the database again. Never throws; a failure keeps the last good counts. */
  refreshCounts: () => void;
};

const CountsContext = createContext<CountsState | null>(null);

type Loaded = { userId: string; counts: NotificationCounts };

/**
 * The red numbers on the tab bar (step-tracker-notifications.txt, Phase 1),
 * shared like the coin wallet. Refreshed on launch, on every return to the
 * foreground, and by the Friends screen when it loads or after accept /
 * decline.
 */
export function NotificationCountsProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const sharing = Boolean(profile?.sharing_consent_at);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // Only the newest answer wins: every request is numbered, and an answer
  // is kept only if it is still the latest one sent. Each answer is also
  // tagged with its account, so one from before a switch is never shown.
  const latest = useRef(0);

  // Never show a previous account's counts, even for a moment.
  const current = loaded && loaded.userId === userId ? loaded.counts : NO_COUNTS;

  const refreshCounts = useCallback(() => {
    if (!userId) return;
    const ticket = ++latest.current;
    getNotificationCounts()
      .then((counts) => {
        if (ticket !== latest.current) return;
        setLoaded({ userId, counts });
      })
      // Keep the last good counts; try again at the next natural moment.
      .catch(() => {});
  }, [userId]);

  // Sign-out or account change: clear at once, and outdate anything in flight.
  useEffect(
    () => () => {
      latest.current++;
      setLoaded(null);
    },
    [userId]
  );

  useEffect(() => {
    if (!userId) return;
    refreshCounts();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshCounts();
    });
    return () => sub.remove();
  }, [userId, sharing, refreshCounts]);

  return (
    <CountsContext.Provider value={{ counts: current, refreshCounts }}>
      {children}
    </CountsContext.Provider>
  );
}

export function useNotificationCounts() {
  const ctx = useContext(CountsContext);
  if (!ctx) throw new Error('useNotificationCounts must be used inside <NotificationCountsProvider>');
  return ctx;
}
