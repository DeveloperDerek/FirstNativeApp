// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyItemOrder, mergeRowOrder } from './item-order.ts';

const row = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (items: { id: string }[]) => items.map((x) => x.id);

test('saved ids come first in saved order, the rest keep their default order', () => {
  assert.deepEqual(ids(applyItemOrder(row('a', 'b', 'c', 'd'), ['c', 'a'])), ['c', 'a', 'b', 'd']);
});

test('ids from other rows or no longer owned are ignored', () => {
  assert.deepEqual(ids(applyItemOrder(row('a', 'b'), ['x', 'b', 'y'])), ['b', 'a']);
});

test('rearranging one row leaves the other rows ids in place', () => {
  assert.deepEqual(mergeRowOrder(['hat1', 'pet1', 'hat2'], ['pet2', 'pet1']), [
    'hat1',
    'hat2',
    'pet2',
    'pet1',
  ]);
});
