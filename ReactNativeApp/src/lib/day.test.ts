// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dayKey, dayToUtc, parseDay } from './day.ts';

test('dayKey is the local calendar day, zero-padded', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 9, 17, 0, 0)), '2026-10-17');
});

test('parseDay is local midnight and round-trips with dayKey', () => {
  const d = parseDay('1990-05-01');
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [1990, 4, 1, 0]);
  assert.equal(dayKey(parseDay('2026-03-08')), '2026-03-08');
});

test('dayToUtc is UTC midnight', () => {
  assert.equal(dayToUtc('2026-10-17'), Date.UTC(2026, 9, 17));
  assert.equal(dayToUtc('2026-03-09') - dayToUtc('2026-03-08'), 86_400_000);
});
