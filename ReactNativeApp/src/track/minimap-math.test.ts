// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BAR_INSET,
  barX,
  groupIcons,
  labelsFor,
  milestonesFor,
  nextStop,
  scrollFor,
  stepsAt,
  viewportOnBar,
} from './minimap-math.ts';
import { centerFor, roadWidth } from './scale.ts';

const W = 392; // a bar 392 wide: 360 points of track between the insets

describe('barX and stepsAt', () => {
  test('0 is at the left inset, the road end at the right', () => {
    assert.equal(barX(0, 10_000, W), BAR_INSET);
    assert.equal(barX(10_000, 10_000, W), W - BAR_INSET);
    assert.equal(barX(5_000, 10_000, W), BAR_INSET + 180);
  });
  test('counts past the end or below 0 stay on the bar', () => {
    assert.equal(barX(12_000, 10_000, W), W - BAR_INSET);
    assert.equal(barX(-50, 10_000, W), BAR_INSET);
  });
  test('whole points only', () => {
    assert.ok(Number.isInteger(barX(3_333, 10_000, W)));
  });
  test('stepsAt undoes barX', () => {
    for (const s of [0, 2_500, 5_000, 10_000]) assert.equal(stepsAt(barX(s, 10_000, W), 10_000, W), s);
  });
  test('taps in the insets count as the ends', () => {
    assert.equal(stepsAt(0, 10_000, W), 0);
    assert.equal(stepsAt(W, 10_000, W), 10_000);
  });
});

describe('viewportOnBar', () => {
  test('the screen at the start of a 10k road covers its first part', () => {
    // 390 points of screen from scroll 0: steps -640 to 3,260
    const v = viewportOnBar(0, 390, 10_000, W);
    assert.equal(v.left, BAR_INSET);
    assert.equal(v.left + v.width, barX(3_260, 10_000, W));
  });
  test('scrolled to the end, it reaches the end of the bar', () => {
    const v = viewportOnBar(roadWidth(10_000) - 390, 390, 10_000, W);
    assert.equal(v.left + v.width, W - BAR_INSET);
  });
  test('never thinner than 2 points', () => {
    assert.ok(viewportOnBar(0, 10, 50_000, W).width >= 2);
  });
});

describe('scrollFor', () => {
  test('centers a count on the screen', () => {
    assert.equal(scrollFor(5_000, 10_000, 390), centerFor(5_000) - 195);
  });
  test('stays inside the road at both ends', () => {
    assert.equal(scrollFor(0, 10_000, 390), 0);
    assert.equal(scrollFor(10_000, 10_000, 390), roadWidth(10_000) - 390);
  });
});

describe('labels and milestones', () => {
  test('every 2,500 on a short road', () => {
    assert.deepEqual(labelsFor(10_000), [0, 2_500, 5_000, 7_500, 10_000]);
  });
  test('every 5,000 once the road is 20,000 or longer', () => {
    assert.deepEqual(labelsFor(25_000), [0, 5_000, 10_000, 15_000, 20_000, 25_000]);
  });
  test('a landmark every 5,000', () => {
    assert.deepEqual(milestonesFor(15_000), [0, 5_000, 10_000, 15_000]);
  });
});

describe('groupIcons', () => {
  const p = (id: string, steps: number, isMe = false) => ({ id, steps, isMe });

  test('people far apart get their own icons', () => {
    const g = groupIcons([p('a', 1_000), p('b', 6_000)], 10_000, W, 20);
    assert.equal(g.length, 2);
    assert.deepEqual(
      g.map((x) => x.others),
      [0, 0]
    );
  });
  test('people close together share the leader’s icon with a count', () => {
    const g = groupIcons([p('a', 5_000), p('b', 5_200), p('c', 5_100), p('d', 9_000)], 10_000, W, 20);
    assert.equal(g.length, 2);
    assert.equal(g[0].leader.id, 'b');
    assert.equal(g[0].others, 2);
  });
  test('you are never in a group', () => {
    const g = groupIcons([p('me', 5_000, true), p('a', 5_050)], 10_000, W, 20);
    assert.equal(g.length, 1);
    assert.equal(g[0].leader.id, 'a');
    assert.equal(g[0].others, 0);
  });
  test('a long line of people breaks into several groups', () => {
    // 10 points apart each: closer than the gap to the one before, but
    // not all within the gap of the first
    const line = Array.from({ length: 8 }, (_, i) => p(`p${i}`, 1_000 + i * 280));
    assert.ok(groupIcons(line, 10_000, W, 20).length > 1);
  });
});

describe('nextStop', () => {
  const stops = [0, 5_000, 8_000, 10_000, 6_200];
  test('up goes to the next one along', () => {
    assert.equal(nextStop(stops, 5_000, 1), 6_200);
    assert.equal(nextStop(stops, 10_000, 1), undefined);
  });
  test('down goes back', () => {
    assert.equal(nextStop(stops, 6_200, -1), 5_000);
    assert.equal(nextStop(stops, 0, -1), undefined);
  });
});
