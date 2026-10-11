import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { getMyHistory, getMyHistoryByMonth } from '@/api/history';
import { myToday } from '@/api/steps';
import { useAuth } from '@/auth/AuthProvider';
import {
  daysBetween,
  daysFrom,
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
 * day's goal comes from the server; the last 7 days' steps from the phone,
 * older ones from the server for sharers. Not sharing: the server sends the
 * goals only, and days older than the phone's 7 are missing (Health fills
 * them in step 3).
 */
export function useHistory(view: HistoryView, offset: number): HistoryData {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const sharing = Boolean(profile?.sharing_consent_at);
  const { log, goal } = useSteps();

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
  const key = `${userId}:${sharing}:${view}:${range.from}:${range.to}:${reloads}`;
  const [fetched, setFetched] = useState<{ key: string; data: Fetched } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    if (!userId) return;
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
      return { kind: 'days', days: await getMyHistory(range.from, range.to) };
    };
    load().then(
      (data) => live && setFetched({ key, data }),
      (e) => live && setFailed({ key, message: errorMessage(e) })
    );
    return () => {
      live = false;
    };
  }, [key, userId, view, sharing, range, today]);

  const current = fetched?.key === key ? fetched.data : null;
  const error = failed?.key === key ? failed.message : null;

  let days: HistoryDay[] | null = null;
  let months: MonthRow[] | null = null;
  if (current?.kind === 'year') {
    months = yearMonths(current.months, current.phoneMonths, mergeDays(current.phoneDays, log, today));
  } else if (current?.kind === 'days') {
    const merged = mergeDays(current.days, log, today);
    if (view === 'year') months = monthRows(merged);
    else days = merged;
  }

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
