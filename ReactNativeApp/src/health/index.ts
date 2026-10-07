export { getSteps, openHealthSettings, permissionHelp, requestStepPermission } from './steps';
export type { PermissionResult } from './types';

/** Midnight-to-midnight range for the local calendar day `daysAgo` days back (0 = today, ends now). */
export function dayRange(daysAgo = 0) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysAgo);
  if (daysAgo === 0) return { start, end: new Date() };
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export const todayRange = () => dayRange(0);
