// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { coinsEach, durationText, groupMultiplier, hourPieces, stepCoins } from './rules.ts';

describe('coins (step-tracker-group-quests.txt, sections 3 and 5)', () => {
  test('the table of coins each at exactly the goal', () => {
    const goals = [8_000, 15_000, 30_000, 50_000, 120_000];
    const expected = [
      [24, 16, 12],
      [45, 30, 23],
      [90, 60, 45],
      [150, 100, 75],
      [360, 240, 180],
    ];
    goals.forEach((goal, i) =>
      [2, 4, 8].forEach((party, j) => assert.equal(coinsEach(goal, goal, party), expected[i][j]))
    );
  });

  test('worked examples', () => {
    assert.equal(stepCoins(10_000, 8_000), 50);
    assert.equal(groupMultiplier(4), 1.6);
    assert.equal(coinsEach(10_000, 8_000, 4), 20);
    assert.equal(coinsEach(12_000, 8_000, 2), 36); // 2-member Sprint at 150%
    assert.equal(coinsEach(200_000, 120_000, 2), 540); // capped at 150%
  });

  test('multiplier', () => {
    assert.equal(groupMultiplier(1), 1);
    assert.equal(groupMultiplier(2), 1.2);
    assert.equal(groupMultiplier(6), 2);
    assert.equal(groupMultiplier(20), 2.5);
  });

  test('at least 10 each', () => {
    assert.equal(coinsEach(8_000, 8_000, 30), 10);
  });
});

describe('hourPieces', () => {
  const start = new Date('2026-10-09T06:15:00Z');
  const end = new Date('2026-10-09T08:15:00Z');

  test('cut to now while the quest runs', () => {
    const pieces = hourPieces(start, end, new Date('2026-10-09T07:40:00Z'));
    assert.deepEqual(
      pieces.map((p) => [p.hour, p.from.toISOString(), p.to.toISOString()]),
      [
        [0, '2026-10-09T06:15:00.000Z', '2026-10-09T07:15:00.000Z'],
        [1, '2026-10-09T07:15:00.000Z', '2026-10-09T07:40:00.000Z'],
      ]
    );
  });

  test('stops at the end after the window', () => {
    const pieces = hourPieces(start, end, new Date('2026-10-09T09:00:00Z'));
    assert.equal(pieces.length, 2);
    assert.equal(pieces[1].to.toISOString(), end.toISOString());
  });

  test('nothing before the start', () => {
    assert.equal(hourPieces(start, end, new Date('2026-10-09T06:00:00Z')).length, 0);
  });
});

test('durationText', () => {
  assert.equal(durationText(72 * 60_000), '1h 12m');
  assert.equal(durationText(45 * 60_000), '45m');
  assert.equal(durationText(51 * 3_600_000), '2d 3h');
});
