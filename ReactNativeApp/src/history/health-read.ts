import { getDailySteps, getFirstStepDay } from '@/health';

import { addDays, monthOf, monthSpans, parseDay } from './history';

// Non-sharers' History from Apple Health / Health Connect, read on the phone
// only and never uploaded (step-tracker-history-reminders.txt, part A, "On
// the phone"). Speed-ups before any 90-day limit (decision 5): the months
// of a range are read at the same time, and past months are kept for the
// session, since they rarely change. Pull to refresh starts afresh.

const pastMonths = new Map<string, Record<string, number>>();
let firstStepDay: string | null = null;

/** Forget what was read, so the next read asks Health again. */
export function clearHealthHistory() {
  pastMonths.clear();
  firstStepDay = null;
}

/** Steps per day from `from` to `to`, and the first day with steps (null if none). */
export async function readHealthHistory(from: string, to: string, today: string) {
  const started = Date.now();
  const thisMonth = monthOf(today);

  const [parts, first] = await Promise.all([
    Promise.all(
      monthSpans(from, to).map(async (span) => {
        const key = `${span.from}:${span.to}`;
        const keep = monthOf(span.from) < thisMonth;
        const kept = keep ? pastMonths.get(key) : undefined;
        if (kept) return kept;
        // Local midnight at the start to local midnight after the end
        const days = await getDailySteps(parseDay(span.from), parseDay(addDays(span.to, 1)));
        if (keep) pastMonths.set(key, days);
        return days;
      })
    ),
    // Kept once found; while there are no steps yet, asked again each time
    firstStepDay ?? getFirstStepDay(),
  ]);
  if (first) firstStepDay = first;

  if (__DEV__) {
    // For the device measurement in DEVICE-TESTS.md (decision 5)
    console.log(`[history] Health ${from}..${to}: ${Date.now() - started} ms`);
  }
  return { daily: Object.assign({}, ...parts) as Record<string, number>, firstDay: first };
}
