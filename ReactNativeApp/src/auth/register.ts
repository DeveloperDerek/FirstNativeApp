// Sign-up rules (step 1 "Create your account" and step 2 "Set up your
// profile") that don't need the phone, so they can be tested with
// `npm test`. The server checks all of these again.

import type { LegalDoc } from './route.ts';

/** Trimmed and lower-cased before sending. */
export const cleanEmail = (raw: string) => raw.trim().toLowerCase();

/** A basic shape only (something@something.something); the email itself is the real check. */
export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * The newest published version of each document, from the legal_documents
 * rows (the same rule as current_legal_versions() on the server).
 */
export function currentLegalDocs(
  rows: { document: LegalDoc['document']; version: string; url: string; published_at: string }[],
  now = new Date()
): LegalDoc[] {
  const newest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (new Date(row.published_at) > now) continue;
    const seen = newest.get(row.document);
    if (!seen || new Date(row.published_at) > new Date(seen.published_at)) {
      newest.set(row.document, row);
    }
  }
  return [...newest.values()]
    .sort((a, b) => a.document.localeCompare(b.document))
    .map(({ document, version, url }) => ({ document, version, url }));
}

/** Typed capitals become lower-case; spaces become underscores. */
export function cleanUsernameInput(raw: string): string {
  return raw.toLowerCase().replace(/\s/g, '_');
}

export const isValidUsername = (username: string) => /^[a-z0-9_]{3,20}$/.test(username);

/** Display names: 1 to 30 characters after trimming (emoji and accents are fine). */
export function isValidDisplayName(name: string): boolean {
  const length = Array.from(name.trim()).length;
  return length >= 1 && length <= 30;
}

/** Apple's "Hide my email" relay addresses are never used as a suggestion. */
export const isRelayEmail = (email: string) => /@privaterelay\.appleid\.com$/i.test(email);

/**
 * A starting username from the Apple/Google name, or else the start of the
 * email. Null when nothing usable is left.
 */
export function suggestUsername(name: string | null, email: string | null): string | null {
  const source = name?.trim() || (email && !isRelayEmail(email) ? email.split('@')[0] : '');
  const base = source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // é -> e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  return base.length >= 3 ? base : null;
}

/** The suggestion, then with numbers added, for when it is taken. */
export function usernameCandidates(base: string, random = Math.random): string[] {
  const withNumber = (digits: number) => {
    const n = String(Math.floor(random() * 10 ** digits)).padStart(digits, '0');
    return base.slice(0, 20 - n.length) + n;
  };
  return [base, withNumber(2), withNumber(4)];
}

/** A date picked on the phone as the server's 'YYYY-MM-DD' (the local calendar day). */
export function toIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * A 'YYYY-MM-DD' from the server as a local date. (new Date('1990-05-01')
 * would be UTC midnight: April 30 in the US.)
 */
export function isoDayToDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 'YYYY-MM-DD' typed by hand (web has no date picker), or null until it is a real date. */
export function parseIsoDay(text: string): string | null {
  const t = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return toIsoDay(isoDayToDate(t)) === t ? t : null;
}

/** Whole years old on `today` (the birthday itself counts). */
export function ageOn(birthDay: string, today = new Date()): number {
  const b = isoDayToDate(birthDay);
  const hadBirthday =
    today.getMonth() > b.getMonth() ||
    (today.getMonth() === b.getMonth() && today.getDate() >= b.getDate());
  return today.getFullYear() - b.getFullYear() - (hadBirthday ? 0 : 1);
}

/** Codes from complete_signup(), change_username() and friends, in words. */
export function registerErrorMessage(code: string): string | null {
  switch (code) {
    case 'BAD_USERNAME':
      return '3 to 20 letters, numbers or _';
    case 'USERNAME_TAKEN':
      return 'That username is taken.';
    case 'USERNAME_NOT_ALLOWED':
      return "That username isn't allowed. Try another.";
    case 'BAD_DISPLAY_NAME':
      return 'Use 1 to 30 characters for your name.';
    case 'BAD_BIRTH_DATE':
      return 'Check your birthday.';
    case 'TERMS_NOT_ACCEPTED':
    case 'LEGAL_VERSION_NOT_CURRENT':
      return 'The Terms have just been updated. Please read and accept them again.';
    case 'REQUEST_ALREADY_OPEN':
      return 'You already have a request open. Support will be in touch.';
    case 'NOTE_TOO_LONG':
      return 'Keep the note to 500 characters.';
    case 'RATE_LIMITED':
      return 'Too many tries. Wait a few minutes, then try again.';
    default:
      return null;
  }
}
