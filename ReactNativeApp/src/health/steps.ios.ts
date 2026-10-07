import {
  isHealthDataAvailable,
  queryStatisticsForQuantity,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import { Linking } from 'react-native';

import type { PermissionResult } from './types';

const STEPS = 'HKQuantityTypeIdentifierStepCount';

export async function requestStepPermission(): Promise<PermissionResult> {
  if (!isHealthDataAvailable()) return 'unavailable'; // e.g. some iPads
  await requestAuthorization({ toRead: [STEPS] });
  // iOS never reveals whether READ access was granted (privacy). A denial
  // just looks like zero steps, so the UI shows a hint when the count is 0.
  return 'granted';
}

export async function getSteps(start: Date, end: Date): Promise<number> {
  // cumulativeSum de-duplicates iPhone + Apple Watch steps.
  const result = await queryStatisticsForQuantity(STEPS, ['cumulativeSum'], {
    filter: { date: { startDate: start, endDate: end } },
    unit: 'count',
  });
  return Math.round(result.sumQuantity?.quantity ?? 0);
}

export function openHealthSettings() {
  // Apps can't deep-link to Health > Data Access; app settings is the closest.
  Linking.openSettings();
}

export const permissionHelp: Record<Exclude<PermissionResult, 'granted'>, string> = {
  unavailable: 'Health data is not available on this device.',
  denied: 'Step access was denied.',
};
