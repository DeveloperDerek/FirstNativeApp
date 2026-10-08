import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { getBalance } from '@/api/coins';
import { useAuth } from '@/auth/AuthProvider';

type WalletState = {
  /** null until the first load finishes. */
  balance: number | null;
  refreshBalance: () => Promise<void>;
  /** For values the database just returned (e.g. after a purchase). */
  setBalance: (balance: number) => void;
};

const WalletContext = createContext<WalletState | null>(null);

/** The signed-in user's coin balance, shared by Today, the Shop and the editor. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [state, setState] = useState<{ userId: string; balance: number } | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!userId) return;
    const balance = await getBalance(userId);
    setState({ userId, balance });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getBalance(userId)
      .then((balance) => alive && setState({ userId, balance }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  const setBalance = useCallback(
    (balance: number) => userId && setState({ userId, balance }),
    [userId]
  );

  // Never show a previous account's balance after switching users.
  const balance = state && state.userId === userId ? state.balance : null;

  return (
    <WalletContext.Provider value={{ balance, refreshBalance, setBalance }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}
