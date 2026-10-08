// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  assignLanes,
  formatSteps,
  GOAL,
  pickShown,
  positionFor,
  scaleMax,
  ticksFor,
} from './scale.ts';

describe('scaleMax (worked examples from step-tracker-stage5.txt)', () => {
  const cases: [number, number][] = [
    [0, 10_000],
    [10_000, 10_000], // character stands exactly on the flag
    [10_001, 15_000],
    [14_999, 15_000],
    [15_000, 20_000],
    [23_400, 25_000],
  ];
  for (const [steps, max] of cases) {
    test(`scaleMax(${steps}) = ${max}`, () => assert.equal(scaleMax(steps), max));
  }
});

describe('positionFor', () => {
  test('0 steps is the left edge, the max is the right edge', () => {
    assert.equal(positionFor(0, 10_000, 364, 64), 0);
    assert.equal(positionFor(10_000, 10_000, 364, 64), 300);
  });
  test('halfway is half of the usable width', () => {
    assert.equal(positionFor(5_000, 10_000, 364, 64), 150);
  });
  test('out-of-range values are clamped', () => {
    assert.equal(positionFor(-5, 10_000, 364, 64), 0);
    assert.equal(positionFor(99_999, 10_000, 364, 64), 300);
  });
  test('a track narrower than a sprite does not go negative', () => {
    assert.equal(positionFor(5_000, 10_000, 10, 64), 0);
  });
  test('the goal flag slides left when the scale grows to 15,000', () => {
    const before = positionFor(GOAL, scaleMax(10_000), 364, 64);
    const after = positionFor(GOAL, scaleMax(12_000), 364, 64);
    assert.equal(before, 300);
    assert.equal(after, 200);
  });
});

describe('ticksFor', () => {
  test('2,500 apart up to 10,000', () => {
    assert.deepEqual(ticksFor(10_000), [0, 2_500, 5_000, 7_500, 10_000]);
  });
  test('5,000 apart up to 40,000', () => {
    assert.deepEqual(ticksFor(15_000), [0, 5_000, 10_000, 15_000]);
  });
  test('10,000 apart beyond 40,000', () => {
    assert.deepEqual(ticksFor(45_000), [0, 10_000, 20_000, 30_000, 40_000]);
  });
  test('the goal is always on a tick', () => {
    for (let steps = 0; steps <= 100_000; steps += 777) {
      assert.ok(ticksFor(scaleMax(steps)).includes(GOAL), `missing goal for ${steps}`);
    }
  });
});

describe('assignLanes', () => {
  test('far-apart characters share the front row', () => {
    assert.deepEqual(assignLanes([0, 100, 200], 64), [0, 0, 0]);
  });
  test('two characters at the same count get separate lanes', () => {
    assert.deepEqual(assignLanes([150, 150], 64), [0, 1]);
  });
  test('lanes are reused once there is room again', () => {
    assert.deepEqual(assignLanes([0, 10, 100], 64), [0, 1, 0]);
  });
  test('results follow the input order', () => {
    assert.deepEqual(assignLanes([100, 0, 10], 64), [0, 0, 1]);
  });
});

describe('pickShown', () => {
  const w = (id: string, steps: number, isMe = false) => ({ id, steps, isMe });
  test('keeps the top N', () => {
    const shown = pickShown([w('a', 1), w('b', 5), w('c', 3)], 2);
    assert.deepEqual(shown.map((x) => x.id), ['b', 'c']);
  });
  test('always includes you', () => {
    const shown = pickShown([w('a', 9), w('b', 8), w('me', 1, true)], 2);
    assert.deepEqual(shown.map((x) => x.id), ['a', 'b', 'me']);
  });
});

describe('formatSteps', () => {
  test('short labels', () => {
    assert.equal(formatSteps(0), '0');
    assert.equal(formatSteps(2_500), '2.5k');
    assert.equal(formatSteps(10_000), '10k');
  });
});
