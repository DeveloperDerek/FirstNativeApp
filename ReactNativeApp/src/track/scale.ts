// The math behind the step track. No UI here, so it is easy to unit test
// (see scale.test.ts, run with `npm test`).

export const GOAL = 10_000;
// Every scale maximum is a multiple of this. Ticks are 2,500 / 5,000 /
// 10,000 apart, so the GOAL always lands on a tick; re-check that if
// you change it.
const GROW_BY = 5_000;

/** Highest value shown on the scale. Grows past the goal so the leader has room ahead. */
export function scaleMax(highestSteps: number): number {
  if (highestSteps <= GOAL) return GOAL;
  return (Math.floor(highestSteps / GROW_BY) + 1) * GROW_BY;
}

/** Left edge of a character, in pixels. */
export function positionFor(
  steps: number,
  max: number,
  trackWidth: number,
  spriteWidth: number
): number {
  const usable = Math.max(0, trackWidth - spriteWidth);
  const ratio = Math.min(1, Math.max(0, steps / max));
  return ratio * usable;
}

/** Tick marks: 0, then even spacing up to max. */
export function ticksFor(max: number): number[] {
  const every = max <= 10_000 ? 2_500 : max <= 40_000 ? 5_000 : 10_000;
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += every) ticks.push(v);
  return ticks;
}

/**
 * Put overlapping characters on different rows.
 * Returns a lane number (0 = front row) for each x, same order as input.
 */
export function assignLanes(xs: number[], spriteWidth: number): number[] {
  const minGap = spriteWidth * 0.7; // allow a little overlap
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const laneEnds: number[] = []; // right edge used per lane
  const lanes = new Array<number>(xs.length).fill(0);
  for (const { x, i } of order) {
    let lane = laneEnds.findIndex((end) => x >= end);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = x + minGap;
    lanes[i] = lane;
  }
  return lanes;
}

/**
 * Who gets drawn on the track when there are many people: the top
 * `limit` by steps, plus you if you're not among them. Everyone still
 * appears in the ranked list below the track.
 */
export function pickShown<T extends { steps: number; isMe: boolean }>(
  walkers: T[],
  limit: number
): T[] {
  const ranked = [...walkers].sort((a, b) => b.steps - a.steps);
  const top = ranked.slice(0, limit);
  const me = ranked.find((w) => w.isMe);
  return me && !top.includes(me) ? [...top, me] : top;
}

export const formatSteps = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `${n}`;
