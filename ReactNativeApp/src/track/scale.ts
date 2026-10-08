// The math behind the scrolling step road. No UI here, so it is easy to
// unit test (see scale.test.ts, run with `npm test`).

export const GOAL = 10_000;
// The road grows in this step. Every road end is a multiple of it, and
// ticks are 2,500 apart, so the GOAL always lands on a tick.
const GROW_BY = 5_000;

/** Where the road ends. Grows past the goal so the leader has room ahead. */
export function scaleMax(highestSteps: number): number {
  if (highestSteps <= GOAL) return GOAL;
  return (Math.floor(highestSteps / GROW_BY) + 1) * GROW_BY;
}

// The road has a fixed distance per step and scrolls sideways, so
// characters stay spread out and nobody moves when the road grows.
export const PX_PER_STEP = 0.1; // 1,000 steps = 100 points of road
export const ROAD_PAD = 64; // empty road before 0 and after the end

/** Total scrollable width of the road, in points. */
export function roadWidth(max: number): number {
  return ROAD_PAD * 2 + max * PX_PER_STEP;
}

/** Horizontal CENTER of anything placed at a step value. */
export function centerFor(steps: number): number {
  return ROAD_PAD + Math.max(0, steps) * PX_PER_STEP;
}

/** Tick marks every 2,500 steps (the road is long, so they never crowd). */
export function ticksFor(max: number): number[] {
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += 2_500) ticks.push(v);
  return ticks;
}

/**
 * Characters that would overlap get different depths on the road.
 * Returns a lane (0 = nearest the viewer) per x, same order as input.
 * The road is only so deep, so lanes wrap after `maxLanes`.
 */
export function assignLanes(xs: number[], spriteWidth: number, maxLanes: number): number[] {
  const minGap = spriteWidth * 0.7; // allow a little overlap
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const laneEnds: number[] = []; // right edge used per lane
  const lanes = new Array<number>(xs.length).fill(0);
  for (const { x, i } of order) {
    let lane = laneEnds.findIndex((end) => x >= end);
    if (lane === -1) lane = laneEnds.length;
    lane = lane % maxLanes;
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
