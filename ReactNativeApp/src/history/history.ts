// Longer History (step-tracker-history-reminders.txt, part A): the
// periods, putting the phone's and the server's days together, and the
// stats. Pure, so `npm test` can check them.
//
// Days are 'YYYY-MM-DD' strings for the phone's own calendar (dayKey), so
// the arithmetic here works in UTC on purpose: no time zone or daylight
// saving change can move a day.

import { dayToUtc, parseDay } from '../lib/day.ts';

export { parseDay };

export type HistoryView = 'week' | 'month' | 'year';

/** A day of History. steps null = missing (no known total), 0 = a real zero. */
export type HistoryDay = { day: string; goal: number; steps: number | null };

/** One month of the Year view; the same rules as summarize(). */
export type MonthRow = {
  /** The 1st of the month, 'YYYY-MM-01' */
  month: string;
  daysWithData: number;
  totalSteps: number;
  daysAtGoal: number;
  bestDay: string | null;
  bestSteps: number | null;
};

export type HistoryStats = {
  total: number;
  /** Days with a known total, zeros included */
  daysWithData: number;
  /** Days in the period up to today */
  dayCount: number;
  /** total / daysWithData; null with no data */
  average: number | null;
  /** The highest day (the earliest, if two tie); null with no steps at all */
  best: { day: string; steps: number } | null;
  daysAtGoal: number;
};

/** The days the phone's own copy covers (today and the 6 before). */
export const PHONE_DAYS = 7;

const DAY_MS = 86_400_000;
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (day: string, n: number) => fromUtc(dayToUtc(day) + n * DAY_MS);
export const daysBetween = (from: string, to: string) => Math.round((dayToUtc(to) - dayToUtc(from)) / DAY_MS);
export const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

/** Every day from `from` to `to`, both included. */
export function daysFrom(from: string, to: string): string[] {
  const n = daysBetween(from, to) + 1;
  return Array.from({ length: Math.max(n, 0) }, (_, i) => addDays(from, i));
}

/**
 * The days a view shows, `offset` periods back from today (0 = the
 * current one). Week: the last 7 days, 7 days at a time. Month and Year:
 * calendar months and years, the current one only up to today.
 */
export function periodRange(view: HistoryView, offset: number, today: string) {
  if (view === 'week') {
    const to = addDays(today, -PHONE_DAYS * offset);
    return { from: addDays(to, -(PHONE_DAYS - 1)), to };
  }
  const [y, m] = today.split('-').map(Number);
  if (view === 'month') {
    const start = Date.UTC(y, m - 1 - offset, 1);
    const end = Date.UTC(y, m - offset, 0); // day 0 of the next month = the last of this one
    const to = fromUtc(end);
    return { from: fromUtc(start), to: to < today ? to : today };
  }
  const year = y - offset;
  const to = `${year}-12-31`;
  return { from: `${year}-01-01`, to: to < today ? to : today };
}

/**
 * Each day from exactly one place, never both (part A, "Where phone and
 * server meet"): the last 7 days from the phone's copy, older days as the
 * server has them. A phone day the copy doesn't have yet (a new phone
 * before its first refresh) keeps the server's value.
 */
export function mergeDays(
  server: HistoryDay[],
  phone: Record<string, number>,
  today: string
): HistoryDay[] {
  const phoneFrom = addDays(today, -(PHONE_DAYS - 1));
  return server.map((d) => {
    const fromPhone = d.day >= phoneFrom && d.day <= today ? phone[d.day] : undefined;
    return fromPhone === undefined ? d : { ...d, steps: fromPhone };
  });
}

const bestOf = (a: HistoryStats['best'], b: HistoryStats['best']) =>
  !a ? b : !b ? a : b.steps > a.steps || (b.steps === a.steps && b.day < a.day) ? b : a;

/** Total, average, best day and days at goal; missing days left out of all of them. */
export function summarize(days: HistoryDay[]): HistoryStats {
  let total = 0;
  let daysWithData = 0;
  let daysAtGoal = 0;
  let best: HistoryStats['best'] = null;
  for (const d of days) {
    if (d.steps === null) continue;
    total += d.steps;
    daysWithData += 1;
    if (d.steps >= d.goal) daysAtGoal += 1;
    if (d.steps > 0) best = bestOf(best, { day: d.day, steps: d.steps });
  }
  return {
    total,
    daysWithData,
    dayCount: days.length,
    average: daysWithData ? Math.round(total / daysWithData) : null,
    best,
    daysAtGoal,
  };
}

