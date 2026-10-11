import * as Sentry from '@sentry/react-native';

import { scrubBreadcrumb, scrubEvent } from '@/lib/crash-scrub';

// Crash reporting (step-tracker-builds.txt, Part B). On only in real builds
// with a Sentry DSN set (EXPO_PUBLIC_SENTRY_DSN; meant to be public). Never
// the user id (decision 3), no IP or other personal defaults, no
// performance tracing, screen recording, screenshots or profiling: crashes
// and errors only, each scrubbed (crash-scrub.ts) before it leaves the
// phone.
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
export const crashReportsOn = Boolean(dsn) && !__DEV__;

if (crashReportsOn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    maxBreadcrumbs: 30,
    beforeSend: (event) =>
      scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
    beforeBreadcrumb: (crumb) =>
      scrubBreadcrumb(crumb as unknown as Record<string, unknown>) as unknown as typeof crumb,
  });
}

/** The root component, wrapped so crashes in it are caught (a no-op when off). */
export const withCrashReports = Sentry.wrap;
