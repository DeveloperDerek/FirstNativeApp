// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { singleFlight } from './single-flight.ts';

/** A job that finishes when the test says so. */
function gate<T>() {
  let open!: (value: T) => void;
  let fail!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    open = res;
    fail = rej;
  });
  return { promise, open, fail };
}

test('two calls at once run the job once and both get the answer', async () => {
  const run = singleFlight<number>();
  const g = gate<number>();
  let calls = 0;
  const job = () => {
    calls++;
    return g.promise;
  };
  const a = run('k', job);
  const b = run('k', job);
  g.open(42);
  assert.deepEqual(await Promise.all([a, b]), [42, 42]);
  assert.equal(calls, 1);
});

test('a call with a different key runs once more after the running job', async () => {
  const run = singleFlight<string>();
  const first = gate<string>();
  const order: string[] = [];
  const a = run('off', () => {
    order.push('off');
    return first.promise;
  });
  const job = (key: string) => async () => {
    order.push(key);
    return key;
  };
  const b = run('on', job('on'));
  const c = run('on', job('on'));
  assert.deepEqual(order, []); // nothing extra starts while the first runs
  first.open('off');
  assert.equal(await a, 'off');
  assert.deepEqual(await Promise.all([b, c]), ['on', 'on']);
  assert.deepEqual(order, ['off', 'on']);
});

test('calls made while an extra run waits join it with the latest job', async () => {
  const run = singleFlight<string>();
  const first = gate<string>();
  const a = run('a', () => first.promise);
  const b = run('b', async () => 'b');
  const c = run('c', async () => 'c');
  first.open('a');
  assert.equal(await a, 'a');
  assert.equal(await b, 'c');
  assert.equal(await c, 'c');
});

test('a failed run is cleared, so the next call starts fresh', async () => {
  const run = singleFlight<string>();
  const failing = gate<string>();
  const a = run('k', () => failing.promise);
  failing.fail(new Error('offline'));
  await assert.rejects(a, /offline/);
  assert.equal(await run('k', async () => 'again'), 'again');
});

test('the extra run still happens when the running job fails', async () => {
  const run = singleFlight<string>();
  const failing = gate<string>();
  const a = run('off', () => failing.promise);
  const b = run('on', async () => 'on');
  failing.fail(new Error('offline'));
  await assert.rejects(a, /offline/);
  assert.equal(await b, 'on');
});
