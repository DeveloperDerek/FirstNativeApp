// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  type ActivityLine,
  appendPage,
  dayLabel,
  giverNames,
  hasKudos,
  hasNew,
  kudosLabel,
  lineBadge,
  lineLabel,
  lineKey,
  lineText,
  newKudosText,
  nextCursor,
  PAGE_SIZE,
  showable,
  withKudosGiven,
  withoutKudosGiven,
  withoutPerson,
} from './activity.ts';

const line = (extra: Partial<ActivityLine> = {}): ActivityLine => ({
  day: '2026-10-17',
  at: '2026-10-17T15:00:00+00:00',
  user_id: 'sam',
  kind: 'goal',
  ref: '',
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
  assert.equal(b !== 'goal' && 'id' in b && b.id, 'streak_7');
});

// Stands in for boardItemName, whose catalog needs the item art
const itemName = (id: string) =>
  ({ hat_red_cap: 'Red cap', glasses_shades: 'Shades', pet_slime: 'slime pet' })[id];

test('purchases: the words, never a price, and only items this app knows', () => {
  assert.equal(lineText(line({ items: ['hat_red_cap'] }), false, itemName), 'bought red cap');
  assert.equal(
    lineText(line({ goal: true, achievements: ['first_10k'], items: ['hat_red_cap', 'glasses_shades'] }), false, itemName),
    'reached their goal · unlocked first 10k · bought red cap and shades'
  );
  assert.equal(
    lineText(line({ goal: true, coins: 150, items: ['pet_slime'] }), true, itemName),
    'reached your goal · +150 coins · bought slime pet'
  );
  assert.equal(lineText(line({ goal: true, items: ['from_the_future'] }), false, itemName), 'reached their goal');
  // A server from before purchases sends no items at all
  assert.equal(lineText(line({ goal: true }), false, itemName), 'reached their goal');
  assert.equal(showable([line({ items: ['from_the_future'] }), line({ items: ['hat_red_cap'] })], itemName).length, 1);
  // Without the names (an old caller), a purchase-only line isn't shown
  assert.equal(showable([line({ items: ['hat_red_cap'] })]).length, 0);
});

test('the daily roll on a goal line: the prize, item or coins, in the goal\'s place', () => {
  // A roll's goal line pays 0 coins itself
  assert.equal(
    lineText(line({ goal: true, coins: 0, prize_item: 'hat_red_cap' }), true, itemName),
    'won red cap'
  );
  assert.equal(
    lineText(line({ goal: true, prize_item: 'hat_red_cap' }), false, itemName),
    'won red cap'
  );
  assert.equal(
    lineText(line({ goal: true, coins: 0, prize_coins: 250 }), true, itemName),
    'won 250 coins'
  );
  assert.equal(lineText(line({ goal: true, prize_coins: 250 }), false, itemName), 'won 250 coins');
  // The day's own coins stay yours only
  assert.equal(lineText(line({ goal: true, coins: 150 }), false, itemName), 'reached their goal');
  // Not rolled yet, or an item this app doesn't know
  assert.equal(lineText(line({ goal: true, coins: 0 }), true, itemName), 'reached your goal');
  assert.equal(lineText(line({ goal: true, prize_item: 'from_the_future' }), false, itemName), 'reached their goal');
  // The item won is the line's picture
  assert.deepEqual(lineBadge(line({ goal: true, prize_item: 'hat_red_cap' }), itemName), { item: 'hat_red_cap' });
  assert.equal(lineBadge(line({ goal: true, prize_item: 'from_the_future' }), itemName), 'goal');
});

test('the picture: the newest item bought comes before any badge', () => {
  const l = line({ goal: true, achievements: ['streak_7'], items: ['hat_red_cap', 'glasses_shades'] });
  assert.deepEqual(lineBadge(l, itemName), { item: 'glasses_shades' });
  // An item this app doesn't know falls back to the badge
  const b = lineBadge(line({ achievements: ['streak_7'], items: ['from_the_future'] }), itemName);
  assert.equal(b !== 'goal' && 'id' in b && b.id, 'streak_7');
  assert.equal(lineBadge(line({ goal: true, items: ['hat_red_cap'] })), 'goal');
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
  assert.deepEqual(nextCursor(full), {
    day: '2026-10-17',
    at: '2026-10-17T15:00:00+00:00',
    user_id: 'p19',
    kind: 'goal',
    ref: '',
  });
  assert.equal(nextCursor(full.slice(1)), null);
  const shown = [line({ user_id: 'a' }), line({ user_id: 'b' })];
  const merged = appendPage(shown, [line({ user_id: 'b' }), line({ user_id: 'c' })]);
  assert.deepEqual(merged.map((l) => l.user_id), ['a', 'b', 'c']);
});

