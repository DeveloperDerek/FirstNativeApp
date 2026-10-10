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

import {
  getNotificationCounts,
  NO_COUNTS,
  type NotificationCounts,
  watchFriendRequests,
} from '@/api/notifications';
import { useAuth } from '@/auth/AuthProvider';
import { setAppIconCount } from '@/notifications/push';

type CountsState = {
  counts: NotificationCounts;
  /** Ask the database again. Never throws; a failure keeps the last good counts. */
  refreshCounts: () => void;
};

const CountsContext = createContext<CountsState | null>(null);

type Loaded = { userId: string; counts: NotificationCounts };

/**
 * The red numbers on the tab bar (step-tracker-notifications.txt), shared
 * like the coin wallet. Refreshed on launch, on every return to the
 * foreground, by the Friends and Groups screens when they load or after
 * acting, live when a friend request to you changes (and on every
 * reconnect), and when the soonest quest vote deadline passes.
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

  // The app icon number. While the app is closed only a push can set it,
  // and nothing lowers it (a cancelled request leaves it stale), so it is
  // set to the real total whenever the counts load, and cleared on
  // sign-out.
  const iconTotal = current.friendRequests + current.questVotes;
  useEffect(() => {
    setAppIconCount(iconTotal);
  }, [iconTotal]);

  // Live while the app is open. Any change: just ask for the counts again.
  useEffect(() => {
    if (!userId) return;
    return watchFriendRequests(userId, refreshCounts);
  }, [userId, refreshCounts]);

  // Nothing on the server moves a quest on when its vote deadline passes,
  // so ask again the moment it does (the count only includes deadlines
  // still ahead).
  const deadline = current.nextVoteDeadline?.getTime();
  useEffect(() => {
    if (deadline === undefined) return;
    // A second late, so the server's clock is past it too. setTimeout
    // can't wait longer than about 24 days.
    const wait = Math.min(Math.max(deadline - Date.now() + 1000, 0), 2 ** 31 - 1);
    const t = setTimeout(refreshCounts, wait);
    return () => clearTimeout(t);
  }, [deadline, refreshCounts]);

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
