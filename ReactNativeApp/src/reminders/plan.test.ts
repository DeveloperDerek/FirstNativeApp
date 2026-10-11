// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_REMINDERS,
  oneAtATime,
  parseReminderSettings,
  PLAIN_TEXT,
  planReminders,
  REMINDER_PREFIX,
  syncReminders,
} from './plan.ts';

const on = { on: true, hour: 19, minute: 0 };
// 2026-10-11 at the given local time
const at = (h: number, m = 0) => new Date(2026, 9, 11, h, m);
const plan = (now: Date, goalReachedToday = false, streak: number | null = null, settings = on) =>
  planReminders({ settings, now, goalReachedToday, streak });

test('off: nothing at all', () => {
  assert.deepEqual(plan(at(9), false, 6, { ...on, on: false }), []);
  assert.equal(DEFAULT_REMINDERS.on, false);
  assert.equal(DEFAULT_REMINDERS.hour, 19);
});

test('before the time, goal not reached: today and the next 6 days', () => {
  const p = plan(at(9));
  assert.equal(p.length, 7);
  assert.deepEqual(
    p.map((r) => r.id),
    [11, 12, 13, 14, 15, 16, 17].map((d) => `${REMINDER_PREFIX}2026-10-${d}`)
  );
  for (const r of p) {
    assert.equal(r.date.getHours(), 19);
    assert.equal(r.date.getMinutes(), 0);
  }
});

test('none today once the goal is reached, or after the time', () => {
  assert.equal(plan(at(9), true)[0].id, `${REMINDER_PREFIX}2026-10-12`);
  assert.equal(plan(at(9), true).length, 6);
  assert.equal(plan(at(19, 1)).length, 6);
  assert.equal(plan(at(19, 0)).length, 6, 'exactly at the time is too late');
  assert.equal(plan(at(18, 59)).length, 7, 'a minute before still comes');
});

test('the streak only in today\'s reminder, from 2 days', () => {
  const p = plan(at(9), false, 6);
  assert.equal(p[0].body, `Keep your 6-day streak going. ${PLAIN_TEXT}`);
  for (const r of p.slice(1)) assert.equal(r.body, PLAIN_TEXT, 'later days never mention it');
  assert.equal(plan(at(9), false, 1)[0].body, PLAIN_TEXT, 'a 1-day streak isn\'t mentioned');
  assert.equal(plan(at(9), false, null)[0].body, PLAIN_TEXT, 'not sharing: always plain');
  // Today's already gone: no reminder mentions it
  assert.ok(plan(at(20), false, 6).every((r) => r.body === PLAIN_TEXT));
});

test('one per date, and every id is a goal reminder', () => {
  const ids = plan(at(9)).map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith(REMINDER_PREFIX)));
});

test('just before and after midnight, the days move along', () => {
  const late = planReminders({ settings: on, now: new Date(2026, 9, 11, 23, 59), goalReachedToday: false, streak: null });
  const early = planReminders({ settings: on, now: new Date(2026, 9, 12, 0, 1), goalReachedToday: false, streak: null });
  assert.equal(late[0].id, `${REMINDER_PREFIX}2026-10-12`);
  assert.equal(early[0].id, `${REMINDER_PREFIX}2026-10-12`);
  assert.equal(early.at(-1)!.id, `${REMINDER_PREFIX}2026-10-18`);
});

test('across the end of a month', () => {
  const p = planReminders({ settings: on, now: new Date(2026, 9, 29, 9), goalReachedToday: false, streak: null });
  assert.equal(p.at(-1)!.id, `${REMINDER_PREFIX}2026-11-04`);
});

test('saved settings: read back, or the default if unreadable', () => {
  assert.deepEqual(parseReminderSettings(JSON.stringify({ on: true, hour: 7, minute: 30 })), {
    on: true,
    hour: 7,
    minute: 30,
  });
  for (const bad of [null, '', 'not json', '{"on":true,"hour":24,"minute":0}', '{"hour":7,"minute":0}']) {
    assert.deepEqual(parseReminderSettings(bad), DEFAULT_REMINDERS, String(bad));
  }
});

/** A phone's scheduled notifications. `replaces` = scheduling an id again replaces it. */
function fakeStore(replaces: boolean, existing: string[] = []) {
  const scheduled: string[] = [...existing];
  const store = {
    scheduled,
    scheduledIds: async () => {
      await new Promise((r) => setTimeout(r, 1)); // let other runs interleave if they could
      return [...scheduled];
    },
    cancel: async (id: string) => {
      const i = scheduled.indexOf(id);
      if (i >= 0) scheduled.splice(i, 1);
    },
    schedule: async (r: { id: string }) => {
      await new Promise((res) => setTimeout(res, 1));
      if (replaces && scheduled.includes(r.id)) return;
      scheduled.push(r.id);
    },
  };
  return store;
}

test('rescheduling again and again: at most one per date, others untouched', async () => {
  for (const replaces of [true, false]) {
    const store = fakeStore(replaces, ['friend-request-1']);
    const queue = oneAtATime();
    const ours = () => store.scheduled.filter((id) => id.startsWith(REMINDER_PREFIX));
    // Five opens at once...
    await Promise.all(Array.from({ length: 5 }, () => queue(() => syncReminders(store, plan(at(9))))));
    assert.equal(ours().length, 7, `at once, replaces=${replaces}`);
    // ...then five in a row
    for (let i = 0; i < 5; i++) await queue(() => syncReminders(store, plan(at(9))));
    assert.equal(ours().length, 7, `in a row, replaces=${replaces}`);
    assert.equal(new Set(ours()).size, 7, 'no duplicates');
    assert.ok(store.scheduled.includes('friend-request-1'), 'another notification is never cancelled');
  }
});

test('turning reminders off leaves no goal reminder, and nothing else goes', async () => {
  const store = fakeStore(false, ['friend-request-1']);
  await syncReminders(store, plan(at(9)));
  await syncReminders(store, plan(at(9), false, null, { ...on, on: false }));
  assert.deepEqual(store.scheduled, ['friend-request-1']);
});

test('changing the time: still one per date', async () => {
  const store = fakeStore(false);
  await syncReminders(store, plan(at(9)));
  await syncReminders(store, plan(at(9), false, null, { ...on, hour: 8, minute: 30 }));
  assert.equal(store.scheduled.length, 6, 'today\'s 8:30 has passed at 9:00');
});

test('one at a time: a failed run doesn\'t stop the next', async () => {
  const queue = oneAtATime();
  const order: string[] = [];
  const first = queue(async () => {
    await new Promise((r) => setTimeout(r, 5));
    order.push('first');
    throw new Error('boom');
  });
  const second = queue(async () => order.push('second'));
  await assert.rejects(first);
  await second;
  assert.deepEqual(order, ['first', 'second']);
});
