import { type MyQuest, uploadQuestSteps } from '@/api/quests';
import { getSteps } from '@/health';
import type { RequestAuth } from '@/lib/request-auth';
import { hourPieces } from '@/quests/rules';

/** Quests I'm in that are taking steps: under way, or in the 1-hour grace period. */
function isTakingSteps(q: MyQuest, now: Date) {
  if (!q.in_party || !q.starts_at || !q.ends_at || q.settled_at) return false;
  if (q.status !== 'active' && q.status !== 'completed') return false;
  const graceEnd = new Date(q.ends_at).getTime() + 3_600_000;
  return new Date(q.starts_at) <= now && now.getTime() < graceEnd;
}

/**
 * Reads my steps for each hour of every running quest from Apple Health /
 * Health Connect and uploads them (section 6). Each upload replaces the
 * last, so running this often never double counts. Call it after the
 * daily totals are uploaded: the server never counts more quest steps
 * than the days they fall in.
 *
 * Takes my quests (from syncDay) and returns them with the new group
 * totals, for the banners. No call at all when none is taking steps.
 *
 * `auth` sends each upload as the account the refresh started for, and
 * none starts once `stillCurrent` says that account (or sharing) changed.
 */
export async function syncQuestSteps(
  quests: MyQuest[],
  auth?: RequestAuth,
  stillCurrent: () => boolean = () => true
): Promise<MyQuest[]> {
  const now = new Date();
  for (const q of quests.filter((q) => isTakingSteps(q, now))) {
    const pieces = hourPieces(new Date(q.starts_at!), new Date(q.ends_at!), now);
    const hours = await Promise.all(
      pieces.map(async (p) => ({
        hour: p.hour,
        // The server refuses impossible hours; cap so one odd reading
        // can't make the whole upload fail
        steps: Math.min(await getSteps(p.from, p.to), 15_000),
      }))
    );
    if (!stillCurrent()) break;
    q.total_steps = await uploadQuestSteps(q.quest_id, hours, auth);
  }
  return quests;
}
