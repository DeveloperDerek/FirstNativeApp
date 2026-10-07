import { Linking } from 'react-native';
import {
  aggregateRecord,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
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

export async function getSteps(start: Date, end: Date): Promise<number> {
  await ensureInitialized();
  // aggregateRecord de-duplicates overlapping sources (phone + watch).
  const result = await aggregateRecord({
    recordType: 'Steps',
    timeRangeFilter: {
      operator: 'between',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    },
  });
  return result.COUNT_TOTAL ?? 0;
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
