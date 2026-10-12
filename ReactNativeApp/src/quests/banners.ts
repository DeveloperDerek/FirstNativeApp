import type { MyQuest } from '@/api/quests';
import { durationText, questType } from '@/quests/rules';

const GRACE_MS = 3_600_000;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * One line for a quest that needs me (section 7, "Notifications"). Until
 * the app has push notifications these show as banners when it opens.
 * null = nothing to say (e.g. I joined after the party was fixed).
 */
export function bannerText(q: MyQuest, now = Date.now()): string | null {
  const name = questType(q.type_id).name;
  const steps = `${q.total_steps.toLocaleString()} / ${q.goal.toLocaleString()}`;

  if (!q.in_party || !q.starts_at || !q.ends_at) return null;

  if (q.settled_at) {
    if (q.result_seen) return null;
    if (q.status === 'completed') {
      return `Quest finished: ${q.total_steps.toLocaleString()} steps.${
        q.coins_paid ? ` +${q.coins_paid} coins` : ''
      }`;
    }
    return `The party reached ${Math.floor((q.total_steps / q.goal) * 100)}% of the ${name}. Try again soon!`;
  }

  const start = new Date(q.starts_at).getTime();
  const end = new Date(q.ends_at).getTime();
  if (now < start) {
    return `${q.proposer_name || 'Someone'} started a ${name}. It begins at ${clock(q.starts_at)}.`;
  }
  if (now >= end) {
    return `Time's up! Steps sent in the next ${durationText(end + GRACE_MS - now)} still count.`;
  }
  if (q.status === 'completed') {
    return `Goal reached! Keep walking until ${clock(q.ends_at)} to earn more coins.`;
  }
  return `Your ${name} is on: ${steps} with ${durationText(end - now)} left.`;
}