test('each thing done is its own line: the goal, each achievement, each purchase', () => {
  const goal = line({ goal: true });
  const badge = line({ kind: 'achievement', ref: 'streak_7', achievements: ['streak_7'] });
  const cap = line({ kind: 'purchase', ref: 'hat_red_cap', items: ['hat_red_cap'] });
  const shades = line({ kind: 'purchase', ref: 'glasses_shades', items: ['glasses_shades'] });
  assert.equal(new Set([goal, badge, cap, shades].map(lineKey)).size, 4);
  assert.equal(appendPage([goal, cap], [cap, shades]).length, 3);
  // Kudos go on the one line tapped, not the person's whole day
  const given = withKudosGiven([goal, cap], lineKey(cap));
  assert.deepEqual(given.map((l) => l.my_kudos ?? false), [false, true]);
  assert.equal(lineText(cap, false, itemName), 'bought red cap');
  assert.equal(lineText(badge, false), 'unlocked a week in a row');
});

test('dropping a person, and spotting something new', () => {
  const shown = [line({ user_id: 'a' }), line({ user_id: 'b' })];
  assert.deepEqual(withoutPerson(shown, 'a').map((l) => l.user_id), ['b']);
  assert.equal(hasNew(shown, shown), false);
  assert.equal(hasNew(shown, [line({ user_id: 'a', at: '2026-10-17T16:00:00+00:00' })]), true);
  assert.equal(hasNew(shown, [line({ user_id: 'c' })]), true);
});

test('kudos: a server without them shows no button', () => {
  assert.equal(hasKudos(line()), false);
  assert.equal(hasKudos(line({ kudos: 0, my_kudos: false })), true);
});

test('giving kudos counts up at once, once, and goes back on an error', () => {
  const sam = line({ kudos: 3, my_kudos: false });
  const other = line({ user_id: 'ana', kudos: 1 });
  const given = withKudosGiven([sam, other], lineKey(sam));
  assert.deepEqual([given[0].kudos, given[0].my_kudos, given[1].kudos], [4, true, 1]);
  assert.equal(withKudosGiven(given, lineKey(sam))[0].kudos, 4, 'a second tap adds nothing');
  assert.equal(withKudosGiven([sam], lineKey(sam), 7)[0].kudos, 7, "the server's count wins");
  const back = withoutKudosGiven(given, lineKey(sam));
  assert.deepEqual([back[0].kudos, back[0].my_kudos], [3, false]);
  assert.equal(withoutKudosGiven([sam], lineKey(sam))[0].kudos, 3, 'not given: nothing to take back');
});

test('kudos in the words a screen reader says', () => {
  assert.equal(kudosLabel(line({ kudos: 4 }), 'Sam', false), 'Give Sam kudos, 4 so far');
  assert.equal(kudosLabel(line({ kudos: 4, my_kudos: true }), 'Sam', false), 'You gave Sam kudos, 4 in all');
  assert.equal(kudosLabel(line({ kudos: 4, new_kudos: 1 }), 'Me', true), '4 kudos, 1 new, opens who gave them');
  assert.equal(
    lineLabel(line({ day: '2026-10-16', goal: true, kudos: 4 }), 'Sam', false, '2026-10-17'),
    'Sam, reached their goal, yesterday, 4 kudos'
  );
});

test('who gave kudos, and what a new kudos line says', () => {
  assert.equal(giverNames(['Ana']), 'Ana');
  assert.equal(giverNames(['Ana', 'Sam']), 'Ana and Sam');
  assert.equal(giverNames(['Ana', 'Sam', 'Lee', 'Kim']), 'Ana, Sam and 2 more');
  const day = { day: '2026-10-16', kind: 'goal' as const, ref: '', givers: [] };
  assert.equal(newKudosText({ ...day, goal: true, achievements: [] }), 'reached your goal');
  assert.equal(newKudosText({ ...day, goal: false, achievements: ['streak_7'] }), 'unlocked a week in a row');
  assert.equal(newKudosText({ ...day, goal: false, achievements: ['from_a_newer_app'] }), 'your day');
  assert.equal(
    newKudosText({ ...day, goal: false, achievements: [], items: ['hat_red_cap'] }, itemName),
    'bought red cap'
  );
});
