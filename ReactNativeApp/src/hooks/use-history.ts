import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { getMyHistory, getMyHistoryByMonth } from '@/api/history';
import { myToday } from '@/api/steps';
import { useAuth } from '@/auth/AuthProvider';
import { readHealthHistory } from '@/history/health-read';
import {
  daysBetween,
  daysFrom,
  healthDays,
  type HistoryDay,
  type HistoryStats,
  type HistoryView,
  mergeDays,
  type MonthRow,
  monthRows,
  periodRange,
  phoneMonthsRange,
  summarize,
  summarizeMonths,
  yearMonths,
} from '@/history/history';
import { useSteps } from '@/hooks/use-steps';
import { errorMessage } from '@/lib/error-message';

type Range = { from: string; to: string };

/** What the server sent for one period, before the phone's days go in. */
type Fetched =
  | { kind: 'days'; days: HistoryDay[] }
  | { kind: 'health'; goals: HistoryDay[]; daily: Record<string, number>; firstDay: string | null }
  | { kind: 'year'; months: MonthRow[]; phoneMonths: Range | null; phoneDays: HistoryDay[] };

export type HistoryData = {
  /** The phone's today, refreshed when History comes back into view */
  today: string;
  range: Range;
  /** Week and Month: each day; null for Year or until loaded */
  days: HistoryDay[] | null;
  /** Year: the months with data; null otherwise or until loaded */
  months: MonthRow[] | null;
  stats: HistoryStats | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * One period of History (step-tracker-history-reminders.txt, part A). Every
 * day's goal comes from the server; the last 7 days' steps from the phone.
 * Older days: from the server for sharers, from Health for non-sharers
 * (only the phone's copy if Health can't be read).
 */
export function useHistory(view: HistoryView, offset: number): HistoryData {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const sharing = Boolean(profile?.sharing_consent_at);
  const { log, goal, permission } = useSteps();
  const healthOk = permission === 'granted';

  // Today moves on at midnight and with a new time zone; check whenever
  // History is looked at again.
  const [today, setToday] = useState(myToday);
  useFocusEffect(useCallback(() => setToday(myToday()), []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setToday(myToday());
    });
    return () => sub.remove();
  }, []);

  const range = useMemo(() => periodRange(view, offset, today), [view, offset, today]);
  const [reloads, setReloads] = useState(0);
  const key = `${userId}:${sharing}:${healthOk}:${view}:${range.from}:${range.to}:${reloads}`;
  const [fetched, setFetched] = useState<{ key: string; data: Fetched } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    // Not sharing: wait to know whether Health can be read, rather than
    // show every older day as missing and then fill them in
    if (!userId || (!sharing && permission === null)) return;
    let live = true;
    const load = async (): Promise<Fetched> => {
      if (view === 'year' && sharing) {
        const phoneMonths = phoneMonthsRange(range, today);
        const [months, phoneDays] = await Promise.all([
          getMyHistoryByMonth(Number(range.from.slice(0, 4))),
          phoneMonths ? getMyHistory(phoneMonths.from, phoneMonths.to) : Promise.resolve([]),
        ]);
        return { kind: 'year', months, phoneMonths, phoneDays };
      }
      if (!sharing && healthOk) {
        const [goals, health] = await Promise.all([
          getMyHistory(range.from, range.to),
          readHealthHistory(range.from, range.to, today),
        ]);
        if (__DEV__ && view === 'year') {
          // Timed apart from the Health read (health-read.ts), for decision 5
          const started = Date.now();
          monthRows(healthDays(goals, health.daily, {}, health.firstDay, today));
          console.log(`[history] working out the year: ${Date.now() - started} ms`);
        }
        return { kind: 'health', goals, ...health };
      }
      return { kind: 'days', days: await getMyHistory(range.from, range.to) };
    };
    load().then(
      (data) => live && setFetched({ key, data }),
      (e) => live && setFailed({ key, message: errorMessage(e) })
    );
    return () => {
      live = false;
    };
  }, [key, userId, view, sharing, healthOk, permission, range, today]);

  const current = fetched?.key === key ? fetched.data : null;
  const error = failed?.key === key ? failed.message : null;

  const built = useMemo(() => {
    if (!current) return { days: null, months: null };
    if (current.kind === 'year') {
      const phoneDays = mergeDays(current.phoneDays, log, today);
      return { days: null, months: yearMonths(current.months, current.phoneMonths, phoneDays) };
    }
    const merged =
      current.kind === 'health'
        ? healthDays(current.goals, current.daily, log, current.firstDay, today)
        : mergeDays(current.days, log, today);
    return view === 'year'
      ? { days: null, months: monthRows(merged) }
      : { days: merged, months: null };
  }, [current, log, today, view]);
  let days: HistoryDay[] | null = built.days;
  const months: MonthRow[] | null = built.months;

  // Offline, this week still works from the last 7 days' goals that
  // my_goal already brought (part A, "Where goals come from"). Other
  // periods wait for the server rather than guess the goals.
  let shownError = error;
  if (!current && error && view === 'week' && offset === 0 && goal?.recent.length) {
    const goals = new Map(goal.recent.map((g) => [g.day, g.goal]));
    if (daysFrom(range.from, range.to).every((d) => goals.has(d))) {
      days = daysFrom(range.from, range.to).map((d) => ({
        day: d,
        goal: goals.get(d)!,
        steps: log[d] ?? null,
      }));
      shownError = null;
    }
  }

  const stats = days
    ? summarize(days)
    : months
      ? summarizeMonths(months, daysBetween(range.from, range.to) + 1)
      : null;

  return {
    today,
    range,
    days,
    months,
    stats,
    loading: !current && !error,
    error: shownError,
    reload: () => setReloads((n) => n + 1),
  };
}
