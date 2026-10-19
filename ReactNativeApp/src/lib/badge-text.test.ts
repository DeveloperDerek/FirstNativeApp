// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { badgeText, friendsBadge } from './badge-text.ts';

test('badge is hidden at 0, a number up to 9, then "9+"', () => {
  assert.equal(badgeText(0), undefined);
  assert.equal(badgeText(-1), undefined);
  assert.equal(badgeText(1), '1');
  assert.equal(badgeText(9), '9');
  assert.equal(badgeText(10), '9+');
  assert.equal(badgeText(250), '9+');
});

test('Friends: a number for requests, a dot for kudos only', () => {
  assert.deepEqual(friendsBadge(0, 0), { hidden: true });
  assert.deepEqual(friendsBadge(0, 3), { hidden: false }, 'kudos only: the dot');
  assert.deepEqual(friendsBadge(2, 3), { hidden: false, text: '2' }, 'both: the number');
  assert.deepEqual(friendsBadge(2, 0), { hidden: false, text: '2' });
});
