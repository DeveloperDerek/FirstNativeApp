// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { goalProgress, stepsToGo } from './goal.ts';

test('progress and steps to go follow the goal (a past day can have an old custom one)', () => {
  assert.equal(goalProgress(5_000, 10_000), 0.5);
  assert.equal(goalProgress(5_000, 7_500), 2 / 3);
  assert.equal(goalProgress(9_000, 7_500), 1);
  assert.equal(stepsToGo(5_000, 7_500), 2_500);
  assert.equal(stepsToGo(9_000, 7_500), 0);
});
