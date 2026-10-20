// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildReel,
  COIN_FRAMES,
  COIN_GROUPS,
  coinFrame,
  framePixels,
  isBigWin,
  machineBody,
  placePrize,
  REEL_LENGTH,
  prizeName,
  randomTile,
  ROLL_CHANCES,
  rarityOf,
  REEL_START,
  reelPosition,
  rollErrorText,
  sameTile,
  spinPlan,
  spinTotalMs,
  type PoolItem,
  type Tile,
} from './roll.ts';

/** A repeatable stand-in for Math.random. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const POOL: PoolItem[] = [
  { id: 'hat_cap_red', rarity: 'uncommon' },
  { id: 'glasses_round', rarity: 'common' },
  { id: 'hat_pirate', rarity: 'rare' },
  { id: 'hat_crown_gold', rarity: 'epic' },
  { id: 'outfit_knight', rarity: 'legendary' },
];

test('rarity follows the price ladder, like roll_rarity()', () => {
  assert.deepEqual(
    [300, 400, 500, 700, 800, 1200, 1500, 2000, 2500, 3000].map(rarityOf),
    ['common', 'common', 'uncommon', 'uncommon', 'rare', 'rare', 'epic', 'epic', 'legendary', 'legendary']
  );
});

test('the prize name: the item, or the coins', () => {
  const name = (id: string) => (id === 'hat_pirate' ? 'Pirate hat' : undefined);
  assert.equal(prizeName({ item_id: 'hat_pirate', rarity: 'rare', coins: 0 }, name), 'Pirate hat');
  assert.equal(prizeName({ item_id: null, rarity: 'coins', coins: 250 }, name), '+250 coins');
  assert.equal(prizeName({ item_id: 'hat_new', rarity: 'rare', coins: 0 }, name), 'a new item');
});

test('big wins: Epic, Legendary and 500 coins', () => {
  assert.equal(isBigWin({ item_id: 'x', rarity: 'epic', coins: 0 }), true);
  assert.equal(isBigWin({ item_id: 'x', rarity: 'legendary', coins: 0 }), true);
  assert.equal(isBigWin({ item_id: null, rarity: 'coins', coins: 500 }), true);
  assert.equal(isBigWin({ item_id: null, rarity: 'coins', coins: 250 }), false);
  assert.equal(isBigWin({ item_id: 'x', rarity: 'rare', coins: 0 }), false);
});

test("the server's refusals in words", () => {
  assert.equal(rollErrorText('BAD_DAY'), 'This roll ended at midnight.');
  assert.match(rollErrorText('GOAL_NOT_REACHED'), /goal/);
  assert.match(rollErrorText('fetch failed'), /connection/);
});

test('reel tiles only show what could be won', () => {
  const random = seeded(1);
  for (let i = 0; i < 500; i++) {
    const t = randomTile(POOL, random);
    if (t.kind === 'coins') assert.ok([100, 250, 500].includes(t.coins));
    else assert.ok(POOL.some((p) => p.id === t.id && p.rarity === t.rarity));
  }
  // Nothing left to win: only coins
  const random2 = seeded(2);
  for (let i = 0; i < 50; i++) assert.equal(randomTile([], random2).kind, 'coins');
});

const shares = (tiles: Tile[]) => (k: string) =>
  (100 * tiles.filter((t) => (t.kind === 'coins' ? 'coins' : t.rarity) === k).length) / tiles.length;

test('reel tiles: fewer coins, the items at their real chances among themselves (ROLL-17)', () => {
  const random = seeded(3);
  const share = shares(Array.from({ length: 20000 }, () => randomTile(POOL, random)));
  assert.ok(Math.abs(share('coins') - 100 / 7) < 1.5);
  assert.ok(Math.abs(share('common') / share('legendary') - 31) < 8);
  assert.ok(Math.abs(share('uncommon') / share('rare') - 19 / 6) < 0.5);
});

test('the real chances match the server: coins 40%', () => {
  const random = seeded(4);
  const share = shares(Array.from({ length: 20000 }, () => randomTile(POOL, random, ROLL_CHANCES)));
  assert.ok(Math.abs(share('coins') - 40) < 1.5);
  assert.ok(Math.abs(share('common') - 31) < 1.5);
  assert.ok(Math.abs(share('legendary') - 1) < 0.5);
});

test('the prize is at the stop, and its neighbours are never the same prize', () => {
  const prize: Tile = { kind: 'coins', coins: 100 };
  for (let seed = 0; seed < 50; seed++) {
    const random = seeded(seed);
    const before = buildReel(POOL, random);
    assert.equal(before.length, REEL_LENGTH);
    const reel = placePrize(before, 26, prize, POOL, random);
    assert.deepEqual(reel[26], prize);
    assert.ok(!sameTile(reel[25], prize) && !sameTile(reel[27], prize));
    // Only the stop and its neighbours change
    assert.deepEqual(reel.slice(0, 25), before.slice(0, 25));
    assert.deepEqual(reel.slice(28), before.slice(28));
  }
  // Even the longest spin stops with tiles to spare below it
  assert.ok(REEL_LENGTH >= REEL_START + spinPlan('legendary').tiles + 2);
});

test('the spin: rarer is longer, and it ends on the prize', () => {
  const common = spinPlan('common');
  const legendary = spinPlan('legendary');
  assert.equal(spinTotalMs(common), 160 + 5000 + 260);
  assert.equal(legendary.spinMs, 6200);
  assert.ok(legendary.tiles > common.tiles);

  assert.equal(reelPosition(0, common), REEL_START);
  assert.ok(reelPosition(80, common) < REEL_START, 'the wind-up nudges back');
  // Past the prize at the end of the spin, then back onto it
  const stop = REEL_START + common.tiles;
  assert.ok(Math.abs(reelPosition(common.windMs + common.spinMs - 1, common) - (stop + common.overshoot)) < 0.01);
  assert.equal(reelPosition(spinTotalMs(common), common), stop);
  assert.equal(reelPosition(spinTotalMs(common) + 500, common), stop);
  // Always moving forward between the wind-up and the overshoot
  let last = -Infinity;
  for (let t = common.windMs; t < common.windMs + common.spinMs; t += 20) {
    const p = reelPosition(t, common);
    assert.ok(p >= last);
    last = p;
  }
});

test('the coin: twelve by twelve, five frames, the shine every third turn', () => {
  for (const f of COIN_FRAMES) {
    assert.equal(f.length, 12);
    for (const row of f) assert.equal(row.length, 12);
  }
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((s) => coinFrame(s * 120, 0)), [4, 1, 2, 3, 0, 1, 2, 3]);
  assert.equal(coinFrame(12 * 120, 0), 4);
  // Runs of one colour join up, and nothing is drawn outside the coin
  const px = framePixels(COIN_FRAMES[0]);
  assert.ok(px.every(([x, y, w]) => x >= 0 && x + w <= 12 && y >= 0 && y < 12));
  assert.equal(px.reduce((n, [, , w]) => n + w, 0), COIN_FRAMES[0].join('').replace(/\./g, '').length);
});

test('every coin tile fits its group, and 500 is the widest', () => {
  for (const g of Object.values(COIN_GROUPS)) {
    for (const [x, y] of g.at) assert.ok(x + 12 <= g.w && y + 12 <= g.h);
  }
  assert.equal(Math.max(...Object.values(COIN_GROUPS).map((g) => g.w)), COIN_GROUPS[500].w);
});

test('the machine is drawn inside its 120 x 152 pixels', () => {
  for (const [x, y, w, h] of machineBody()) {
    assert.ok(x >= 0 && y >= 0 && x + w <= 120 && y + h <= 152);
  }
});
