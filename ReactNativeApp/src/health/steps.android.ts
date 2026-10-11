import { Linking } from 'react-native';
import {
  aggregateRecord,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  readRecords,
  RecordingMethod,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';

import type { PermissionResult } from './types';

let initialized = false;

async function ensureInitialized() {
  if (!initialized) initialized = await initialize();
  return initialized;
}

const hasSteps = (perms: { recordType?: string; accessType?: string }[]) =>
  perms.some((p) => p.recordType === 'Steps' && p.accessType === 'read');

export async function requestStepPermission(): Promise<PermissionResult> {
  const status = await getSdkStatus();
  if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) return 'unavailable';
  if (!(await ensureInitialized())) return 'unavailable';

  // Only prompt when needed: after two denials Android stops showing the dialog.
  if (hasSteps(await getGrantedPermissions())) return 'granted';
  const granted = await requestPermission([{ accessType: 'read', recordType: 'Steps' }]);
  return hasSteps(granted) ? 'granted' : 'denied';
}

// Anti-cheat layer 2: package names of step sources we trust. "android"
// is the phone's own built-in step counting on Android 14+. Confirm these
// on a real device: log metadata.dataOrigin from readRecords.
const TRUSTED_ORIGINS = [
  'android',
  'com.google.android.apps.fitness', // Google Fit
  'com.sec.android.app.shealth', // Samsung Health
  'com.fitbit.FitbitMobile',
];

export async function getSteps(start: Date, end: Date): Promise<number> {
  await ensureInitialized();
  const timeRangeFilter = {
    operator: 'between' as const,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };

  // De-duplicated total (phone + watch), restricted to trusted sources.
  const result = await aggregateRecord({
    recordType: 'Steps',
    timeRangeFilter,
    dataOriginFilter: TRUSTED_ORIGINS,
  });
  const total = result.COUNT_TOTAL ?? 0;

  // Anti-cheat layer 1: subtract hand-typed records from those sources.
  // Health Connect can't leave them out of the aggregate, and results
  // come in pages, so read every page.
  let manual = 0;
  let pageToken: string | undefined;
  do {
    const page = await readRecords('Steps', {
      timeRangeFilter,
      dataOriginFilter: TRUSTED_ORIGINS,
      pageToken,
    });
    for (const r of page.records) {
      if (r.metadata?.recordingMethod === RecordingMethod.RECORDING_METHOD_MANUAL_ENTRY) {
        manual += r.count;
      }
    }
    pageToken = page.pageToken || undefined;
  } while (pageToken);

  return Math.max(0, total - manual);
}

export function openHealthSettings(permission: PermissionResult) {
  if (permission === 'unavailable') {
    // Health Connect missing or outdated (Android 9-13) - send the user to the Play Store.
    Linking.openURL('market://details?id=com.google.android.apps.healthdata').catch(() =>
      Linking.openURL(
        'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata'
      )
    );
    return;
  }
  openHealthConnectSettings();
}

export const permissionHelp: Record<Exclude<PermissionResult, 'granted'>, string> = {
  unavailable: 'Health Connect is not installed or needs an update.',
  denied: 'Step access was denied. Allow it in Health Connect settings.',
};
