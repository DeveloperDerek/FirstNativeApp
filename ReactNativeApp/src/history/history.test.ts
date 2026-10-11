// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addDays,
  daysFrom,
  type HistoryDay,
  mergeDays,
  monthAverage,
  monthRows,
  periodRange,
  phoneMonthsRange,
  summarize,
  summarizeMonths,
  yearMonths,
} from './history.ts';

const day = (d: string, steps: number | null, goal = 10_000): HistoryDay => ({ day: d, goal, steps });

test('day arithmetic crosses months, years and leap days', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  // The day the clocks change in many places makes no difference
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(daysFrom('2026-02-27', '2026-03-02').length, 4);
});

test('Week: the last 7 days, going back 7 at a time', () => {
  assert.deepEqual(periodRange('week', 0, '2026-10-11'), { from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(periodRange('week', 1, '2026-10-11'), { from: '2026-09-28', to: '2026-10-04' });
});

test('Month: calendar months, the current one up to today', () => {
  assert.deepEqual(periodRange('month', 0, '2026-10-11'), { from: '2026-10-01', to: '2026-10-11' });
  assert.deepEqual(periodRange('month', 1, '2026-10-11'), { from: '2026-09-01', to: '2026-09-30' });
  // Back across a year, and a leap year's February
  assert.deepEqual(periodRange('month', 10, '2026-10-11'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(periodRange('month', 1, '2028-03-15'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(periodRange('month', 13, '2027-03-15'), { from: '2026-02-01', to: '2026-02-28' });
});

test('Year: calendar years, the current one up to today', () => {
  assert.deepEqual(periodRange('year', 0, '2026-10-11'), { from: '2026-01-01', to: '2026-10-11' });
  assert.deepEqual(periodRange('year', 1, '2026-10-11'), { from: '2025-01-01', to: '2025-12-31' });
});

test('stats: a known 0 counts, a missing day doesn\'t', () => {
  assert.equal(summarize([day('2026-10-01', 10_000), day('2026-10-02', 0)]).average, 5_000);
  assert.equal(summarize([day('2026-10-01', 10_000), day('2026-10-02', null)]).average, 10_000);

  const s = summarize([
    day('2026-10-01', 12_000),
    day('2026-10-02', 0),
    day('2026-10-03', null),
    day('2026-10-04', 7_000, 6_000), // at its own goal
    day('2026-10-05', 12_000), // ties the best: the earlier wins
  ]);
  assert.deepEqual(s, {
    total: 31_000,
    daysWithData: 4,
    dayCount: 5,
    average: 7_750,
    best: { day: '2026-10-01', steps: 12_000 },
    daysAtGoal: 3,
  });
});

test('stats with no data, or only zeros', () => {
  assert.deepEqual(summarize([day('2026-10-01', null)]), {
    total: 0,
    daysWithData: 0,
    dayCount: 1,
    average: null,
    best: null,
    daysAtGoal: 0,
  });
  const zeros = summarize([day('2026-10-01', 0), day('2026-10-02', 0)]);
  assert.equal(zeros.average, 0);
  assert.equal(zeros.best, null);
});

test('merging: the last 7 days from the phone, older ones from the server', () => {
  const today = '2026-10-11';
  const server = daysFrom('2026-10-01', today).map((d) => day(d, d === '2026-10-04' ? null : 5_000));
  const phone = { '2026-10-11': 9_000, '2026-10-05': 0, '2026-10-04': 3_000 };
  const merged = mergeDays(server, phone, today);
  const steps = Object.fromEntries(merged.map((d) => [d.day, d.steps]));

  assert.equal(steps['2026-10-11'], 9_000, 'walked more since the upload: today matches Today');
  assert.equal(steps['2026-10-05'], 0, 'the oldest phone day, a real 0 on the phone');
  assert.equal(steps['2026-10-04'], null, 'a server day stays as the server has it, even if the phone has it');
  assert.equal(steps['2026-10-06'], 5_000, 'a phone day the copy lacks keeps the server value');
  assert.equal(merged.length, server.length, 'each day once');
});

test('merging keeps each day\'s own goal from the server', () => {
  const server = [day('2026-10-10', 5_000, 10_000), day('2026-10-11', 5_000, 6_000)];
  const merged = mergeDays(server, { '2026-10-10': 7_000, '2026-10-11': 7_000 }, '2026-10-11');
  assert.equal(summarize(merged).daysAtGoal, 1, 'a goal change in the last 7 days: each day by its own');
});

test('just after midnight, yesterday is one of the phone\'s earlier days', () => {
  const server = [day('2026-10-11', 4_000), day('2026-10-12', null)];
  const merged = mergeDays(server, { '2026-10-11': 11_000, '2026-10-12': 0 }, '2026-10-12');
  assert.deepEqual(
    merged.map((d) => d.steps),
    [11_000, 0]
  );
});

test('month rows: only months with data, same rules as the days', () => {
  const rows = monthRows([
    day('2025-01-31', 0),
    day('2025-02-10', null),
    day('2025-03-01', 12_000),
    day('2025-03-02', 0),
    day('2025-03-03', null),
  ]);
  assert.deepEqual(
    rows.map((r) => r.month),
    ['2025-01-01', '2025-03-01']
  );
  assert.equal(monthAverage(rows[1]), 6_000);
});

test('the Year bar equals the Month view\'s average, with zeros and missing days', () => {
  const march = daysFrom('2025-03-01', '2025-03-31').map((d, i) =>
    day(d, i < 10 ? 12_000 : i === 10 ? 0 : i === 14 ? 6_000 : null, i >= 14 ? 5_000 : 10_000)
  );
  const [row] = monthRows(march);
  const month = summarize(march);
  assert.equal(monthAverage(row), month.average);
  assert.equal(row.daysAtGoal, month.daysAtGoal);
});

test('a sharer\'s Year: months the phone overlaps come from the day rows', () => {
  const today = '2026-10-03'; // the 7 days reach back into September
  const range = periodRange('year', 0, today);
  const phoneMonths = phoneMonthsRange(range, today);
  assert.deepEqual(phoneMonths, { from: '2026-09-01', to: '2026-10-03' });

  const server = [
    { month: '2026-08-01', daysWithData: 31, totalSteps: 310_000, daysAtGoal: 31, bestDay: '2026-08-01', bestSteps: 10_000 },
    // The server's September and October are older than the phone's
    { month: '2026-09-01', daysWithData: 30, totalSteps: 1, daysAtGoal: 0, bestDay: '2026-09-01', bestSteps: 1 },
    { month: '2026-10-01', daysWithData: 3, totalSteps: 1, daysAtGoal: 0, bestDay: '2026-10-01', bestSteps: 1 },
  ];
  const serverDays = daysFrom(phoneMonths!.from, phoneMonths!.to).map((d) => day(d, 8_000));
  const phone = Object.fromEntries(daysFrom('2026-09-27', today).map((d) => [d, 12_000]));
  const merged = mergeDays(serverDays, phone, today);
  const months = yearMonths(server, phoneMonths, merged);

  assert.deepEqual(
    months.map((m) => m.month),
    ['2026-08-01', '2026-09-01', '2026-10-01']
  );
  // Both overlapping months match their Month views
  for (const offset of [0, 1]) {
    const r = periodRange('month', offset, today);
    const monthDays = merged.filter((d) => d.day >= r.from && d.day <= r.to);
    const row = months.find((m) => m.month === r.from)!;
    assert.equal(monthAverage(row), summarize(monthDays).average, r.from);
    assert.equal(row.daysAtGoal, summarize(monthDays).daysAtGoal, r.from);
  }
  // And the whole year adds up
  const year = summarizeMonths(months, daysFrom(range.from, range.to).length);
  assert.equal(year.total, 310_000 + 26 * 8_000 + 4 * 12_000 + 3 * 12_000);
  assert.equal(year.best?.steps, 12_000);
});

test('Year: no phone months for a year the last 7 days don\'t reach', () => {
  assert.equal(phoneMonthsRange(periodRange('year', 1, '2026-10-11'), '2026-10-11'), null);
  // Early January: last December is still on the phone
  assert.deepEqual(phoneMonthsRange(periodRange('year', 1, '2027-01-03'), '2027-01-03'), {
    from: '2026-12-01',
    to: '2026-12-31',
  });
});
