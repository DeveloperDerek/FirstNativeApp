// The parts of the step history that don't touch the phone's storage,
// so they can be tested with `npm test`.

import { dayKey } from '../lib/day.ts';

export { dayKey };

export type StepLog = Record<string, number>; // { "2026-10-06": 8421 }

/** Days History shows, and how many the phone keeps (step-tracker-step-refresh.txt, C). */
export const HISTORY_DAYS = 7;

/** Each account's history is saved under its own key. */
export const stepsKey = (userId: string) => `steps-by-day:${userId}`;

/** Drops days older than the last `keepDays`, counting today. */
export function pruneLog(log: StepLog, keepDays = HISTORY_DAYS, now = new Date()): StepLog {
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - (keepDays - 1));
  const cutoff = dayKey(oldest);
  // "YYYY-MM-DD" sorts as text in date order
  return Object.fromEntries(Object.entries(log).filter(([day]) => day >= cutoff));
}

/** The two storage calls saving needs (AsyncStorage on the phone). */
export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

/**
 * Adds the days just read to the account's history, keeping only the
 * days History shows. Writes nothing (and returns null) once
 * `stillCurrent` is false: checked right before the write, after the
 * read, so a sign-out that cleared the history while it was being read
 * can't bring it back (step-tracker-step-refresh.txt, section 3).
 */
export async function saveDays(
  store: KeyValueStore,
  userId: string,
  entries: [Date, number][],
  stillCurrent: () => boolean = () => true
): Promise<StepLog | null> {
  const raw = await store.getItem(stepsKey(userId));
  const log: StepLog = raw ? JSON.parse(raw) : {};
  for (const [date, steps] of entries) log[dayKey(date)] = steps;
  const kept = pruneLog(log);
  if (!stillCurrent()) return null;
  await store.setItem(stepsKey(userId), JSON.stringify(kept));
  return kept;
}
