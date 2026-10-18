// One step refresh (step-tracker-step-refresh.txt): read Health, save the
// history, upload and claim, then send quest steps. The phone's parts
// (Health, storage, Supabase, alerts) are passed in, so `npm test` can run
// it with fakes; StepsProvider (src/hooks/use-steps.tsx) runs it for real.
//
// The account rules (section 3): every server call carries the token the
// account had when the refresh started, and every save, alert, state
// change and request after an await first checks `stillCurrent`. A check
// stops what comes after it; the token keeps a request already sent as
// the right account's.

import type { MyGoal, MyStreak } from '@/api/goals';
import type { MyQuest } from '@/api/quests';
import type { SyncResult } from '@/api/steps';
import type { PermissionResult } from '@/health';
import type { RequestAuth } from '@/lib/request-auth';
import type { StepLog } from '@/storage/step-log';

import { errorMessage } from '../lib/error-message.ts';

export type RefreshContext = {
  /** Who the refresh is for; undefined when signed out (Today still reads Health) */
  userId: string | undefined;
  /** Step sharing when it started: uploads only with it on */
  sharing: boolean;
  /** False once the account or sharing changed, or the screen went away */
  stillCurrent: () => boolean;
  /** Aborted when the account changes */
  signal: AbortSignal;
};

export type RefreshDeps = {
  requestPermission: () => Promise<PermissionResult>;
  /** Today first, then the days before it */
  readDays: () => Promise<[Date, number][]>;
  /** The signed-in session's token, or null unless it's still `userId`'s */
  getToken: (userId: string) => Promise<string | null>;
  saveSteps: (
    userId: string,
    entries: [Date, number][],
    stillCurrent: () => boolean
  ) => Promise<StepLog | null>;
  syncDay: (entries: [Date, number][], auth: RequestAuth) => Promise<SyncResult>;
  syncQuestSteps: (
    quests: MyQuest[],
    auth: RequestAuth,
    stillCurrent: () => boolean
  ) => Promise<MyQuest[]>;
  refreshBalance: () => Promise<void>;
  alert: (title: string, message: string) => void;
};

/** Where the answers go (StepsProvider's state). */
export type RefreshView = {
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setPermission: (permission: PermissionResult) => void;
  setToday: (steps: number) => void;
  setLog: (log: StepLog) => void;
  setGoal: (goal: MyGoal) => void;
  setStreak: (streak: MyStreak) => void;
  setQuests: (quests: MyQuest[]) => void;
};

// Every state change comes after the first await. One server call
// (syncDay) uploads, claims, and reads quests, goal and streak; a second
// only while a quest is taking steps.
export async function refreshSteps(ctx: RefreshContext, deps: RefreshDeps, view: RefreshView) {
  const { userId, sharing, stillCurrent } = ctx;
  try {
    const result = await deps.requestPermission();
    if (!stillCurrent()) return;
    view.setLoading(true);
    view.setError(null);
    view.setPermission(result);

    // Today plus a backfill of the previous days, saved in one write.
    // Without permission there are none, but they can still follow quests.
    const entries = result === 'granted' ? await deps.readDays() : [];
    if (!stillCurrent()) return;
    if (entries.length) view.setToday(entries[0][1]);
    if (!userId) return;

    // The token now, for every request below: sent later, they are still
    // this account's. No token for this account means it's signing out.
    const token = await deps.getToken(userId);
    if (!stillCurrent() || !token) return;
    const auth: RequestAuth = { token, signal: ctx.signal };

    if (entries.length) {
      const saved = await deps.saveSteps(userId, entries, stillCurrent);
      if (!stillCurrent() || !saved) return;
      view.setLog(saved);
    }

    // Uploads only with sharing on (coins and quests need it too); the
    // goal and streak come back either way. With nothing to upload a
    // failure is quiet: Today falls back to 10,000 and no streak.
    const upload = sharing ? entries : [];
    const synced = await deps.syncDay(upload, auth).catch((e) => {
      if (!upload.length) return null;
      throw new Error(`Couldn't sync steps: ${errorMessage(e)}`);
    });
    if (!stillCurrent() || !synced) return;
    view.setGoal(synced.goal);
    view.setStreak(synced.streak);
    view.setQuests(synced.quests);
    if (synced.earned > 0) {
      deps.alert('Goal reached!', `You earned ${synced.earned} coins. Spend them in the Shop.`);
      await deps.refreshBalance();
      if (!stillCurrent()) return;
    }
    // Quest steps last: the server checks them against the daily totals
    // just uploaded. Today's steps are already saved above.
    if (sharing && entries.length) {
      const list = await deps.syncQuestSteps(synced.quests, auth, stillCurrent).catch((e) => {
        throw new Error(`Couldn't send quest steps: ${errorMessage(e)}`);
      });
      if (stillCurrent()) view.setQuests(list);
    }
  } catch (e) {
    if (stillCurrent()) view.setError(errorMessage(e));
  } finally {
    if (stillCurrent()) view.setLoading(false);
  }
}
