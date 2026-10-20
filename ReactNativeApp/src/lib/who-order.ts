import AsyncStorage from '@react-native-async-storage/async-storage';

// The order the user dragged Today's Who buttons into (Friends and their
// groups). Kept on this phone only; a group not in it yet (just joined)
// goes after the ones that are.

export const FRIENDS_ID = 'friends'; // group ids are uuids, so this never clashes

export const whoOrderKey = (userId: string) => `who-order:${userId}`;

export async function getWhoOrder(userId: string): Promise<string[]> {
  try {
    const saved = await AsyncStorage.getItem(whoOrderKey(userId));
    return saved ? JSON.parse(saved) : [];
  } catch {
    return []; // unreadable: the default order
  }
}

export async function saveWhoOrder(userId: string, ids: string[]) {
  await AsyncStorage.setItem(whoOrderKey(userId), JSON.stringify(ids)).catch(() => {});
}
