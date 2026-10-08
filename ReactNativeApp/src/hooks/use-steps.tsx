import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { claimDailyRewards } from '@/api/coins';
import { syncSteps } from '@/api/steps';
import { useAuth } from '@/auth/AuthProvider';
import { dayRange, getSteps, type PermissionResult, requestStepPermission } from '@/health';
import { useWallet } from '@/hooks/use-wallet';
import { loadSteps, saveManySteps, type StepLog } from '@/storage/stepStore';

export const HISTORY_DAYS = 7;

type StepsState = {
  today: number | null;
  log: StepLog;
  permission: PermissionResult | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const StepsContext = createContext<StepsState | null>(null);

export function StepsProvider({ children }: { children: ReactNode }) {
  const [today, setToday] = useState<number | null>(null);
  const [log, setLog] = useState<StepLog>({});
  const [permission, setPermission] = useState<PermissionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  // Only upload once the user has agreed on the consent screen.
  const sharing = Boolean(profile?.sharing_consent_at);
  const { refreshBalance } = useWallet();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await requestStepPermission();
      setPermission(result);
      if (result !== 'granted') return;

      // Today plus a backfill of the previous days, saved in one write.
      const entries = await Promise.all(
        Array.from({ length: HISTORY_DAYS }, async (_, daysAgo) => {
          const { start, end } = dayRange(daysAgo);
          return [start, await getSteps(start, end)] as [Date, number];
        })
      );
      setToday(entries[0][1]);
      setLog(await saveManySteps(entries));

      if (userId && sharing) {
        await syncSteps(userId, entries).catch((e) => {
          throw new Error(`Couldn't upload steps: ${e instanceof Error ? e.message : String(e)}`);
        });
        // Sync first, then claim: the database pays for the rows just written.
        // Coins need sharing, so this only runs for users who agreed.
        const earned = await claimDailyRewards();
        if (earned > 0) {
          Alert.alert('Goal reached!', `You earned ${earned} coins. Spend them in the Shop.`);
          await refreshBalance();
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [userId, sharing, refreshBalance]);

  useEffect(() => {
    // Show cached history immediately, then fetch fresh numbers.
    loadSteps().then(setLog).catch(() => {});
    refresh();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return (
    <StepsContext.Provider value={{ today, log, permission, loading, error, refresh }}>
      {children}
    </StepsContext.Provider>
  );
}

export function useSteps() {
  const ctx = useContext(StepsContext);
  if (!ctx) throw new Error('useSteps must be used inside <StepsProvider>');
  return ctx;
}
