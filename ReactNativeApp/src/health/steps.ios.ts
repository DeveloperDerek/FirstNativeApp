import {
  isHealthDataAvailable,
  querySources,
  queryStatisticsForQuantity,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import { Linking } from 'react-native';

import type { PermissionResult } from './types';

const STEPS = 'HKQuantityTypeIdentifierStepCount';

// Anti-cheat layer 2: only count steps recorded by trusted sources.
// Apple's own iPhone and Apple Watch sources have bundle ids like
// "com.apple.health.<device-id>". Typed-in entries come from the Health
// app itself ("com.apple.Health", capital H), which this doesn't match.
// Add other trackers you decide to trust, e.g. 'com.garmin.connect'.
const TRUSTED_PREFIXES = ['com.apple.health.'];

export async function requestStepPermission(): Promise<PermissionResult> {
  if (!isHealthDataAvailable()) return 'unavailable'; // e.g. some iPads
  await requestAuthorization({ toRead: [STEPS] });
  // iOS never reveals whether READ access was granted (privacy). A denial
  // just looks like zero steps, so the UI shows a hint when the count is 0.
  return 'granted';
}

export async function getSteps(start: Date, end: Date): Promise<number> {
  const sources = (await querySources(STEPS)).filter((s) =>
    TRUSTED_PREFIXES.some((p) => s.bundleIdentifier.startsWith(p))
  );
  if (sources.length === 0) return 0;

  // HealthKit does the filtering, so cumulativeSum still de-duplicates
  // iPhone + Apple Watch steps, and nothing is subtracted afterwards.
  const result = await queryStatisticsForQuantity(STEPS, ['cumulativeSum'], {
    filter: {
      date: { startDate: start, endDate: end },
      sources,
      // Anti-cheat layer 1: leave out steps typed in by hand.
      NOT: [{ metadata: { withMetadataKey: 'HKWasUserEntered', value: true } }],
    },
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
