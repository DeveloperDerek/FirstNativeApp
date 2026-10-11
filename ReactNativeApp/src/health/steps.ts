// Types only: Metro always picks steps.ios.ts / steps.android.ts, and
// TypeScript reads this file for the shared signatures.
import type { PermissionResult } from './types';

export async function requestStepPermission(): Promise<PermissionResult> {
  return 'unavailable';
}

export async function getSteps(_start: Date, _end: Date): Promise<number> {
  return 0;
}

/** One total per local day ('YYYY-MM-DD'); days with no steps left out. */
export async function getDailySteps(_start: Date, _end: Date): Promise<Record<string, number>> {
  return {};
}

/** The first local day with any counted steps; null if none. */
export async function getFirstStepDay(): Promise<string | null> {
  return null;
}

export function openHealthSettings(_permission?: PermissionResult) {}

export const permissionHelp: Record<Exclude<PermissionResult, 'granted'>, string> = {
  unavailable: 'Step tracking needs Apple Health (iOS) or Health Connect (Android).',
  denied: 'Step access was denied.',
};
