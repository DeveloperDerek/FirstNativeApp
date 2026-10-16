// The math behind Today's minimap: the whole road on one bar under it.
// No UI here, so it is easy to unit test (minimap-math.test.ts, `npm test`).
// See docs/step-tracker-minimap.txt.

import { centerFor, PX_PER_STEP, ROAD_PAD, roadWidth } from './scale.ts';

/** Empty space at each end of the bar, so an icon at 0 or the end fits. */
export const BAR_INSET = 16;

/** Where a step count sits on the bar, in whole points from its left. */
export function barX(steps: number, max: number, barWidth: number): number {
  'worklet';
  const span = barWidth - 2 * BAR_INSET;
  const t = Math.min(1, Math.max(0, steps / max));
  return Math.round(BAR_INSET + t * span);
}

/** The step count at a point on the bar (taps and drags), in whole steps. */
export function stepsAt(x: number, max: number, barWidth: number): number {
  const span = barWidth - 2 * BAR_INSET;
  const t = Math.min(1, Math.max(0, (x - BAR_INSET) / span));
  return Math.round(t * max);
}

/**
 * The bracket over the part of the bar that is on screen: the road's
 * scroll position turned into the steps at each screen edge, then into
 * bar points. Runs on the UI thread as the road scrolls.
 */
export function viewportOnBar(
  scrollX: number,
  viewport: number,
  max: number,
  barWidth: number
): { left: number; width: number } {
  'worklet';
  const fromSteps = (scrollX - ROAD_PAD) / PX_PER_STEP;
  const toSteps = (scrollX + viewport - ROAD_PAD) / PX_PER_STEP;
  const left = barX(fromSteps, max, barWidth);
  const right = barX(toSteps, max, barWidth);
  return { left, width: Math.max(2, right - left) };
}

/** Where to scroll the road so `steps` is in the middle of the screen. */
export function scrollFor(steps: number, max: number, viewport: number): number {
  const most = Math.max(0, roadWidth(max) - viewport);
  return Math.min(most, Math.max(0, Math.round(centerFor(steps) - viewport / 2)));
}

/** Labels under the bar: every 2,500, or every 5,000 once the road is long. */
export function labelsFor(max: number): number[] {
  const every = max >= 20_000 ? 5_000 : 2_500;
  const labels: number[] = [];
  for (let v = 0; v <= max; v += every) labels.push(v);
  return labels;
}

/** A landmark stands every 5,000 steps along the road (see StepTrack). */
export function milestonesFor(max: number): number[] {
  const steps: number[] = [];
  for (let v = 0; v <= max; v += 5_000) steps.push(v);
  return steps;
}

export type IconGroup<T> = {
  /** Shown for the group: whoever has the most steps in it */
  leader: T;
  /** How many others are behind the leader's icon */
  others: number;
  x: number;
};

/**
 * Everyone but you, as icons on the bar. People whose icons would
 * overlap (closer than `gap` points) share one icon: the leader's, with
 * a count. You are left out: your icon has its own place on top.
 */
export function groupIcons<T extends { steps: number; isMe: boolean }>(
  people: T[],
  max: number,
  barWidth: number,
  gap: number
): IconGroup<T>[] {
  const placed = people
    .filter((p) => !p.isMe)
    .map((p) => ({ p, x: barX(p.steps, max, barWidth) }))
    .sort((a, b) => a.x - b.x);
  const groups: { members: typeof placed }[] = [];
  for (const item of placed) {
    const last = groups[groups.length - 1];
    // Joins the group when close to the group's first icon, so a long
    // line of people doesn't all chain into one
    if (last && item.x - last.members[0].x < gap) last.members.push(item);
    else groups.push({ members: [item] });
  }
  return groups.map(({ members }) => {
    const lead = members.reduce((best, m) => (m.p.steps > best.p.steps ? m : best));
    return { leader: lead.p, others: members.length - 1, x: lead.x };
  });
}

/**
 * The next milestone after (or before) a step count, for the screen
 * reader's swipe up and down: landmarks, your goal and your own spot.
 */
export function nextStop(stops: number[], from: number, direction: 1 | -1): number | undefined {
  const sorted = [...new Set(stops)].sort((a, b) => a - b);
  if (direction > 0) return sorted.find((s) => s > from + 1);
  return [...sorted].reverse().find((s) => s < from - 1);
}
