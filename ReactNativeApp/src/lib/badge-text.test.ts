// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { badgeText } from './badge-text.ts';

test('badge is hidden at 0, a number up to 9, then "9+"', () => {
  assert.equal(badgeText(0), undefined);
  assert.equal(badgeText(-1), undefined);
  assert.equal(badgeText(1), '1');
  assert.equal(badgeText(9), '9');
  assert.equal(badgeText(10), '9+');
  assert.equal(badgeText(250), '9+');
});
