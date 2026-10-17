// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ACHIEVEMENTS,
  achievementCount,
  achievementList,
  earnedList,
  findAchievement,
  formatEarnedOn,
  type NewAchievement,
  progressText,
  ShowingNow,
  unlockedBy,
  unlockMessage,
} from './achievements.ts';

const root = join(import.meta.dirname, '..', '..');
const a = (id: string) => findAchievement(id)!;
const fresh = (id: string, extra: Partial<NewAchievement> = {}): NewAchievement => ({
  id,
  earned_on: '2026-10-01',
  at_launch: false,
  item: null,
  ...extra,
});

test('progress text for each kind', () => {
  assert.equal(progressText(a('big_day'), 12_345), 'Best day 12,345 of 20,000 steps');
  assert.equal(progressText(a('steps_1m'), 640_000), '640,000 of 1,000,000 steps');
  assert.equal(progressText(a('streak_30'), 12), 'Best streak 12 of 30');
  assert.equal(progressText(a('quest_10'), 3), '3 of 10 quests');
  assert.equal(progressText(a('quest_1'), 0), '0 of 1 quest');
});

test('the list: earned newest first, then locked closest first', () => {
  const list = achievementList({
    sharing: true,
    earned: [
      { id: 'first_10k', earned_on: '2026-03-02' },
      { id: 'steps_100k', earned_on: '2026-05-10' },
      { id: 'streak_7', earned_on: '2026-05-10' },
    ],
    progress: [
      { id: 'big_day', value: 15_000, threshold: 20_000 }, // 75%
      { id: 'huge_day', value: 15_000, threshold: 30_000 }, // 50%
      { id: 'steps_1m', value: 640_000, threshold: 1_000_000 }, // 64%
      { id: 'steps_5m', value: 640_000, threshold: 5_000_000 },
      { id: 'streak_30', value: 12, threshold: 30 }, // 40%
      { id: 'streak_100', value: 12, threshold: 100 },
      { id: 'quest_1', value: 0, threshold: 1 },
      { id: 'quest_10', value: 0, threshold: 10 },
    ],
  });
  assert.deepEqual(
    list.map((e) => e.achievement.id),
    [
      // Same day: the later one in the server's order first
      'streak_7',
      'steps_100k',
      'first_10k',
      'big_day',
      'steps_1m',
      'huge_day',
      'streak_30',
      'steps_5m',
      'streak_100',
      'quest_1',
      'quest_10',
    ]
  );
  assert.equal(list[0].earnedOn, '2026-05-10');
  assert.equal(list[0].progress, null);
  assert.equal(list[4].progress, '640,000 of 1,000,000 steps');
});

test('the list when not sharing: all locked, no progress, in order', () => {
  const list = achievementList({ sharing: false, earned: [], progress: [] });
  assert.deepEqual(
    list.map((e) => e.achievement.id),
    ACHIEVEMENTS.map((x) => x.id)
  );
  assert.ok(list.every((e) => e.earnedOn === null && e.progress === null));
});

test('ids this app does not know are left out', () => {
  const list = achievementList({
    sharing: true,
    earned: [{ id: 'from_the_future', earned_on: '2026-01-01' }],
    progress: [],
  });
  assert.equal(list.length, ACHIEVEMENTS.length);
  assert.equal(unlockMessage([fresh('from_the_future')]), null);
});

test("someone else's earned list: earned only, newest first, no progress", () => {
  const list = earnedList([
    { id: 'steps_100k', earned_on: '2026-05-10' },
    { id: 'from_the_future', earned_on: '2026-09-01' },
    { id: 'first_10k', earned_on: '2026-03-02' },
    { id: 'streak_7', earned_on: '2026-05-10' },
  ]);
  assert.deepEqual(
    list.map((e) => [e.achievement.id, e.earnedOn, e.progress]),
    [
      ['streak_7', '2026-05-10', null],
      ['steps_100k', '2026-05-10', null],
      ['first_10k', '2026-03-02', null],
    ]
  );
  assert.deepEqual(earnedList([]), []);
  assert.equal(achievementCount(list.length), '3 achievements');
  assert.equal(achievementCount(1), '1 achievement');
});

test('earned dates are the day itself, in any time zone', () => {
  assert.equal(formatEarnedOn('2026-10-12'), 'Oct 12, 2026');
  assert.equal(formatEarnedOn('2026-01-01'), 'Jan 1, 2026');
});

test('the message: one', () => {
  assert.deepEqual(unlockMessage([fresh('first_10k')]), {
    title: 'Achievement unlocked',
    body: 'First 10K.',
  });
});

test('the message: one with a reward item', () => {
  assert.deepEqual(unlockMessage([fresh('steps_1m', { item: 'shoes_winged' })]), {
    title: 'Achievement unlocked',
    body: 'A million steps. You can now wear the Winged sneakers.',
  });
  assert.deepEqual(unlockMessage([fresh('quest_1', { item: 'pet_mimic' })]), {
    title: 'Achievement unlocked',
    body: 'First quest won. The Mimic can now walk beside you.',
  });
});

