// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { phaseAt, sunTimes } from './time-of-day.ts';

// Local time, like the phone's clock
const at = (month: number, day: number, hour: number, minute = 0) =>
  new Date(2026, month - 1, day, hour, minute);

describe('phaseAt', () => {
  test('midday is day and the small hours are night', () => {
    assert.equal(phaseAt(at(10, 15, 12)), 'day');
    assert.equal(phaseAt(at(10, 15, 2)), 'night');
    assert.equal(phaseAt(at(6, 21, 0, 30)), 'night');
  });

  test('the hour before sunset and half an hour after it are sunset', () => {
    // Mid-October sunset is about 18:33
    assert.equal(phaseAt(at(10, 15, 17, 25)), 'day');
    assert.equal(phaseAt(at(10, 15, 17, 40)), 'sunset');
    assert.equal(phaseAt(at(10, 15, 18, 55)), 'sunset');
    assert.equal(phaseAt(at(10, 15, 19, 10)), 'night');
  });

  test('sunrise gets the same golden light', () => {
    // Mid-October sunrise is about 07:18
    assert.equal(phaseAt(at(10, 15, 6, 30)), 'night');
    assert.equal(phaseAt(at(10, 15, 7, 0)), 'sunset');
    assert.equal(phaseAt(at(10, 15, 8, 0)), 'sunset');
    assert.equal(phaseAt(at(10, 15, 8, 30)), 'day');
  });

  test('follows the seasons', () => {
    // 8 pm: still light in June, long dark in December
    assert.equal(phaseAt(at(6, 15, 20)), 'sunset');
    assert.equal(phaseAt(at(12, 15, 20)), 'night');
    // 5 pm: day in June, sunset in December
    assert.equal(phaseAt(at(6, 15, 17)), 'day');
    assert.equal(phaseAt(at(12, 15, 17)), 'sunset');
  });
});

describe('sunTimes', () => {
  test('is the table value on the 15th', () => {
    assert.deepEqual(sunTimes(at(6, 15, 12)), [5.8, 20.5]);
  });

  test('moves smoothly across a month boundary', () => {
    const [, endOfMay] = sunTimes(at(5, 31, 12));
    const [, startOfJune] = sunTimes(at(6, 1, 12));
    assert.ok(Math.abs(endOfMay - startOfJune) < 0.05, `${endOfMay} vs ${startOfJune}`);
  });
});
