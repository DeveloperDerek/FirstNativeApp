// The saved session, encrypted (step-tracker-register.txt, 8a). A random
// key lives in the phone's secure storage (iOS Keychain, Android
// Keystore), which is too small for a whole Supabase session; the session
// itself is stored encrypted with that key in AsyncStorage. Someone who
// copies the app's files gets nothing usable.
//
// The rules live here, free of native modules, so `npm test` can run them;
// src/lib/session-storage.ts plugs in the real keychain and AES-GCM.

/** The parts of AsyncStorage this needs. */
export type KeyValueStore = {
  getItem(name: string): Promise<string | null>;
  setItem(name: string, value: string): Promise<void>;
  removeItem(name: string): Promise<void>;
};

export type Cipher = {
  /** Reads the key from secure storage: null if there is none. Throws if it can't look. */
  readKey(): Promise<string | null>;
  /** Makes a new random key and saves it in secure storage. */
  createKey(): Promise<string>;
  deleteKey(): Promise<void>;
  encrypt(plaintext: string, key: string): Promise<string>;
  /** Throws if the data was not encrypted with this key (or was changed). */
  decrypt(ciphertext: string, key: string): Promise<string>;
};

// Marks an encrypted value; anything else is a session saved in plain text
// by an older version of the app.
const PREFIX = 'enc1:';

export function createEncryptedStorage(store: KeyValueStore, cipher: Cipher) {
  // One key for the whole app run, so two saves at once can't each make one
  let key: Promise<string | null> | null = null;

  function getKey(create: boolean): Promise<string | null> {
    if (!key) key = cipher.readKey();
    // Chained onto the shared promise, so a second caller waits for the
    // first one's new key instead of making its own
    if (create) key = key.then((k) => k ?? cipher.createKey());
    const current = key;
    // Couldn't read or make it (e.g. the keychain was busy): try again next time
    current.catch(() => {
      if (key === current) key = null;
    });
    return current;
  }

  async function setItem(name: string, value: string) {
    const k = (await getKey(true)) as string;
    await store.setItem(name, PREFIX + (await cipher.encrypt(value, k)));
  }

  return {
    async getItem(name: string): Promise<string | null> {
      const raw = await store.getItem(name);
      if (raw === null) return null;

      // Saved before encryption existed: keep the person signed in and
      // encrypt it now
      if (!raw.startsWith(PREFIX)) {
        await setItem(name, raw).catch(() => {});
        return raw;
      }

      let k: string | null;
      try {
        k = await getKey(false);
      } catch {
        // Can't reach the key right now. Not a reason to throw away the
        // session: report nothing and leave it for next time.
        return null;
      }
      try {
        if (!k) throw new Error('No key');
        return await cipher.decrypt(raw.slice(PREFIX.length), k);
      } catch {
        // The key is gone or doesn't fit (e.g. restored onto another
        // phone): this session can never be read again
        await store.removeItem(name);
        return null;
      }
    },

    setItem,

    removeItem: (name: string) => store.removeItem(name),

    /** On sign-out: the next session gets a new key. */
    async forgetKey() {
      key = null;
      await cipher.deleteKey();
    },
  };
}

// Plain text <-> base64 (UTF-8), which the AES functions take and give.
// Written out here so it doesn't depend on TextEncoder/TextDecoder.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function utf8ToBase64(text: string): string {
  const bytes: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 63),
        0x80 | ((c >> 6) & 63),
        0x80 | (c & 63)
      );
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = bytes.slice(i, i + 3);
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '=';
  }
  return out;
}

export function base64ToUtf8(b64: string): string {
  const clean = b64.replace(/=+$/, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const v = j < chunk.length ? ALPHABET.indexOf(chunk[j]) : 0;
      if (v < 0) throw new Error('Not base64');
      n = (n << 6) | v;
    }
    bytes.push((n >> 16) & 255);
    if (chunk.length > 2) bytes.push((n >> 8) & 255);
    if (chunk.length > 3) bytes.push(n & 255);
  }
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let c: number;
    if (b < 0x80) c = bytes[i++];
    else if (b < 0xe0) c = ((b & 31) << 6) | (bytes[i + 1] & 63);
    else if (b < 0xf0) c = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63);
    else {
      c =
        ((b & 7) << 18) |
        ((bytes[i + 1] & 63) << 12) |
        ((bytes[i + 2] & 63) << 6) |
        (bytes[i + 3] & 63);
    }
    if (b >= 0x80) i += b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
    out += String.fromCodePoint(c);
  }
  return out;
}
