// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { currentAccount, isCurrent, setSignedInAccount, signedInAccount } from './account-guard.ts';

test('the same account again changes nothing (a refreshed token)', () => {
  setSignedInAccount('a1');
  const mark = currentAccount();
  setSignedInAccount('a1');
  assert.equal(isCurrent(mark), true);
  assert.equal(mark.signal.aborted, false);
});

test('signing out stops work at once and cancels its requests', () => {
  setSignedInAccount('a1');
  const mark = currentAccount();
  setSignedInAccount(undefined);
  assert.equal(isCurrent(mark), false);
  assert.equal(mark.signal.aborted, true);
  assert.equal(signedInAccount(), undefined);
});

test('work started for the next account is current', () => {
  setSignedInAccount('a1');
  setSignedInAccount(undefined);
  setSignedInAccount('b2');
  const mark = currentAccount();
  assert.equal(isCurrent(mark), true);
  assert.equal(mark.signal.aborted, false);
  assert.equal(signedInAccount(), 'b2');
});
