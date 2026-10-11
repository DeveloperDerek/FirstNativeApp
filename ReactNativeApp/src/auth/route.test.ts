// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type AccountStatus, parseAccountStatus, redirectFor, routeFor } from './route.ts';

const active: AccountStatus = {
  onboarded: true,
  blocked: false,
  paused: false,
  pickUsername: false,
  reportsEnabled: false,
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

  test('paused by an admin: the paused screen, but the age block wins', () => {
    assert.equal(signedIn({ ...active, paused: true }), 'paused');
    assert.equal(signedIn({ ...active, paused: true, blocked: true }), 'blocked');
    assert.equal(signedIn({ ...active, paused: true, termsOk: false }), 'paused');
  });

  test('a reset username: pick a new one before the app, after the Terms', () => {
    assert.equal(signedIn({ ...active, pickUsername: true }), 'pickUsername');
    assert.equal(signedIn({ ...active, pickUsername: true, termsOk: false }), 'updatedTerms');
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
        paused: true,
        pick_username: true,
        reports_enabled: true,
        terms_ok: false,
        minimum_age: 16,
        terms_to_accept: [doc],
      }),
      {
        onboarded: true,
        blocked: false,
        paused: true,
        pickUsername: true,
        reportsEnabled: true,
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
      paused: false,
      pickUsername: false,
      reportsEnabled: false,
      termsOk: false,
      minimumAge: 13,
      termsToAccept: [],
    });
  });
});

describe('redirectFor: each state on its own screen', () => {
  test('paused and a username reset each have their screen', () => {
    assert.equal(redirectFor('paused', '/', false), '/paused');
    assert.equal(redirectFor('pickUsername', '/profile', false), '/new-username');
    assert.equal(redirectFor('app', '/paused', false), '/');
    assert.equal(redirectFor('app', '/new-username', false), '/');
  });

  test('under 13 lands on the blocked screen, wherever the router fell back to', () => {
    assert.equal(redirectFor('blocked', '/auth/reset', false), '/age-blocked');
    assert.equal(redirectFor('blocked', '/', false), '/age-blocked');
    assert.equal(redirectFor('blocked', '/age-blocked', false), null);
  });

  test('a link page without a link is never a place to stay', () => {
    for (const route of ['signedOut', 'setup', 'updatedTerms', 'app'] as const) {
      assert.notEqual(redirectFor(route, '/auth/confirm', false), null, route);
    }
  });

  test('a link page with a link stays, to check it (or ask to sign out first)', () => {
    assert.equal(redirectFor('signedOut', '/auth/confirm', true), null);
    assert.equal(redirectFor('app', '/auth/confirm', true), null);
    assert.equal(redirectFor('setup', '/auth/reset', true), null);
  });

  test('a reset comes before everything, links included', () => {
    assert.equal(redirectFor('recovery', '/auth/reset', true), '/new-password');
    assert.equal(redirectFor('recovery', '/new-password', false), null);
  });

  test("in the app: anywhere but the other states' screens", () => {
    assert.equal(redirectFor('app', '/profile', false), null);
    assert.equal(redirectFor('app', '/shop', false), null);
    assert.equal(redirectFor('app', '/setup', false), '/');
    assert.equal(redirectFor('app', '/sign-in', false), '/');
  });

  test('step 2, Terms and signed out each have their screen', () => {
    assert.equal(redirectFor('setup', '/auth/reset', false), '/setup');
    assert.equal(redirectFor('updatedTerms', '/', false), '/updated-terms');
    assert.equal(redirectFor('signedOut', '/profile', false), '/sign-in');
  });

  test('nothing while starting, loading or failed', () => {
    assert.equal(redirectFor('loading', '/auth/reset', false), null);
  });
});
