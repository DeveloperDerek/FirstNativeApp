import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
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

import { getMyProfile, type Profile } from '@/api/profile';
import { getAccountStatus } from '@/api/register';
import { clearLocalUserData } from '@/auth/local-data';
import { type AccountStatus, type Route, routeFor } from '@/auth/route';
import { retryPendingRevocation, signOutOtherDevices } from '@/auth/password-change';
import { isSigningOut } from '@/auth/signIn';
import { supabase } from '@/lib/supabase';

type AuthState = {
  session: Session | null;
  /** Which screen to show; the root layout follows it (section 7). */
  route: Route;
  /** The server's answer for the signed-in user; null while loading or signed out. */
  account: AccountStatus | null;
  /** The signed-in user's profile row; null until they can use the app. */
  profile: Profile | null;
  reloadProfile: () => Promise<void>;
  /**
   * Asks the server again where this user stands. Shows the splash while
   * it waits only when `showLoading` is set (the "Try again" button);
   * otherwise the current screen stays, and a failure keeps it and throws.
   */
  reloadAccount: (showLoading?: boolean) => Promise<void>;
  /** The new password is saved, or the reset was cancelled. */
  endRecovery: () => Promise<void>;
  /** The server ended the session (not the person): say so on sign-in (8a). */
  signedOutByServer: boolean;
  /** Other devices may still be signed in after a password change (8d). */
  revocationPending: boolean;
  /** Signs out every other session now. True when done. */
  signOutOtherDevices: () => Promise<boolean>;
  /** After a password change: whether the other devices still need signing out. */
  setRevocationPending: (pending: boolean) => void;
};

const AuthContext = createContext<AuthState>({
  session: null,
  route: 'starting',
  account: null,
  profile: null,
  reloadProfile: async () => {},
  reloadAccount: async () => {},
  endRecovery: async () => {},
  signedOutByServer: false,
  revocationPending: false,
  signOutOtherDevices: async () => false,
  setRevocationPending: () => {},
});

type Loaded = {
  userId: string;
  account: AccountStatus | 'loading' | 'failed';
  recovering?: boolean;
};

// Signed in by a reset link and no new password yet. Remembered on the
// phone so closing the app can't skip "Set a new password" (8d); it only
// ever holds someone back, never lets them in.
const recoveryKey = (userId: string) => `password-recovery:${userId}`;

const fetchAccount = (userId: string) =>
  Promise.all([
    getAccountStatus(),
    getMyProfile(userId),
    AsyncStorage.getItem(recoveryKey(userId)).catch(() => null),
  ]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Set the moment a reset link signs someone in, before anything loads
  const [recoveryLink, setRecoveryLink] = useState<string | null>(null);
  const [signedOutByServer, setSignedOutByServer] = useState(false);
  const [revocation, setRevocation] = useState<{ userId: string; pending: boolean } | null>(null);
  const userId = session?.user.id;
  // Answers for a previous user (signed out or switched meanwhile) are dropped
  const currentUser = useRef(userId);
  useEffect(() => {
    currentUser.current = userId;
  }, [userId]);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .finally(() => setRestoring(false));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT' && !isSigningOut()) {
        // Revoked, password changed elsewhere, or the account was deleted.
        // Never because of a network error: Supabase keeps the session then.
        setSignedOutByServer(true);
        clearLocalUserData(currentUser.current);
      }
      if (event === 'SIGNED_IN') setSignedOutByServer(false);
      if (event === 'PASSWORD_RECOVERY' && s) {
        setRecoveryLink(s.user.id);
        AsyncStorage.setItem(recoveryKey(s.user.id), '1').catch(() => {});
      }
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // On sign-in. Until it answers, the user shows as loading (see `account` below).
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    fetchAccount(userId).then(
      ([account, p, recovering]) => {
        if (!alive) return;
        setProfile(p);
        setLoaded({ userId, account, recovering: recovering === '1' });
      },
      () => alive && setLoaded({ userId, account: 'failed' })
    );
    return () => {
      alive = false;
    };
  }, [userId]);

  const reloadAccount = useCallback(
    async (showLoading = false) => {
      if (!userId) return;
      if (showLoading) setLoaded({ userId, account: 'loading' });
      try {
        const [account, p, recovering] = await fetchAccount(userId);
        if (currentUser.current !== userId) return;
        setProfile(p);
        setLoaded({ userId, account, recovering: recovering === '1' });
      } catch (e) {
        if (currentUser.current !== userId) return;
        // Without the splash, the screen already showing stays
        if (showLoading) setLoaded({ userId, account: 'failed' });
        throw e;
      }
    },
    [userId]
  );

  const endRecovery = useCallback(async () => {
    if (userId) await AsyncStorage.removeItem(recoveryKey(userId)).catch(() => {});
    setRecoveryLink(null);
    setLoaded((l) => l && { ...l, recovering: false });
  }, [userId]);

  // A sign-out of the other devices that hasn't worked yet: tried again
  // when the app opens, comes back to the foreground, and every 30 seconds
  // while it is open (not a background task: phones can stop those) (8d).
  const revocationPending = !!userId && revocation?.userId === userId && revocation.pending;
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const attempt = () =>
      retryPendingRevocation(userId).then((pending) => {
        if (alive) setRevocation({ userId, pending });
      });
    attempt();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && attempt());
    return () => {
      alive = false;
      sub.remove();
    };
  }, [userId]);
  useEffect(() => {
    if (!userId || !revocationPending) return;
    const timer = setInterval(() => {
      retryPendingRevocation(userId).then((pending) => {
        if (currentUser.current === userId) setRevocation({ userId, pending });
      });
    }, 30_000);
    return () => clearInterval(timer);
  }, [userId, revocationPending]);

  const signOutOthers = useCallback(async () => {
    if (!userId) return false;
    const done = await signOutOtherDevices(userId);
    if (done) setRevocation({ userId, pending: false });
    return done;
  }, [userId]);

  const setRevocationPending = useCallback(
    (pending: boolean) => {
      if (userId) setRevocation({ userId, pending });
    },
    [userId]
  );

  const reloadProfile = useCallback(async () => {
    if (userId) setProfile(await getMyProfile(userId));
  }, [userId]);

  // Never hand out a previous user's answers after signing out or switching accounts.
  const mine = loaded && loaded.userId === userId ? loaded : null;
  const account = mine ? mine.account : 'loading';
  const route = routeFor({
    sessionRestored: !restoring,
    signedIn: !!session,
    recovering: (!!userId && recoveryLink === userId) || !!mine?.recovering,
    account,
  });
  const appProfile = route === 'app' && profile?.id === userId ? profile : null;

  return (
    <AuthContext.Provider
      value={{
        session,
        route,
        account: typeof account === 'object' ? account : null,
        profile: appProfile,
        reloadProfile,
        reloadAccount,
        endRecovery,
        signedOutByServer,
        revocationPending,
        signOutOtherDevices: signOutOthers,
        setRevocationPending,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
