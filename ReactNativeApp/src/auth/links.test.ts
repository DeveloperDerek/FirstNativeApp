// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { classifyAuthError, maskEmail, parseAuthLink } from './links.ts';

const hash = '613eff6f09216cdcf3a5fac793cfa4b2db2bccad9ad25755632065d4';

describe('parseAuthLink (step-tracker-register.txt, 8b)', () => {
  test('a confirmation link', () => {
    assert.deepEqual(parseAuthLink('confirm', { token_hash: hash, type: 'email' }), {
      kind: 'confirm',
      tokenHash: hash,
      type: 'email',
    });
    assert.equal(parseAuthLink('confirm', { token_hash: hash, type: 'signup' })?.type, 'signup');
  });

  test('a reset link', () => {
    assert.deepEqual(parseAuthLink('reset', { token_hash: hash, type: 'recovery' }), {
      kind: 'reset',
      tokenHash: hash,
      type: 'recovery',
    });
  });

  test('a link type on the wrong screen is refused', () => {
    assert.equal(parseAuthLink('confirm', { token_hash: hash, type: 'recovery' }), null);
    assert.equal(parseAuthLink('reset', { token_hash: hash, type: 'email' }), null);
    assert.equal(parseAuthLink('confirm', { token_hash: hash, type: 'magiclink' }), null);
  });

  test('a missing or odd token is refused', () => {
    assert.equal(parseAuthLink('confirm', { type: 'email' }), null);
    assert.equal(parseAuthLink('confirm', { token_hash: 'short', type: 'email' }), null);
    assert.equal(parseAuthLink('confirm', { token_hash: `${hash}<script>`, type: 'email' }), null);
  });

  test('repeated query values use the first', () => {
    assert.equal(
      parseAuthLink('confirm', { token_hash: [hash, 'x'], type: ['email'] })?.tokenHash,
      hash
    );
  });
});

describe('classifyAuthError (8c)', () => {
  test('used, expired and made-up links are all otp_expired', () => {
    assert.equal(classifyAuthError({ code: 'otp_expired', status: 403 }), 'expired');
  });

  test('resending too soon', () => {
    assert.equal(
      classifyAuthError({ code: 'over_email_send_rate_limit', status: 429 }),
      'rateLimited'
    );
  });

  test('no connection', () => {
    assert.equal(classifyAuthError({ name: 'AuthRetryableFetchError', status: 0 }), 'offline');
    assert.equal(classifyAuthError(new TypeError('Network request failed')), 'offline');
  });

  test('anything else', () => {
    assert.equal(classifyAuthError({ code: 'unexpected_failure', status: 500 }), 'other');
    assert.equal(classifyAuthError(null), 'other');
  });
});

describe('maskEmail', () => {
  test('keeps the first letter and the domain', () => {
    assert.equal(maskEmail('derek@gmail.com'), 'd***@gmail.com');
    assert.equal(maskEmail('not-an-email'), 'not-an-email');
  });
});
