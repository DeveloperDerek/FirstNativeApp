// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  assignLanes,
  centerFor,
  formatSteps,
  GOAL,
  pickShown,
  roadWidth,
  scaleMax,
  ticksFor,
} from './scale.ts';

describe('worked examples from step-tracker-stage6.txt', () => {
  const cases: [string, number, number][] = [
    ['scaleMax(0)', scaleMax(0), 10_000],
    ['scaleMax(10000)', scaleMax(10_000), 10_000], // character stands exactly at the flag
    ['scaleMax(10001)', scaleMax(10_001), 15_000],
    ['scaleMax(14999)', scaleMax(14_999), 15_000],
    ['scaleMax(15000)', scaleMax(15_000), 20_000],
    ['scaleMax(23400)', scaleMax(23_400), 25_000],
    ['roadWidth(10000)', roadWidth(10_000), 1128], // 64 + 1000 + 64
    ['roadWidth(15000)', roadWidth(15_000), 1628],
    ['centerFor(5000)', centerFor(5_000), 564],
  ];
  for (const [label, actual, expected] of cases) {
    test(`${label} = ${expected}`, () => assert.equal(actual, expected));
  }
});

describe('road positions', () => {
  test('0 steps sits after the start padding', () => {
    assert.equal(centerFor(0), 64);
  });
  test('negative counts are clamped to the start', () => {
    assert.equal(centerFor(-50), 64);
  });
  test('nobody moves when the road grows', () => {
    // Positions depend only on steps, never on the road's length.
    const before = [0, 5_000, 10_000].map(centerFor);
    scaleMax(12_000); // the road grows to 15,000...
    assert.deepEqual([0, 5_000, 10_000].map(centerFor), before); // ...and nobody shifts
  });
  test('the road end has the same padding as the start', () => {
    assert.equal(roadWidth(10_000) - centerFor(10_000), 64);
  });
});

describe('ticksFor', () => {
  test('every 2,500 steps', () => {
    assert.deepEqual(ticksFor(10_000), [0, 2_500, 5_000, 7_500, 10_000]);
    assert.deepEqual(ticksFor(15_000), [0, 2_500, 5_000, 7_500, 10_000, 12_500, 15_000]);
  });
  test('the goal is always on a tick', () => {
    for (let steps = 0; steps <= 100_000; steps += 777) {
      assert.ok(ticksFor(scaleMax(steps)).includes(GOAL), `missing goal for ${steps}`);
    }
  });
});

describe('assignLanes', () => {
  test('far-apart characters share the front lane', () => {
    assert.deepEqual(assignLanes([0, 100, 200], 64, 3), [0, 0, 0]);
  });
  test('three characters at the same count use three depths', () => {
    assert.deepEqual(assignLanes([150, 150, 150], 64, 3), [0, 1, 2]);
  });
  test('a fourth wraps back to the front lane', () => {
    assert.deepEqual(assignLanes([150, 150, 150, 150], 64, 3), [0, 1, 2, 0]);
  });
  test('lanes are reused once there is room again', () => {
    assert.deepEqual(assignLanes([0, 10, 100], 64, 3), [0, 1, 0]);
  });
  test('results follow the input order', () => {
    assert.deepEqual(assignLanes([100, 0, 10], 64, 3), [0, 0, 1]);
  });
});

describe('pickShown', () => {
  const w = (id: string, steps: number, isMe = false) => ({ id, steps, isMe });
  test('keeps the top N', () => {
    const shown = pickShown([w('a', 1), w('b', 5), w('c', 3)], 2);
    assert.deepEqual(
      shown.map((x) => x.id),
      ['b', 'c']
    );
  });
  test('always includes you', () => {
    const shown = pickShown([w('a', 9), w('b', 8), w('me', 1, true)], 2);
    assert.deepEqual(
      shown.map((x) => x.id),
      ['a', 'b', 'me']
    );
  });
});

describe('formatSteps', () => {
  test('short labels', () => {
    assert.equal(formatSteps(0), '0');
    assert.equal(formatSteps(2_500), '2.5k');
    assert.equal(formatSteps(10_000), '10k');
  });
});
