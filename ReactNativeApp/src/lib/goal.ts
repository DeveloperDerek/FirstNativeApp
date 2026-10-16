// The daily goal (step-tracker-goals-streaks.txt): 10,000 for everyone.
// No imports, so `npm test` can check these.

/** Everyone's daily goal. */
export const DEFAULT_GOAL = 10_000;
/**
 * Daily coins: each player's target is 7,000 to 10,000 steps, different
 * each day (decision 2). The server picks it; this is the most it can be,
 * for before it has answered.
 */
export const COIN_STEPS_MAX = 10_000;

/** 0 to 1, for the progress display. */
export const goalProgress = (steps: number, goal: number) =>
  goal > 0 ? Math.min(Math.max(steps, 0) / goal, 1) : 0;

/** Steps still needed today (never below 0). */
export const stepsToGo = (steps: number, goal: number) => Math.max(goal - Math.max(steps, 0), 0);
