import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { claimCheckin, getBalance } from '@/api/coins';
import { useAuth } from '@/auth/AuthProvider';

type WalletState = {
  /** null until the first load finishes. */
  balance: number | null;
  refreshBalance: () => Promise<void>;
  /** For values the database just returned (e.g. after a purchase). */
  setBalance: (balance: number) => void;
  /** When the next check-in bonus is ready; null if not sharing (no coins). */
  nextCheckin: Date | null;
  /** Ask the database for the check-in bonus (safe to call any time). */
  checkIn: () => Promise<void>;
};

const WalletContext = createContext<WalletState | null>(null);

type Wallet = { userId: string; balance: number | null; nextCheckin: Date | null };

/**
 * The signed-in user's coins, shared by Today, the Shop and the editor.
 * Also collects the check-in bonus on launch and whenever the app comes
 * back to the foreground.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const sharing = Boolean(profile?.sharing_consent_at);
  const profileLoaded = profile !== null;
  const [state, setState] = useState<Wallet | null>(null);

  // Never show a previous account's coins after switching users.
  const current = state && state.userId === userId ? state : null;

  const update = useCallback(
    (patch: Partial<Omit<Wallet, 'userId'>>) => {
      if (!userId) return;
      setState((s) => ({
        userId,
        balance: s?.userId === userId ? s.balance : null,
        nextCheckin: s?.userId === userId ? s.nextCheckin : null,
        ...patch,
      }));
    },
    [userId]
  );

  const refreshBalance = useCallback(async () => {
    if (!userId) return;
    update({ balance: await getBalance(userId) });
  }, [userId, update]);

  const applyCheckin = useCallback(
    async (result: { granted: number; nextAt: Date | null }) => {
      if (!userId) return;
      if (result.granted > 0) {
        Alert.alert('Welcome back!', `+${result.granted} coins for checking in.`);
        update({ nextCheckin: result.nextAt, balance: await getBalance(userId) });
      } else {
        update({ nextCheckin: result.nextAt });
      }
    },
    [userId, update]
  );

  const checkIn = useCallback(async () => {
    if (!userId) return;
    await applyCheckin(await claimCheckin());
  }, [userId, applyCheckin]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getBalance(userId)
      .then((balance) => alive && update({ balance }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, update]);

  // Check in on launch (once the profile says whether they share) and
  // every time the app returns to the foreground. The server decides.
  useEffect(() => {
    if (!userId || !profileLoaded) return;
    const collect = () =>
      claimCheckin()
        .then(applyCheckin)
        .catch(() => {});
    collect();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') collect();
    });
    return () => sub.remove();
  }, [userId, profileLoaded, sharing, applyCheckin]);

  const setBalance = useCallback((balance: number) => update({ balance }), [update]);

  return (
    <WalletContext.Provider
      value={{
        balance: current?.balance ?? null,
        refreshBalance,
        setBalance,
        nextCheckin: current?.nextCheckin ?? null,
        checkIn,
      }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}