/** The Year view's months from day rows: only months with data. */
export function monthRows(days: HistoryDay[]): MonthRow[] {
  const byMonth = new Map<string, HistoryDay[]>();
  for (const d of days) {
    if (d.steps === null) continue;
    const key = monthOf(d.day);
    byMonth.set(key, [...(byMonth.get(key) ?? []), d]);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, list]) => {
      const s = summarize(list);
      return {
        month,
        daysWithData: s.daysWithData,
        totalSteps: s.total,
        daysAtGoal: s.daysAtGoal,
        bestDay: s.best?.day ?? null,
        bestSteps: s.best?.steps ?? null,
      };
    });
}

/**
 * The part of a Year view that must be built from day rows rather than the
 * server's monthly sums: every month that overlaps the phone's last 7 days
 * (this month, and early in a month the one before). Null if none does.
 */
export function phoneMonthsRange(range: { from: string; to: string }, today: string) {
  const from = monthOf(addDays(today, -(PHONE_DAYS - 1)));
  const start = from > range.from ? from : range.from;
  return start <= range.to ? { from: start, to: range.to } : null;
}

/**
 * A sharer's Year: the server's monthly sums, with the months the phone's
 * days overlap replaced by `phoneMonths`, built from merged day rows.
 */
export function yearMonths(
  server: MonthRow[],
  phoneMonths: { from: string; to: string } | null,
  phoneDays: HistoryDay[]
): MonthRow[] {
  const replaced = (m: string) => phoneMonths !== null && m >= monthOf(phoneMonths.from);
  return [...server.filter((m) => !replaced(m.month)), ...monthRows(phoneDays)].sort((a, b) =>
    a.month < b.month ? -1 : 1
  );
}

/** A month's average per day (total / days with data); null with no data. */
export const monthAverage = (m: MonthRow) =>
  m.daysWithData ? Math.round(m.totalSteps / m.daysWithData) : null;

/** The same stats as summarize(), for a Year made of months. */
export function summarizeMonths(months: MonthRow[], dayCount: number): HistoryStats {
  let total = 0;
  let daysWithData = 0;
  let daysAtGoal = 0;
  let best: HistoryStats['best'] = null;
  for (const m of months) {
    total += m.totalSteps;
    daysWithData += m.daysWithData;
    daysAtGoal += m.daysAtGoal;
    if (m.bestDay && m.bestSteps) best = bestOf(best, { day: m.bestDay, steps: m.bestSteps });
  }
  return {
    total,
    daysWithData,
    dayCount,
    average: daysWithData ? Math.round(total / daysWithData) : null,
    best,
    daysAtGoal,
  };
}

/** A range cut into calendar months, so each can be read (and kept) on its own. */
export function monthSpans(from: string, to: string): { from: string; to: string }[] {
  const spans: { from: string; to: string }[] = [];
  let start = from;
  while (start <= to) {
    const monthEnd = addDays(monthOf(addDays(monthOf(start), 31)), -1);
    const end = monthEnd < to ? monthEnd : to;
    spans.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  return spans;
}

/**
 * A non-sharer's days from Health (part A, "Days with data"): Health gives
 * a number for every day, even before the person had any steps, so days
 * before the first day with steps are missing; from then on a day Health
 * has nothing for is a real 0. The last 7 days come from the phone's copy,
 * as for sharers. With no first day at all (no steps, or no access on
 * iPhone, which looks the same), every day is missing.
 */
export function healthDays(
  goals: HistoryDay[],
  health: Record<string, number>,
  phone: Record<string, number>,
  firstDay: string | null,
  today: string
): HistoryDay[] {
  const phoneFrom = addDays(today, -(PHONE_DAYS - 1));
  return goals.map((d) => {
    if (firstDay === null || d.day < firstDay) return { ...d, steps: null };
    const fromPhone = d.day >= phoneFrom && d.day <= today ? phone[d.day] : undefined;
    return { ...d, steps: fromPhone ?? health[d.day] ?? 0 };
  });
}
