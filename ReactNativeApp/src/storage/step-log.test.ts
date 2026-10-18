// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dayKey, HISTORY_DAYS, type KeyValueStore, pruneLog, saveDays, stepsKey } from './step-log.ts';

test('each account gets its own key', () => {
  assert.equal(stepsKey('a1'), 'steps-by-day:a1');
  assert.notEqual(stepsKey('a1'), stepsKey('b2'));
});

test('dayKey uses the local calendar day', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('pruning keeps the last 7 days, counting today, and drops older ones', () => {
  const now = new Date(2026, 9, 10, 12);
  const log: Record<string, number> = {};
  for (let daysAgo = 0; daysAgo < 10; daysAgo++) {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    log[dayKey(d)] = daysAgo;
  }
  const kept = pruneLog(log, HISTORY_DAYS, now);
  assert.equal(HISTORY_DAYS, 7);
  assert.deepEqual(Object.keys(kept).sort(), [
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
    '2026-10-10',
  ]);
});

test('pruning works across a month boundary', () => {
  const now = new Date(2026, 10, 2); // 2 November
  const kept = pruneLog({ '2026-10-26': 1, '2026-10-27': 2, '2026-11-02': 3 }, 7, now);
  assert.deepEqual(kept, { '2026-10-27': 2, '2026-11-02': 3 });
});

/** A store whose reads wait until the test opens them. */
function heldStore() {
  const data = new Map<string, string>();
  let open!: () => void;
  const held = new Promise<void>((res) => (open = res));
  const store: KeyValueStore = {
    getItem: async (key) => {
      await held;
      return data.get(key) ?? null;
    },
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
  return { data, store, open };
}

test('saving adds the days to the account\'s history', async () => {
  const { data, store, open } = heldStore();
  open();
  const today = new Date();
  const saved = await saveDays(store, 'a1', [[today, 4200]]);
  assert.deepEqual(saved, { [dayKey(today)]: 4200 });
  assert.equal(data.get(stepsKey('a1')), JSON.stringify(saved));
});

test('a sign-out during the read means nothing is written back', async () => {
  const { data, store, open } = heldStore();
  data.set(stepsKey('a1'), JSON.stringify({ [dayKey(new Date())]: 100 }));
  let current = true;
  const saving = saveDays(store, 'a1', [[new Date(), 4200]], () => current);
  // Sign-out: the guard changes, then the history is removed
  current = false;
  data.delete(stepsKey('a1'));
  open();
  assert.equal(await saving, null);
  assert.equal(data.has(stepsKey('a1')), false);
});
