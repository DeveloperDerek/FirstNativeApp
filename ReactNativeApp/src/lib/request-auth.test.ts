// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pinned } from './request-auth.ts';

/** Records what a Supabase query was told. */
class FakeQuery {
  headers: Record<string, string> = {};
  signal: AbortSignal | null = null;
  setHeader(name: string, value: string) {
    this.headers[name] = value;
    return this;
  }
  abortSignal(signal: AbortSignal) {
    this.signal = signal;
    return this;
  }
}

test('a pinned query carries the token and the signal it was given', () => {
  const signal = new AbortController().signal;
  const q = pinned(new FakeQuery(), { token: 'token-a', signal });
  assert.equal(q.headers.Authorization, 'Bearer token-a');
  assert.equal(q.signal, signal);
});

test('without auth the query is left to the client', () => {
  const q = pinned(new FakeQuery());
  assert.deepEqual(q.headers, {});
  assert.equal(q.signal, null);
});
