// What a crash report may carry (step-tracker-builds.txt, Part B). Applied
// to every report and breadcrumb before Sentry sends it: no user, no IP,
// no device name, no network or console trail, and nothing that looks like
// an email, a token or an id in any text. Never steps, names or birthdays:
// the app doesn't add them, and this removes anything that slips in.
//
// No imports, so `npm test` can check it.

type Json = Record<string, unknown>;

const PATTERNS: [RegExp, string][] = [
  [/ExponentPushToken\[[^\]]*\]/g, '[token]'],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]'], // JWTs (Supabase sessions)
  [/\bsb_(?:publishable|secret)_[\w-]+/g, '[token]'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]'],
  [/\b[A-Za-z0-9_-]{32,}\b/g, '[token]'], // long random strings
];

/** Emails, tokens and ids in a piece of text, replaced. */
export function scrubText(text: string): string {
  return PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

/** Every string inside, scrubbed (objects and arrays copied). */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, depth + 1)]));
}

// Breadcrumbs kept: screen changes and the app's own errors. Network calls
// (URLs carry search terms and ids), console lines and taps/typing go.
const KEPT_BREADCRUMBS = new Set(['navigation', 'sentry.event', 'error']);

export function scrubBreadcrumb<T extends Json>(crumb: T): T | null {
  const category = typeof crumb.category === 'string' ? crumb.category : '';
  if (!KEPT_BREADCRUMBS.has(category)) return null;
  return scrubDeep(crumb) as T;
}

/**
 * The report as it may be sent. Message, exception texts, tags, extra and
 * contexts are scrubbed; user, request and the device's name removed.
 * Stack traces and debug_meta are left alone: they hold file names and the
 * ids Sentry needs to turn the trace back into readable code.
 */
export function scrubEvent<T extends Json>(event: T): T {
  const out: Json = { ...event };
  delete out.user;
  delete out.request;
  delete out.server_name;

  if (typeof out.message === 'string') out.message = scrubText(out.message);
  if (out.logentry) out.logentry = scrubDeep(out.logentry);
  if (out.tags) out.tags = scrubDeep(out.tags);
  if (out.extra) out.extra = scrubDeep(out.extra);

  const exception = out.exception as { values?: Json[] } | undefined;
  if (exception?.values) {
    out.exception = {
      ...exception,
      values: exception.values.map((v) => ({
        ...v,
        value: typeof v.value === 'string' ? scrubText(v.value) : v.value,
      })),
    };
  }

  if (out.contexts && typeof out.contexts === 'object') {
    const contexts = { ...(out.contexts as Json) };
    if (contexts.device && typeof contexts.device === 'object') {
      const device = { ...(contexts.device as Json) };
      delete device.name; // e.g. "Derek's iPhone"
      contexts.device = device;
    }
    out.contexts = scrubDeep(contexts);
  }

  if (Array.isArray(out.breadcrumbs)) {
    out.breadcrumbs = (out.breadcrumbs as Json[])
      .map((b) => scrubBreadcrumb(b))
      .filter((b): b is Json => b !== null);
  }
  return out as T;
}
