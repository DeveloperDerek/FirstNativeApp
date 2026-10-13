// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { goalProgress, isValidGoal, nudgeGoal, stepsToGo } from './goal.ts';

test('the picker moves in 500s and stays in 5,000 to 20,000', () => {
  assert.equal(nudgeGoal(10_000, 1), 10_500);
  assert.equal(nudgeGoal(10_000, -1), 9_500);
  assert.equal(nudgeGoal(5_000, -1), 5_000);
  assert.equal(nudgeGoal(20_000, 1), 20_000);
});

test('valid goals are the ones the server accepts', () => {
  for (const ok of [5_000, 7_500, 10_000, 20_000]) assert.ok(isValidGoal(ok), String(ok));
  for (const bad of [3_000, 4_500, 20_500, 25_000, 7_250, 7_500.5]) assert.ok(!isValidGoal(bad), String(bad));
});

test('progress and steps to go follow whichever goal it is', () => {
  assert.equal(goalProgress(5_000, 10_000), 0.5);
  assert.equal(goalProgress(5_000, 7_500), 2 / 3);
  assert.equal(goalProgress(9_000, 7_500), 1);
  assert.equal(stepsToGo(5_000, 7_500), 2_500);
  assert.equal(stepsToGo(9_000, 7_500), 0);
});
