// The math behind Today's minimap: the whole road on one bar under it.
// No UI here, so it is easy to unit test (minimap-math.test.ts, `npm test`).
// See docs/step-tracker-minimap.txt.

import { centerFor, PX_PER_STEP, ROAD_PAD, roadWidth } from './scale.ts';

/** Empty space at each end of the bar, so an icon at 0 or the end fits. */
export const BAR_INSET = 16;

/**
 * Where a step count sits on the bar, in whole points from its left.
 * `inset` is the empty space kept at each end.
 */
export function barX(steps: number, max: number, barWidth: number, inset = BAR_INSET): number {
  'worklet';
  const span = barWidth - 2 * inset;
  const t = Math.min(1, Math.max(0, steps / max));
  return Math.round(inset + t * span);
}

/** The step count at a point on the bar (taps and drags), in whole steps. */
export function stepsAt(x: number, max: number, barWidth: number, inset = BAR_INSET): number {
  const span = barWidth - 2 * inset;
  const t = Math.min(1, Math.max(0, (x - inset) / span));
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
  barWidth: number,
  inset = BAR_INSET
): { left: number; width: number } {
  'worklet';
  const fromSteps = (scrollX - ROAD_PAD) / PX_PER_STEP;
  const toSteps = (scrollX + viewport - ROAD_PAD) / PX_PER_STEP;
  const left = barX(fromSteps, max, barWidth, inset);
  const right = barX(toSteps, max, barWidth, inset);
  return { left, width: Math.max(2, right - left) };
}

/** Where to scroll the road so `steps` is in the middle of the screen. */
export function scrollFor(steps: number, max: number, viewport: number): number {
  const most = Math.max(0, roadWidth(max) - viewport);
  return Math.min(most, Math.max(0, Math.round(centerFor(steps) - viewport / 2)));
}

/** A landmark stands every 5,000 steps along the road (see StepTrack). */
export function milestonesFor(max: number): number[] {
  const steps: number[] = [];
  for (let v = 0; v <= max; v += 5_000) steps.push(v);
  return steps;
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
