import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import type { MyGoal, MyStreak } from '@/api/goals';
import { listMyQuests, type MyQuest } from '@/api/quests';
import { syncDay } from '@/api/steps';
import { useAuth } from '@/auth/AuthProvider';
import { dayRange, getSteps, type PermissionResult, requestStepPermission } from '@/health';
import { useAchievementNotices } from '@/hooks/use-achievement-notices';
import { useGoalReminders } from '@/hooks/use-goal-reminders';
import { useWallet } from '@/hooks/use-wallet';
import { singleFlight } from '@/lib/single-flight';
import { syncQuestSteps } from '@/quests/sync';
import { HISTORY_DAYS } from '@/storage/step-log';
import { loadSteps, saveManySteps, type StepLog } from '@/storage/stepStore';

export { HISTORY_DAYS };

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
  /** Read, save and upload steps now (buttons, pull to refresh). */
  refresh: () => Promise<void>;
  /** The same, unless a refresh started in the last 60 seconds (coming back to the app). */
  refreshIfStale: () => Promise<void>;
  /** Reload just the quests (after starting one, or seeing a result). */
  refreshQuests: () => Promise<void>;
};

const StepsContext = createContext<StepsState | null>(null);

export function StepsProvider({ children }: { children: ReactNode }) {
  const [today, setToday] = useState<number | null>(null);
  const [log, setLog] = useState<StepLog>({});
  const [permission, setPermission] = useState<PermissionResult | null>(null);
  // The first load starts as soon as the provider appears
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quests, setQuests] = useState<MyQuest[]>([]);
  const [goal, setGoal] = useState<MyGoal | null>(null);
  const [streak, setStreak] = useState<MyStreak | null>(null);
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  // Only upload once the user has agreed on the consent screen.
  const sharing = Boolean(profile?.sharing_consent_at);
  const { refreshBalance } = useWallet();

  // One refresh at a time; a change of account or sharing runs once more.
  const [flight] = useState(() => singleFlight<void>());
  const lastStarted = useRef(0);
  // Who is signed in now, so a refresh that outlives its account stops.
  const signedIn = useRef(userId);
  const mounted = useRef(true);
  useEffect(() => {
    signedIn.current = userId;
  }, [userId]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The work itself. Every state change comes after the first await.
  // One server call (syncDay) uploads, claims, and reads quests, goal and
  // streak; a second only while a quest is taking steps.
  const load = useCallback(async () => {
    const stillMine = () => mounted.current && signedIn.current === userId;
    lastStarted.current = Date.now();
    try {
      const result = await requestStepPermission();
      if (!stillMine()) return;
      setLoading(true);
      setError(null);
      setPermission(result);

      // Today plus a backfill of the previous days, saved in one write.
      // Without permission there are none, but they can still follow quests.
      const entries =
        result === 'granted'
          ? await Promise.all(
              Array.from({ length: HISTORY_DAYS }, async (_, daysAgo) => {
                const { start, end } = dayRange(daysAgo);
                return [start, await getSteps(start, end)] as [Date, number];
              })
            )
          : [];
      if (!stillMine()) return;
      if (entries.length) setToday(entries[0][1]);
      if (!userId) return;
      if (entries.length) {
        const saved = await saveManySteps(userId, entries);
        if (!stillMine()) return;
        setLog(saved);
      }

      // Uploads only with sharing on (coins and quests need it too); the
      // goal and streak come back either way. With nothing to upload a
      // failure is quiet: Today falls back to 10,000 and no streak.
      const upload = sharing ? entries : [];
      const synced = await syncDay(upload).catch((e) => {
        if (!upload.length) return null;
        throw new Error(`Couldn't sync steps: ${e instanceof Error ? e.message : String(e)}`);
      });
      if (!stillMine() || !synced) return;
      setGoal(synced.goal);
      setStreak(synced.streak);
      setQuests(synced.quests);
      if (synced.earned > 0) {
        Alert.alert('Goal reached!', `You earned ${synced.earned} coins. Spend them in the Shop.`);
        await refreshBalance();
      }
      // Quest steps last: the server checks them against the daily totals
      // just uploaded. Today's steps are already saved above.
      if (sharing && entries.length) {
        const list = await syncQuestSteps(synced.quests).catch((e) => {
          throw new Error(`Couldn't send quest steps: ${e instanceof Error ? e.message : String(e)}`);
        });
        if (stillMine()) setQuests(list);
      }
    } catch (e) {
      if (stillMine()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (stillMine()) setLoading(false);
    }
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
    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshIfStale();
    });
    return () => sub.remove();
  }, [run, refreshIfStale]);

  // Goal reminders follow every refresh (step-tracker-history-reminders.txt, B)
  useGoalReminders({ userId, loading, today, goal, streak });

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
