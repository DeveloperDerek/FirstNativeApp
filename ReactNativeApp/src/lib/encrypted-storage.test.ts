// Run with `npm test` (Node's built-in test runner; Node strips the types).
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  base64ToUtf8,
  type Cipher,
  createEncryptedStorage,
  type KeyValueStore,
  utf8ToBase64,
} from './encrypted-storage.ts';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (n) => data.get(n) ?? null,
    setItem: async (n, v) => void data.set(n, v),
    removeItem: async (n) => void data.delete(n),
  };
}

/** Stands in for the keychain and AES-GCM: "encrypts" by tagging with the key. */
function fakeCipher() {
  const state = { key: null as string | null, made: 0, failRead: false };
  const cipher: Cipher = {
    readKey: async () => {
      if (state.failRead) throw new Error('keychain busy');
      return state.key;
    },
    createKey: async () => {
      state.made += 1;
      state.key = `key${state.made}`;
      return state.key;
    },
    deleteKey: async () => {
      state.key = null;
    },
    encrypt: async (text, key) => `${key}|${utf8ToBase64(text)}`,
    decrypt: async (data, key) => {
      const [k, body] = data.split('|');
      if (k !== key) throw new Error('wrong key');
      return base64ToUtf8(body);
    },
  };
  return { cipher, state };
}

const SESSION = '{"access_token":"abc","user":{"email":"zoë@test.dev"}}';

describe('encrypted session storage (step-tracker-register.txt, 8a)', () => {
  test('what is saved is not the session in plain text, and reads back', async () => {
    const store = memoryStore();
    const storage = createEncryptedStorage(store, fakeCipher().cipher);
    await storage.setItem('sb-auth', SESSION);
    const saved = store.data.get('sb-auth') as string;
    assert.ok(saved.startsWith('enc1:'));
    assert.ok(!saved.includes('access_token'));
    assert.equal(await storage.getItem('sb-auth'), SESSION);
  });

  test('a session saved by an older app version stays signed in and gets encrypted', async () => {
    const store = memoryStore();
    store.data.set('sb-auth', SESSION);
    const storage = createEncryptedStorage(store, fakeCipher().cipher);
    assert.equal(await storage.getItem('sb-auth'), SESSION);
    assert.ok(store.data.get('sb-auth')?.startsWith('enc1:'));
  });

  test('two saves at once share one key', async () => {
    const { cipher, state } = fakeCipher();
    const storage = createEncryptedStorage(memoryStore(), cipher);
    await Promise.all([storage.setItem('a', '1'), storage.setItem('b', '2')]);
    assert.equal(state.made, 1);
  });

  test('without its key (e.g. restored onto another phone) the session is dropped', async () => {
    const store = memoryStore();
    const { cipher, state } = fakeCipher();
    await createEncryptedStorage(store, cipher).setItem('sb-auth', SESSION);
    state.key = null;
    const later = createEncryptedStorage(store, cipher);
    assert.equal(await later.getItem('sb-auth'), null);
    assert.equal(store.data.has('sb-auth'), false);
  });

  test('a key that does not fit drops the session', async () => {
    const store = memoryStore();
    const { cipher, state } = fakeCipher();
    await createEncryptedStorage(store, cipher).setItem('sb-auth', SESSION);
    state.key = 'someone-elses-key';
    assert.equal(await createEncryptedStorage(store, cipher).getItem('sb-auth'), null);
    assert.equal(store.data.has('sb-auth'), false);
  });

  test('if the keychain can’t be read right now, the session is kept for next time', async () => {
    const store = memoryStore();
    const { cipher, state } = fakeCipher();
    await createEncryptedStorage(store, cipher).setItem('sb-auth', SESSION);
    state.failRead = true;
    const storage = createEncryptedStorage(store, cipher);
    assert.equal(await storage.getItem('sb-auth'), null);
    assert.ok(store.data.has('sb-auth'));
    state.failRead = false;
    assert.equal(await storage.getItem('sb-auth'), SESSION);
  });

  test('after sign-out the next session gets a new key', async () => {
    const { cipher, state } = fakeCipher();
    const storage = createEncryptedStorage(memoryStore(), cipher);
    await storage.setItem('sb-auth', SESSION);
    await storage.removeItem('sb-auth');
    await storage.forgetKey();
    assert.equal(state.key, null);
    await storage.setItem('sb-auth', SESSION);
    assert.equal(state.key, 'key2');
  });
});

describe('utf8 <-> base64', () => {
  for (const text of ['', 'a', 'ab', 'abc', 'Zoë 🐝 李', SESSION]) {
    test(JSON.stringify(text).slice(0, 30), () => {
      assert.equal(utf8ToBase64(text), Buffer.from(text, 'utf8').toString('base64'));
      assert.equal(base64ToUtf8(utf8ToBase64(text)), text);
    });
  }
});
