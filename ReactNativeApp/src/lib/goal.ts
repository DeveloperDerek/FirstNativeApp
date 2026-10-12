// Your daily goal (step-tracker-goals-streaks.txt). The server keeps the
// goal history and decides; these are the same rules for the picker and
// the screens. No imports, so `npm test` can check them.

export const GOAL_MIN = 5_000;
export const GOAL_MAX = 20_000;
export const GOAL_STEP = 500;
/** Everyone's goal until they pick one. */
export const DEFAULT_GOAL = 10_000;
/**
 * Daily coins: each player's target is 7,000 to 10,000 steps, different
 * each day (decision 2). The server picks it; this is the most it can be,
 * for before it has answered.
 */
export const COIN_STEPS_MAX = 10_000;

/** The picker's next value up (+1) or down (-1), kept in range. */
export function nudgeGoal(goal: number, direction: 1 | -1): number {
  const next = goal + direction * GOAL_STEP;
  return Math.min(GOAL_MAX, Math.max(GOAL_MIN, next));
}

export const isValidGoal = (goal: number) =>
  Number.isInteger(goal) && goal >= GOAL_MIN && goal <= GOAL_MAX && goal % GOAL_STEP === 0;

/** 0 to 1, for the progress display. */
export const goalProgress = (steps: number, goal: number) =>
  goal > 0 ? Math.min(Math.max(steps, 0) / goal, 1) : 0;

/** Steps still needed today (never below 0). */
export const stepsToGo = (steps: number, goal: number) => Math.max(goal - Math.max(steps, 0), 0);

/** "Tue, Nov 12" for a 'YYYY-MM-DD' day, read as a local date. */
export function formatStartDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
