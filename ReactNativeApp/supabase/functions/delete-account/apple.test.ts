// Run with `npm test` (Node's built-in test runner; Node strips the types).
// Apple is replaced by a stand-in: no request leaves the machine.
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type AppleConfig, type Fetch, revokeAppleAccount, usesApple } from './apple.ts';

const config: AppleConfig = { clientId: 'com.example.app', clientSecret: async () => 'SECRET' };

type Reply = { status: number; body?: unknown } | 'no answer';

/** A stand-in for Apple: answers each path from a list, and records the calls. */
function fakeApple(replies: Record<string, Reply[]>) {
  const calls: { path: string; form: Record<string, string> }[] = [];
  const fetchFn: Fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, form: Object.fromEntries(new URLSearchParams(init.body)) });
    const reply = replies[path]?.shift() ?? { status: 200, body: {} };
    if (reply === 'no answer') throw new Error('network');
    return {
      ok: reply.status < 400,
      status: reply.status,
      text: async () => JSON.stringify(reply.body ?? {}),
    };
  };
  return { fetchFn, calls };
}

const tokenOk: Reply = { status: 200, body: { refresh_token: 'R-TOKEN', access_token: 'A-TOKEN' } };

describe('revokeAppleAccount', () => {
  test('swaps the code, then revokes the refresh token', async () => {
    const apple = fakeApple({ '/auth/token': [tokenOk], '/auth/revoke': [{ status: 200 }] });
    assert.deepEqual(await revokeAppleAccount('CODE', config, apple.fetchFn), { ok: true });
    assert.deepEqual(
      apple.calls.map((c) => c.path),
      ['/auth/token', '/auth/revoke']
    );
    assert.deepEqual(apple.calls[0].form, {
      client_id: 'com.example.app',
      client_secret: 'SECRET',
      code: 'CODE',
      grant_type: 'authorization_code',
    });
    assert.equal(apple.calls[1].form.token, 'R-TOKEN');
    assert.equal(apple.calls[1].form.token_type_hint, 'refresh_token');
  });

  test('Apple not answering is tried twice, then given up', async () => {
    const apple = fakeApple({ '/auth/token': ['no answer', 'no answer'] });
    assert.deepEqual(await revokeAppleAccount('CODE', config, apple.fetchFn), {
      ok: false,
      error: '/auth/token: no answer',
    });
    assert.equal(apple.calls.length, 2);
  });

  test('a failed revoke is tried again with the same token (the code is single-use)', async () => {
    const apple = fakeApple({
      '/auth/token': [tokenOk],
      '/auth/revoke': [{ status: 503 }, { status: 200 }],
    });
    assert.deepEqual(await revokeAppleAccount('CODE', config, apple.fetchFn), { ok: true });
    assert.deepEqual(
      apple.calls.map((c) => c.path),
      ['/auth/token', '/auth/revoke', '/auth/revoke']
    );
  });

  test('a bad or old code is not retried, and the error has no token or body in it', async () => {
    const apple = fakeApple({
      '/auth/token': [{ status: 400, body: { error: 'invalid_grant', detail: 'SECRET-ish' } }],
    });
    const result = await revokeAppleAccount('OLD', config, apple.fetchFn);
    assert.deepEqual(result, { ok: false, error: '/auth/token: 400 invalid_grant' });
    assert.equal(apple.calls.length, 1);
  });

  test('only an access token in the answer: that one is revoked', async () => {
    const apple = fakeApple({ '/auth/token': [{ status: 200, body: { access_token: 'A-TOKEN' } }] });
    assert.deepEqual(await revokeAppleAccount('CODE', config, apple.fetchFn), { ok: true });
    assert.equal(apple.calls[1].form.token, 'A-TOKEN');
    assert.equal(apple.calls[1].form.token_type_hint, 'access_token');
  });

  test('no code from the app, or not set up: nothing is sent', async () => {
    const apple = fakeApple({});
    assert.deepEqual(await revokeAppleAccount(null, config, apple.fetchFn), {
      ok: false,
      error: 'no authorization code from the app',
    });
    assert.equal((await revokeAppleAccount('CODE', null, apple.fetchFn)).ok, false);
    assert.equal(apple.calls.length, 0);
  });
});

describe('usesApple', () => {
  test('from the providers list or the identities', () => {
    assert.equal(usesApple({ app_metadata: { providers: ['email', 'apple'] } }), true);
    assert.equal(usesApple({ identities: [{ provider: 'apple' }] }), true);
    assert.equal(usesApple({ app_metadata: { providers: ['google'] }, identities: [] }), false);
  });
});
