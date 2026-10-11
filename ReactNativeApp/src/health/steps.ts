// Types only: Metro always picks steps.ios.ts / steps.android.ts, and
// TypeScript reads this file for the shared signatures.
import type { PermissionResult } from './types';

export async function requestStepPermission(): Promise<PermissionResult> {
  return 'unavailable';
}

export async function getSteps(_start: Date, _end: Date): Promise<number> {
  return 0;
}

export function openHealthSettings(_permission?: PermissionResult) {}

export const permissionHelp: Record<Exclude<PermissionResult, 'granted'>, string> = {
  unavailable: 'Step tracking needs Apple Health (iOS) or Health Connect (Android).',
  denied: 'Step access was denied.',
};
