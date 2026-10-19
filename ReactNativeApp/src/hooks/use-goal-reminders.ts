import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import type { MyGoal, MyStreak } from '@/api/goals';
import { type ReminderState, rescheduleReminders } from '@/reminders/reminders';
import type { RollState } from '@/roll/roll';

/** What a reminder needs to know, from the steps and goal the app has now. */
export function reminderState(
  today: number | null,
  goal: MyGoal | null,
  streak: MyStreak | null,
  roll: RollState = null
): ReminderState {
  const goalToday = goal?.today ?? (streak?.sharing ? streak.goal_today : null);
  return {
    goalReachedToday: today !== null && goalToday !== null && today >= goalToday,
    // Only a streak the server confirmed, still to be kept going today
    streak: streak?.sharing && !streak.today_done ? streak.current : null,
    rollWaiting: roll?.state === 'ready',
  };
}

/**
 * Keeps the goal reminders right (step-tracker-history-reminders.txt, part
 * B, "How it stays right"): after every refresh of steps, and every time
 * the app comes back to the front.
 */
export function useGoalReminders({
  userId,
  loading,
  today,
  goal,
  streak,
  roll,
}: {
  userId: string | undefined;
  loading: boolean;
  today: number | null;
  goal: MyGoal | null;
  streak: MyStreak | null;
  roll: RollState;
}) {
  const latest = useRef({ userId, state: reminderState(today, goal, streak, roll) });
  useEffect(() => {
    latest.current = { userId, state: reminderState(today, goal, streak, roll) };
  }, [userId, today, goal, streak, roll]);

  // After each refresh finishes, with what it found
  useEffect(() => {
    if (!userId || loading) return;
    rescheduleReminders(userId, reminderState(today, goal, streak, roll)).catch(() => {});
  }, [userId, loading, today, goal, streak, roll]);

  // Every open: reminders the phone dropped, or permission given back
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      const { userId: id, state } = latest.current;
      if (s === 'active' && id) rescheduleReminders(id, state).catch(() => {});
    });
    return () => sub.remove();
  }, []);
}
