import type { MyStreak } from '@/api/goals';
import { ThemedText } from '@/components/themed-text';
import { stepsToGo } from '@/lib/goal';

/**
 * Today's streak line (step-tracker-goals-streaks.txt, Part B). The server
 * counts uploaded days; today also counts the moment the phone's own steps
 * reach the goal, before they're uploaded.
 */
export function StreakLine({
  streak,
  steps,
  color,
}: {
  streak: MyStreak | null;
  /** Today's steps on this phone */
  steps: number;
  color: string;
}) {
  if (!streak) return null;
  if (!streak.sharing) {
    return (
      <ThemedText type="small" style={{ color }}>
        Share your steps to keep a streak
      </ThemedText>
    );
  }
  const doneHere = steps >= streak.goal_today;
  const done = streak.today_done || doneHere;
  // The server's count runs to yesterday until today's upload arrives
  const current = !streak.today_done && doneHere ? streak.current + 1 : streak.current;
  const best = Math.max(streak.best, current);
  if (current === 0) return null;

  const days = `${current}-day streak`;
  return (
    <ThemedText type="small" style={{ color }} accessibilityLiveRegion="polite">
      {done
        ? `${days} · best ${best}`
        : `${days}. ${stepsToGo(steps, streak.goal_today).toLocaleString()} steps to keep it going.`}
    </ThemedText>
  );
}