test('the message: several', () => {
  assert.deepEqual(
    unlockMessage([fresh('first_10k'), fresh('big_day'), fresh('streak_30'), fresh('streak_100')]),
    {
      title: 'Achievements unlocked',
      body:
        'First 10K, Big day, A month in a row and 100 days in a row. ' +
        'You can now wear the Ember cape and the Laurel wreath.',
    }
  );
});

test('the message: the first-time summary', () => {
  assert.deepEqual(
    unlockMessage([
      fresh('first_10k', { at_launch: true }),
      fresh('steps_100k', { at_launch: true }),
      fresh('steps_1m', { at_launch: true }),
      fresh('streak_7', { at_launch: true }),
      fresh('quest_1', { at_launch: true }),
      fresh('big_day'), // earned since: still in the one summary
    ]),
    {
      title: 'Achievements unlocked',
      body:
        "You've earned 6 achievements. You can now wear the Winged sneakers. " +
        'The Mimic can now walk beside you. See them all in Profile.',
    }
  );
  assert.deepEqual(unlockMessage([fresh('first_10k', { at_launch: true })]), {
    title: 'Achievement unlocked',
    body: "You've earned First 10K. See them all in Profile.",
  });
});

test('ids on screen are not shown again until the message closes', () => {
  const showing = new ShowingNow();
  assert.deepEqual(
    showing.take([fresh('first_10k'), fresh('big_day')]).map((n) => n.id),
    ['first_10k', 'big_day']
  );
  // A second fetch while it's up (not acknowledged yet)
  assert.deepEqual(
    showing.take([fresh('first_10k'), fresh('big_day'), fresh('streak_7')]).map((n) => n.id),
    ['streak_7']
  );
  assert.deepEqual(showing.take([fresh('first_10k')]), []);
  // Closed without being acknowledged (say the save failed): next time it comes again
  showing.release(['first_10k', 'big_day']);
  assert.deepEqual(
    showing.take([fresh('first_10k')]).map((n) => n.id),
    ['first_10k']
  );
});

test('each reward item comes from the right achievement', () => {
  assert.equal(unlockedBy('shoes_winged')?.name, 'A million steps');
  assert.equal(unlockedBy('cape_ember')?.name, 'A month in a row');
  assert.equal(unlockedBy('hat_laurel')?.name, '100 days in a row');
  assert.equal(unlockedBy('pet_mimic')?.name, 'First quest won');
  assert.equal(unlockedBy('shoes_gold'), undefined);
});

// The server and the app each keep a list; these keep them the same.
const migration = () => {
  const dir = join(root, 'supabase', 'migrations');
  const file = readdirSync(dir).find((f) => f.endsWith('_achievements.sql'))!;
  return readFileSync(join(dir, file), 'utf8');
};

test('the same achievements, kinds and thresholds as the database', () => {
  const rows = [...migration().matchAll(/\('(\w+)',\s*'(\w+)',\s*(\d+),\s*(\d+)\)/g)].map((m) => ({
    id: m[1],
    kind: m[2],
    threshold: Number(m[3]),
    order: Number(m[4]),
  }));
  assert.deepEqual(
    rows.sort((x, y) => x.order - y.order).map(({ id, kind, threshold }) => ({ id, kind, threshold })),
    ACHIEVEMENTS.map(({ id, kind, threshold }) => ({ id, kind, threshold }))
  );
});

test('the same reward items as the database, each in the catalog with its sprites', () => {
  const rows = [...migration().matchAll(/\('(\w+)',\s*null,\s*false,\s*'(\w+)'\)/g)].map(
    (m) => `${m[1]}:${m[2]}`
  );
  const rewards = ACHIEVEMENTS.flatMap((x) => (x.reward ? [`${x.reward.item}:${x.id}`] : []));
  assert.deepEqual(rows.sort(), rewards.sort());

  const catalog = readFileSync(join(root, 'src', 'avatar', 'catalog.ts'), 'utf8');
  const pets = readFileSync(join(root, 'src', 'avatar', 'pets.ts'), 'utf8');
  for (const x of ACHIEVEMENTS) {
    if (!x.reward) continue;
    const source = x.reward.pet ? pets : catalog;
    const entry = source.match(new RegExp(`id: '${x.reward.item}',[^}]*`))?.[0];
    assert.ok(entry, `${x.reward.item} is in ${x.reward.pet ? 'pets.ts' : 'catalog.ts'}`);
    assert.match(entry, new RegExp(`label: '${x.reward.label}'`));
    for (const [, path] of entry.matchAll(/require\('@\/(assets\/[^']+)'\)/g)) {
      assert.ok(existsSync(join(root, path)), `${path} exists`);
    }
  }
});
