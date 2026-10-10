// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type AccountStatus, parseAccountStatus, routeFor } from './route.ts';

const active: AccountStatus = {
  onboarded: true,
  blocked: false,
  termsOk: true,
  minimumAge: 13,
  termsToAccept: [],
};
const signedIn = (account: AccountStatus | 'loading' | 'failed') =>
  routeFor({ sessionRestored: true, signedIn: true, account });

describe('routeFor (step-tracker-register.txt, section 7)', () => {
  test('reading the saved session', () => {
    assert.equal(routeFor({ sessionRestored: false, signedIn: true, account: active }), 'starting');
  });

  test('1 and 2: signed out, or the email is not confirmed yet', () => {
    assert.equal(
      routeFor({ sessionRestored: true, signedIn: false, account: 'loading' }),
      'signedOut'
    );
  });

  test('profile still loading: splash, never the tabs or step 2', () => {
    assert.equal(signedIn('loading'), 'loading');
  });

  test('profile failed to load: the error screen', () => {
    assert.equal(signedIn('failed'), 'loadFailed');
  });

  test('3 and 4: profile incomplete goes to step 2', () => {
    assert.equal(signedIn({ ...active, onboarded: false }), 'setup');
  });

  test('5: fully onboarded goes to the tabs', () => {
    assert.equal(signedIn(active), 'app');
  });

  test('under the minimum age: blocked, even if onboarded long ago', () => {
    assert.equal(signedIn({ ...active, blocked: true }), 'blocked');
    assert.equal(signedIn({ ...active, onboarded: false, blocked: true }), 'blocked');
  });

  test('updated Terms to accept', () => {
    assert.equal(signedIn({ ...active, termsOk: false }), 'updatedTerms');
  });

  test('a reset link: "Set a new password" before anything else, even step 2', () => {
    const recovering = (account: AccountStatus | 'loading' | 'failed') =>
      routeFor({ sessionRestored: true, signedIn: true, recovering: true, account });
    assert.equal(recovering(active), 'recovery');
    assert.equal(recovering({ ...active, onboarded: false }), 'recovery');
    assert.equal(recovering('loading'), 'recovery');
    assert.equal(
      routeFor({ sessionRestored: true, signedIn: false, recovering: true, account: 'loading' }),
      'signedOut'
    );
  });

  test('step 2 comes before the Terms screen (it has its own checkbox)', () => {
    assert.equal(signedIn({ ...active, onboarded: false, termsOk: false }), 'setup');
  });
});

describe('parseAccountStatus', () => {
  test('reads the server JSON', () => {
    const doc = {
      document: 'terms',
      version: 't1',
      url: 'https://example.test/t1',
    };
    assert.deepEqual(
      parseAccountStatus({
        onboarded: true,
        blocked: false,
        terms_ok: false,
        minimum_age: 16,
        terms_to_accept: [doc],
      }),
      {
        onboarded: true,
        blocked: false,
        termsOk: false,
        minimumAge: 16,
        termsToAccept: [doc],
      }
    );
  });

  test('anything missing counts against getting in', () => {
    assert.deepEqual(parseAccountStatus(null), {
      onboarded: false,
      blocked: false,
      termsOk: false,
      minimumAge: 13,
      termsToAccept: [],
    });
  });
});
