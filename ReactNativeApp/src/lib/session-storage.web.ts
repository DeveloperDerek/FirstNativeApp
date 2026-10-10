import AsyncStorage from '@react-native-async-storage/async-storage';

// The browser has no keychain to keep a key in, so on the web the session
// stays in localStorage as before (8a covers the phones).
export const sessionStorage = {
  getItem: (name: string) => AsyncStorage.getItem(name),
  setItem: (name: string, value: string) => AsyncStorage.setItem(name, value),
  removeItem: (name: string) => AsyncStorage.removeItem(name),
  forgetKey: async () => {},
};
