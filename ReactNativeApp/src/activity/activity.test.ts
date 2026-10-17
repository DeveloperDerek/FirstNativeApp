// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  type ActivityLine,
  appendPage,
  dayLabel,
  hasNew,
  lineBadge,
  lineLabel,
  lineText,
  nextCursor,
  PAGE_SIZE,
  showable,
  withoutPerson,
} from './activity.ts';

const line = (extra: Partial<ActivityLine> = {}): ActivityLine => ({
  day: '2026-10-17',
  at: '2026-10-17T15:00:00+00:00',
  user_id: 'sam',
  display_name: 'Sam',
  avatar: null,
  goal: false,
  coins: null,
  achievements: [],
  ...extra,
});

test('the words for each mix', () => {
  assert.equal(lineText(line({ goal: true }), false), 'reached their goal');
  assert.equal(lineText(line({ achievements: ['streak_7'] }), false), 'unlocked a week in a row');
  assert.equal(
    lineText(line({ goal: true, achievements: ['first_10k'] }), false),
    'reached their goal · unlocked first 10k'
  );
  assert.equal(
    lineText(line({ achievements: ['steps_1m', 'streak_100'] }), false),
    'unlocked a million steps and 100 days in a row'
  );
  assert.equal(
    lineText(line({ achievements: ['first_10k', 'big_day', 'huge_day', 'streak_7'] }), false),
    'unlocked first 10k, big day and 2 more'
  );
});

test('your own line says your, with the coins', () => {
  assert.equal(lineText(line({ goal: true, coins: 150 }), true), 'reached your goal · +150 coins');
  assert.equal(lineText(line({ goal: true, coins: 100 }), true), 'reached your goal · +100 coins');
  // A friend's line never has coins, even if some arrived
  assert.equal(lineText(line({ goal: true, coins: 150 }), false), 'reached their goal');
});

test('ids this app doesn’t know are left out, and an empty line is not shown', () => {
  assert.equal(lineText(line({ goal: true, achievements: ['from_the_future'] }), false), 'reached their goal');
  assert.deepEqual(showable([line({ achievements: ['from_the_future'] }), line({ goal: true })]).length, 1);
});

test('the badge: the newest achievement, else the goal', () => {
  assert.equal(lineBadge(line({ goal: true })), 'goal');
  const b = lineBadge(line({ goal: true, achievements: ['first_10k', 'streak_7'] }));
  assert.equal(b !== 'goal' && b.id, 'streak_7');
});

test('day labels from the viewer’s date', () => {
  assert.equal(dayLabel('2026-10-17', '2026-10-17'), 'Today');
  assert.equal(dayLabel('2026-10-18', '2026-10-17'), 'Today'); // a friend ahead of you
  assert.equal(dayLabel('2026-10-16', '2026-10-17'), 'Yesterday');
  assert.equal(dayLabel('2026-10-13', '2026-10-17'), 'Tue, Oct 13');
  assert.equal(dayLabel('2026-02-28', '2026-03-02'), 'Sat, Feb 28'); // across a month
});

test('a screen reader hears one sentence', () => {
  assert.equal(
    lineLabel(line({ day: '2026-10-16', goal: true, achievements: ['first_10k'] }), 'Sam', false, '2026-10-17'),
    'Sam, reached their goal · unlocked first 10k, yesterday'
  );
  assert.equal(lineLabel(line({ goal: true, coins: 150 }), 'Me', true, '2026-10-17'), 'You, reached your goal · +150 coins, today');
});

test('pages: a cursor only after a full page, and no line twice', () => {
  const full = Array.from({ length: PAGE_SIZE }, (_, i) => line({ user_id: `p${i}` }));
  assert.deepEqual(nextCursor(full), { day: '2026-10-17', at: '2026-10-17T15:00:00+00:00', user_id: 'p19' });
  assert.equal(nextCursor(full.slice(1)), null);
  const shown = [line({ user_id: 'a' }), line({ user_id: 'b' })];
  const merged = appendPage(shown, [line({ user_id: 'b' }), line({ user_id: 'c' })]);
  assert.deepEqual(merged.map((l) => l.user_id), ['a', 'b', 'c']);
});

test('dropping a person, and spotting something new', () => {
  const shown = [line({ user_id: 'a' }), line({ user_id: 'b' })];
  assert.deepEqual(withoutPerson(shown, 'a').map((l) => l.user_id), ['b']);
  assert.equal(hasNew(shown, shown), false);
  assert.equal(hasNew(shown, [line({ user_id: 'a', at: '2026-10-17T16:00:00+00:00' })]), true);
  assert.equal(hasNew(shown, [line({ user_id: 'c' })]), true);
});
