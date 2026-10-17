// Calendar days as 'YYYY-MM-DD' strings, and times of day for showing.
// No imports, so `npm test` can check this and everything using it.
//
// The local and UTC versions are different on purpose: local is the
// user's calendar (what "today" means to them); UTC is for arithmetic
// and for showing a day that no time zone or daylight saving can move.

/** Local date, not UTC, so "today" matches the user's calendar day. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
  `${String(d.getDate()).padStart(2, '0')}`;

/**
 * A 'YYYY-MM-DD' day as a local Date, for showing it. (new Date('1990-05-01')
 * would be UTC midnight: April 30 in the US.)
 */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** A 'YYYY-MM-DD' day as UTC midnight, in ms. */
export function dayToUtc(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** "3:00 PM", in the phone's own time zone and style. */
export const clockTime = (t: Date | string) =>
  new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
