import { myToday } from '@/api/steps';
import type { HistoryDay, MonthRow } from '@/history/history';
import { supabase } from '@/lib/supabase';

// Your own longer History (step-tracker-history-reminders.txt, part A).
// The server only ever answers for the signed-in person.

/** Every day from `from` to `to` (at most 366), with its goal; steps null if not uploaded or not sharing. */
export async function getMyHistory(from: string, to: string): Promise<HistoryDay[]> {
  const { data, error } = await supabase.rpc('my_history', {
    from_day: from,
    to_day: to,
    my_today: myToday(),
  });
  if (error) throw error;
  return (data ?? []) as HistoryDay[];
}

/** A sharer's year, one row per month with data; empty when not sharing. */
export async function getMyHistoryByMonth(year: number): Promise<MonthRow[]> {
  const { data, error } = await supabase.rpc('my_history_by_month', {
    p_year: year,
    my_today: myToday(),
  });
  if (error) throw error;
  return (
    (data ?? []) as {
      month: string;
      days_with_data: number;
      total_steps: number | string; // bigint arrives as a number or string
      days_at_goal: number;
      best_day: string | null;
      best_steps: number | null;
    }[]
  ).map((r) => ({
    month: r.month,
    daysWithData: r.days_with_data,
    totalSteps: Number(r.total_steps),
    daysAtGoal: r.days_at_goal,
    bestDay: r.best_day,
    bestSteps: r.best_steps,
  }));
}
