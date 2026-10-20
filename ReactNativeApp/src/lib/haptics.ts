import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

import { errorMessage } from '@/lib/error-message';

// The app's haptics, in one place: each one fire-and-forget, never
// breaking whatever it's played for. Dev builds say why one didn't play
// (most often: this build was made without expo-haptics).

function buzz(haptic: Promise<void>) {
  haptic.catch((e) => {
    if (__DEV__) console.warn('Haptic failed:', errorMessage(e));
  });
}

/** A tap: a button that does something, e.g. kudos or the lever. */
export const tap = () => buzz(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** Something picked up, e.g. a tile held to drag. */
export const lift = () => buzz(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

/** A thump, e.g. a big win landing. */
export const thump = () => buzz(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));

/** A tick, e.g. a reel tile or a dragged tile passing a slot. */
export const select = () => buzz(Haptics.selectionAsync());

/** It worked: a purchase, a goal, a payout. */
export const success = () => buzz(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

/** Careful: before something that can't be undone. */
export const warn = () => buzz(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));

/** It didn't work. */
export const fail = () => buzz(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));

/**
 * Where `once` remembers what it last played for. Each account has its own
 * keys, cleared on sign-out (auth/local-data.ts).
 */
export const goalBuzzKey = (userId: string) => `goal-buzzed:${userId}`;
export const payoutBuzzKey = (userId: string) => `payout-buzzed:${userId}`;
const ONCE_KEPT = 20;

/**
 * Plays `haptic` the first time this phone sees `mark` under `key` (e.g.
 * today's date, or a quest's id), and not again for it: a win is felt
 * once, not every time its screen opens. The last few marks are kept, so
 * two groups' finished quests don't take turns buzzing.
 */
export async function once(key: string, mark: string, haptic: () => void) {
  try {
    const seen: string[] = JSON.parse((await AsyncStorage.getItem(key)) ?? '[]');
    if (seen.includes(mark)) return;
    await AsyncStorage.setItem(key, JSON.stringify([mark, ...seen].slice(0, ONCE_KEPT)));
  } catch {
    return; // can't remember it: better silent than buzzing every time
  }
  haptic();
}
