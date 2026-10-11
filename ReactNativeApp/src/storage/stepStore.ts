import AsyncStorage from '@react-native-async-storage/async-storage';

import { dayKey, pruneLog, type StepLog, stepsKey } from './step-log';

export { dayKey, type StepLog } from './step-log';

// Before history was kept per account, everyone shared this key. Whose
// steps it holds can't be known, so it's deleted rather than handed on.
export const LEGACY_STEPS_KEY = 'steps-by-day';
let legacyRemoved = false;

export async function loadSteps(userId: string): Promise<StepLog> {
  if (!legacyRemoved) {
    legacyRemoved = true;
    await AsyncStorage.removeItem(LEGACY_STEPS_KEY).catch(() => {});
  }
  const raw = await AsyncStorage.getItem(stepsKey(userId));
  return raw ? JSON.parse(raw) : {};
}

/** Saves the days just read, keeping only the days History shows. */
export async function saveManySteps(userId: string, entries: [Date, number][]): Promise<StepLog> {
  const log = await loadSteps(userId);
  for (const [date, steps] of entries) log[dayKey(date)] = steps;
  const kept = pruneLog(log);
  await AsyncStorage.setItem(stepsKey(userId), JSON.stringify(kept));
  return kept;
}
