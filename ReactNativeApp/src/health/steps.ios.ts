import {
  isHealthDataAvailable,
  queryQuantitySamples,
  querySources,
  queryStatisticsCollectionForQuantity,
  queryStatisticsForQuantity,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import { Linking } from 'react-native';

import { dayKey } from '@/storage/step-log';

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

const trustedSources = async () =>
  (await querySources(STEPS)).filter((s) =>
    TRUSTED_PREFIXES.some((p) => s.bundleIdentifier.startsWith(p))
  );

// Anti-cheat layer 1: leave out steps typed in by hand.
const notTypedIn = () => [{ metadata: { withMetadataKey: 'HKWasUserEntered', value: true } }];

export async function getSteps(start: Date, end: Date): Promise<number> {
  const sources = await trustedSources();
  if (sources.length === 0) return 0;

  // HealthKit does the filtering, so cumulativeSum still de-duplicates
  // iPhone + Apple Watch steps, and nothing is subtracted afterwards.
  const result = await queryStatisticsForQuantity(STEPS, ['cumulativeSum'], {
    filter: {
      date: { startDate: start, endDate: end },
      sources,
      NOT: notTypedIn(),
    },
    unit: 'count',
  });
  return Math.round(result.sumQuantity?.quantity ?? 0);
}

/**
 * One total per local day from `start` to `end`, with the same sources and
 * rules as getSteps, in one query. Days with no steps are left out.
 */
export async function getDailySteps(start: Date, end: Date): Promise<Record<string, number>> {
  const sources = await trustedSources();
  if (sources.length === 0) return {};
  const anchor = new Date(start);
  anchor.setHours(0, 0, 0, 0); // days run from local midnight
  const results = await queryStatisticsCollectionForQuantity(
    STEPS,
    ['cumulativeSum'],
    anchor,
    { day: 1 },
    {
      filter: { date: { startDate: start, endDate: end }, sources, NOT: notTypedIn() },
      unit: 'count',
    }
  );
  const days: Record<string, number> = {};
  for (const r of results) {
    if (r.startDate && r.sumQuantity) days[dayKey(r.startDate)] = Math.round(r.sumQuantity.quantity);
  }
  return days;
}

/** The first local day with any counted steps; null if there are none (or no access). */
export async function getFirstStepDay(): Promise<string | null> {
  const sources = await trustedSources();
  if (sources.length === 0) return null;
  const [first] = await queryQuantitySamples(STEPS, {
    limit: 1,
    ascending: true,
    filter: { sources, NOT: notTypedIn() },
    unit: 'count',
  });
  return first ? dayKey(first.startDate) : null;
}

export function openHealthSettings() {
  // Apps can't deep-link to Health > Data Access; app settings is the closest.
  Linking.openSettings();
}

export const permissionHelp: Record<Exclude<PermissionResult, 'granted'>, string> = {
  unavailable: 'Health data is not available on this device.',
  denied: 'Step access was denied.',
};
