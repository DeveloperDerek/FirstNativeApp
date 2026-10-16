// The daily goal (step-tracker-goals-streaks.txt): each player's coin
// target, 7,000 to 10,000 steps, different each day (GOAL-16). The server
// picks it. No imports, so `npm test` can check these.

/** The most a day's goal can be, shown until the server has answered. */
export const DEFAULT_GOAL = 10_000;

/** 0 to 1, for the progress display. */
export const goalProgress = (steps: number, goal: number) =>
  goal > 0 ? Math.min(Math.max(steps, 0) / goal, 1) : 0;

/** Steps still needed today (never below 0). */
export const stepsToGo = (steps: number, goal: number) => Math.max(goal - Math.max(steps, 0), 0);
