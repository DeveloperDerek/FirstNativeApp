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
