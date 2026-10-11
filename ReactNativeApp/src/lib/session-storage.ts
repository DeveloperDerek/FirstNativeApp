import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AESEncryptionKey,
  AESKeySize,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { base64ToUtf8, createEncryptedStorage, utf8ToBase64 } from '@/lib/encrypted-storage';

const KEY_NAME = 'session-encryption-key';
// Only on this phone, and never in a backup: a session restored onto
// another phone can't be read there, and that person signs in again.
const keyOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Where Supabase keeps the session on the phone, encrypted (8a). */
export const sessionStorage = createEncryptedStorage(AsyncStorage, {
  readKey: () => SecureStore.getItemAsync(KEY_NAME, keyOptions),
  async createKey() {
    const key = await (await AESEncryptionKey.generate(AESKeySize.AES256)).encoded('base64');
    await SecureStore.setItemAsync(KEY_NAME, key, keyOptions);
    return key;
  },
  deleteKey: () => SecureStore.deleteItemAsync(KEY_NAME, keyOptions),
  async encrypt(plaintext, key) {
    const sealed = await aesEncryptAsync(
      utf8ToBase64(plaintext),
      await AESEncryptionKey.import(key, 'base64')
    );
    return sealed.combined('base64');
  },
  async decrypt(ciphertext, key) {
    const plain = await aesDecryptAsync(
      AESSealedData.fromCombined(ciphertext),
      await AESEncryptionKey.import(key, 'base64'),
      { output: 'base64' }
    );
    return base64ToUtf8(plain);
  },
});
