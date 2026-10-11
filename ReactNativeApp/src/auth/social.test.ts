// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SocialSignInError, socialErrorMessage } from './social.ts';

describe('Apple and Google failures (step-tracker-register.txt, 8e)', () => {
  test('no connection', () => {
    assert.equal(
      socialErrorMessage('google', 'offline'),
      'No connection. Check your internet and try again.'
    );
  });

  test('refused by Apple, Google or Supabase: never the raw error', () => {
    assert.equal(
      socialErrorMessage('apple', 'failed'),
      "Couldn't sign in with Apple. Try again, or use email."
    );
    const e = new SocialSignInError('google', 'failed', new Error('Bad ID token: nonce mismatch'));
    assert.equal(e.message, "Couldn't sign in with Google. Try again, or use email.");
    assert.ok(!e.message.includes('nonce'));
  });

  test('not available on this phone', () => {
    assert.equal(
      socialErrorMessage('google', 'unavailable'),
      "Google sign-in isn't available on this phone. Use email instead."
    );
  });
});
