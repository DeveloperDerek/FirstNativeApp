import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'steps-by-day';
export type StepLog = Record<string, number>; // { "2026-10-06": 8421 }

// Local date, not UTC, so "today" matches the user's calendar day.
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
  `${String(d.getDate()).padStart(2, '0')}`;

export async function loadSteps(): Promise<StepLog> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : {};
}

export async function saveSteps(date: Date, steps: number): Promise<void> {
  await saveManySteps([[date, steps]]);
}

export async function saveManySteps(entries: [Date, number][]): Promise<StepLog> {
  const log = await loadSteps();
  for (const [date, steps] of entries) log[dayKey(date)] = steps;
  await AsyncStorage.setItem(KEY, JSON.stringify(log));
  return log;
}
