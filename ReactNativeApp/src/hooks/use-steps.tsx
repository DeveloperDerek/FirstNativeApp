import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import type { MyGoal, MyStreak } from '@/api/goals';
import { listMyQuests, type MyQuest } from '@/api/quests';
import { syncDay } from '@/api/steps';
import { currentAccount, isCurrent, signedInAccount } from '@/auth/account-guard';
import { useAuth } from '@/auth/AuthProvider';
import { dayRange, getSteps, type PermissionResult, requestStepPermission } from '@/health';
import { useAchievementNotices } from '@/hooks/use-achievement-notices';
import { useGoalReminders } from '@/hooks/use-goal-reminders';
import { useWallet } from '@/hooks/use-wallet';
import { singleFlight } from '@/lib/single-flight';
import { supabase } from '@/lib/supabase';
import { syncQuestSteps } from '@/quests/sync';
import type { RollState } from '@/roll/roll';
import { refreshSteps } from '@/steps/refresh';
import { HISTORY_DAYS } from '@/storage/step-log';
import { loadSteps, saveManySteps, type StepLog } from '@/storage/stepStore';

/** Automatic refreshes are skipped this soon after the last one started. */
const QUIET_MS = 60_000;

type StepsState = {
  today: number | null;
  log: StepLog;
  permission: PermissionResult | null;
  loading: boolean;
  error: string | null;
  /** Group quests that need me (running quests, results), for the banners. */
  quests: MyQuest[];
  /** The daily goal (today's and the last 7 days'); null until loaded */
  goal: MyGoal | null;
  /** Your streak, from the server; null until loaded */
  streak: MyStreak | null;
  /** Today's daily roll (step-tracker-daily-roll.txt); null while it's off */
  roll: RollState;
  /** The roll as the roll screen just left it, until the next refresh */
  setRoll: (roll: RollState) => void;
  /** Read, save and upload steps now (buttons, pull to refresh). */
  refresh: () => Promise<void>;
  /** The same, unless a refresh started in the last 60 seconds (coming back to the app). */
  refreshIfStale: () => Promise<void>;
  /** Reload just the quests (after starting one, or seeing a result). */
  refreshQuests: () => Promise<void>;
};

const StepsContext = createContext<StepsState | null>(null);

/**
 * At the root, so the tabs and the modals over them (the roll screen)
 * share it. It loads only while `enabled` (the signed-in app is showing)
 * and starts over empty when that ends, as if it had just mounted.
 */
export function StepsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [today, setToday] = useState<number | null>(null);
  const [log, setLog] = useState<StepLog>({});
  const [permission, setPermission] = useState<PermissionResult | null>(null);
  // The first load starts as soon as the provider appears
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quests, setQuests] = useState<MyQuest[]>([]);
  const [goal, setGoal] = useState<MyGoal | null>(null);
  const [streak, setStreak] = useState<MyStreak | null>(null);
  const [roll, setRoll] = useState<RollState>(null);
  const { session, profile } = useAuth();
  const userId = enabled ? session?.user.id : undefined;
  // Only upload once the user has agreed on the consent screen.
  const sharing = Boolean(profile?.sharing_consent_at);
  const { refreshBalance } = useWallet();

  // One refresh at a time; a change of account or sharing runs once more.
  const [flight] = useState(() => singleFlight<void>());
  const lastStarted = useRef(0);
  // The sharing setting now, so a refresh that outlives it stops uploading
  const sharingNow = useRef(sharing);
  const enabledNow = useRef(enabled);
  const mounted = useRef(true);
  useEffect(() => {
    sharingNow.current = sharing;
  }, [sharing]);
  useEffect(() => {
    enabledNow.current = enabled;
  }, [enabled]);
  // Signed out (or set up, paused...): empty again, as on a first mount
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (!enabled) {
      setToday(null);
      setLog({});
      setPermission(null);
      setLoading(true);
      setError(null);
      setQuests([]);
      setGoal(null);
      setStreak(null);
      setRoll(null);
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The work itself is in src/steps/refresh.ts. The account is checked
  // with account-guard, which changes the moment sign-out starts (React
  // state only catches up a render later).
  const load = useCallback(async () => {
    lastStarted.current = Date.now();
    const mark = currentAccount();
    const stillCurrent = () =>
      mounted.current &&
      enabledNow.current &&
      isCurrent(mark) &&
      signedInAccount() === userId &&
      sharingNow.current === sharing;
    await refreshSteps(
      { userId, sharing, stillCurrent, signal: mark.signal },
      {
        requestPermission: requestStepPermission,
        readDays: () =>
          Promise.all(
            Array.from({ length: HISTORY_DAYS }, async (_, daysAgo) => {
              const { start, end } = dayRange(daysAgo);
              return [start, await getSteps(start, end)] as [Date, number];
            })
          ),
        getToken: async (uid) => {
          const { data } = await supabase.auth.getSession();
          return data.session?.user.id === uid ? data.session.access_token : null;
        },
        saveSteps: saveManySteps,
        syncDay,
        syncQuestSteps,
        refreshBalance,
        alert: (title, message) => Alert.alert(title, message),
      },
      { setLoading, setError, setPermission, setToday, setLog, setGoal, setStreak, setQuests, setRoll }
    );
  }, [userId, sharing, refreshBalance]);

  // Joins a running refresh for the same account and sharing setting.
  const run = useCallback(() => flight(`${userId}:${sharing}`, load), [flight, userId, sharing, load]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await run();
  }, [run]);

  const refreshIfStale = useCallback(async () => {
    if (Date.now() - lastStarted.current < QUIET_MS) return;
    await run();
  }, [run]);

  const refreshQuests = useCallback(async () => {
    if (!userId || !sharing) return;
    setQuests(await listMyQuests().catch(() => []));
  }, [userId, sharing]);

  useEffect(() => {
    // Show cached history immediately, then fetch fresh numbers.
    if (userId) loadSteps(userId).then(setLog).catch(() => {});
  }, [userId]);

  useEffect(() => {
    // Always on launch, sign-in, and when sharing is turned on or off
    if (!enabled) return;
    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshIfStale();
    });
    return () => sub.remove();
  }, [enabled, run, refreshIfStale]);

  // Goal reminders follow every refresh (step-tracker-history-reminders.txt, B)
  useGoalReminders({ userId, loading, today, goal, streak, roll });

  // New achievements, also after every refresh: the claim above and a
  // quest won (even while the app was closed) are when they're earned
  useAchievementNotices({ userId, loading });

  return (
    <StepsContext.Provider
      value={{
        today,
        log,
        permission,
        loading,
        error,
        quests,
        goal,
        streak,
        roll,
        setRoll,
        refresh,
        refreshIfStale,
        refreshQuests,
      }}>
      {children}
    </StepsContext.Provider>
  );
}

export function useSteps() {
  const ctx = useContext(StepsContext);
  if (!ctx) throw new Error('useSteps must be used inside <StepsProvider>');
  return ctx;
}
