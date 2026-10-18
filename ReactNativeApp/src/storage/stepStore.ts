import AsyncStorage from '@react-native-async-storage/async-storage';

import { saveDays, type StepLog, stepsKey } from './step-log';

export { dayKey, type StepLog } from './step-log';

// Before history was kept per account, everyone shared this key. Whose
// steps it holds can't be known, so it's deleted rather than handed on.
export const LEGACY_STEPS_KEY = 'steps-by-day';
let legacyRemoved = false;

async function removeLegacy() {
  if (legacyRemoved) return;
  legacyRemoved = true;
  await AsyncStorage.removeItem(LEGACY_STEPS_KEY).catch(() => {});
}

export async function loadSteps(userId: string): Promise<StepLog> {
  await removeLegacy();
  const raw = await AsyncStorage.getItem(stepsKey(userId));
  return raw ? JSON.parse(raw) : {};
}

/**
 * Saves the days just read, keeping only the days History shows. Nothing
 * is written (null) once `stillCurrent` is false.
 */
export async function saveManySteps(
  userId: string,
  entries: [Date, number][],
  stillCurrent?: () => boolean
): Promise<StepLog | null> {
  await removeLegacy();
  return saveDays(AsyncStorage, userId, entries, stillCurrent);
}
