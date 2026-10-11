// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { scrubBreadcrumb, scrubEvent, scrubText } from './crash-scrub.ts';

describe('scrubText', () => {
  test('emails, tokens and ids are replaced', () => {
    assert.equal(scrubText('no account for derek@example.com'), 'no account for [email]');
    assert.equal(
      scrubText('bad session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here'),
      'bad session [token] here'
    );
    assert.equal(scrubText('push ExponentPushToken[abcDEF123] failed'), 'push [token] failed');
    assert.equal(scrubText('key sb_publishable_ACJWlzQHlZjBrEguH'), 'key [token]');
    assert.equal(
      scrubText('group 0000006a-b10c-0000-0000-000000000000 not found'),
      'group [id] not found'
    );
    assert.equal(scrubText('x'.repeat(40)), '[token]');
  });

  test('ordinary messages are left alone', () => {
    const message = "Couldn't upload steps: network request failed";
    assert.equal(scrubText(message), message);
  });
});

describe('scrubEvent', () => {
  test('user, request and the device name go; texts are scrubbed', () => {
    const event = {
      message: 'failed for a@b.co',
      user: { id: 'u1', email: 'a@b.co', ip_address: '1.2.3.4' },
      request: { url: 'https://x.supabase.co/rest/v1/profiles?username=ilike.*derek*' },
      server_name: 'Dereks-iPhone',
      tags: { screen: '/groups/0000006a-b10c-0000-0000-000000000000' },
      extra: { detail: { token: 'eyJa.eyJb.sig' } },
      contexts: { device: { name: "Derek's iPhone", model: 'iPhone16,1' }, os: { name: 'iOS' } },
      exception: { values: [{ type: 'Error', value: 'no row for a@b.co' }] },
    };
    const out = scrubEvent(event) as Record<string, unknown>;
    assert.equal(out.user, undefined);
    assert.equal(out.request, undefined);
    assert.equal(out.server_name, undefined);
    assert.equal(out.message, 'failed for [email]');
    assert.deepEqual(out.tags, { screen: '/groups/[id]' });
    assert.deepEqual(out.extra, { detail: { token: '[token]' } });
    assert.deepEqual(out.contexts, { device: { model: 'iPhone16,1' }, os: { name: 'iOS' } });
    assert.deepEqual(out.exception, { values: [{ type: 'Error', value: 'no row for [email]' }] });
  });

  test('stack traces and debug ids are left alone (needed to read the crash)', () => {
    const frames = [{ filename: 'app:///index.android.bundle', lineno: 1, colno: 2 }];
    const debugMeta = { images: [{ debug_id: '0000006a-b10c-0000-0000-000000000000' }] };
    const out = scrubEvent({
      exception: { values: [{ type: 'Error', value: 'x', stacktrace: { frames } }] },
      debug_meta: debugMeta,
    }) as Record<string, unknown>;
    assert.deepEqual((out.exception as { values: { stacktrace: unknown }[] }).values[0].stacktrace, {
      frames,
    });
    assert.deepEqual(out.debug_meta, debugMeta);
  });

  test('only screen changes and errors stay in the trail', () => {
    const out = scrubEvent({
      breadcrumbs: [
        { category: 'navigation', data: { to: '/groups/0000006a-b10c-0000-0000-000000000000' } },
        { category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/profiles?username=derek' } },
        { category: 'console', message: 'session eyJa.eyJb.sig' },
        { category: 'ui.input', message: 'typed' },
      ],
    }) as Record<string, unknown>;
    assert.deepEqual(out.breadcrumbs, [{ category: 'navigation', data: { to: '/groups/[id]' } }]);
  });
});

describe('scrubBreadcrumb', () => {
  test('network, console and input crumbs are dropped before they are kept', () => {
    assert.equal(scrubBreadcrumb({ category: 'xhr' }), null);
    assert.equal(scrubBreadcrumb({ category: 'http' }), null);
    assert.deepEqual(scrubBreadcrumb({ category: 'navigation', message: 'to a@b.co' }), {
      category: 'navigation',
      message: 'to [email]',
    });
  });
});
