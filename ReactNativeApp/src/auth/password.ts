// Password rules (step-tracker-register.txt, section 2). Length matters
// more than symbols, so there are no other rules. The server's
// leaked-password check (a Supabase setting) stays the final say.

export const PASSWORD_MIN = 8;
/** The longest Supabase accepts. It counts bytes, so an emoji uses up to 4. */
export const PASSWORD_MAX = 72;

// The most-used passwords that are 8 or more characters (shorter ones are
// refused anyway). A short list on purpose: it catches the obvious ones
// as you type, and the server's breach check catches the rest.
// prettier-ignore
const COMMON = new Set([
  '12345678', '123456789', '1234567890', '12345678910', '87654321', '11111111', '00000000',
  '88888888', '12341234', '11223344', '12121212', '123123123', '147258369', '987654321',
  '1q2w3e4r', '1q2w3e4r5t', 'qwertyui', 'qwertyuiop', 'asdfghjk', 'asdfghjkl', 'zxcvbnm1',
  '1qaz2wsx', 'qazwsxedc', 'q1w2e3r4', 'password', 'password1', 'password12', 'password123',
  'passw0rd', 'p@ssw0rd', 'p@ssword', 'iloveyou', 'iloveyou1', 'sunshine', 'princess', 'football',
  'baseball', 'basketball', 'superman', 'batman123', 'starwars', 'whatever', 'trustno1',
  'welcome1', 'welcome123', 'letmein1', 'letmein123', 'abc12345', 'abcd1234', 'abcdefgh',
  'aa123456', 'qwerty123', 'qwerty12', 'master12', 'monkey123', 'dragon123', 'shadow12',
  'michael1', 'jennifer', 'jordan23', 'charlie1', 'computer', 'internet', 'changeme',
  'administrator', 'admin123', 'admin1234', 'secret123', 'steptracker', 'steptracker1',
  'walking1', 'walking123',
]);

/** UTF-8 length: what Supabase counts. */
const byteLength = (text: string) =>
  Array.from(text).reduce((n, ch) => {
    const c = ch.codePointAt(0) as number;
    return n + (c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4);
  }, 0);

/**
 * The reason a password is refused before sending, or null. `personal`:
 * the email (and its start) and username, which never make a password.
 */
export function passwordProblem(password: string, personal: string[] = []): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (byteLength(password) > PASSWORD_MAX) return `Use ${PASSWORD_MAX} characters or fewer.`;
  const lower = password.toLowerCase();
  const mine = personal
    .flatMap((p) => [p, p.split('@')[0]])
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length >= 3);
  if (COMMON.has(lower) || mine.includes(lower)) {
    return 'This password is too common. Choose something harder to guess.';
  }
  return null;
}

export type Strength = 'weak' | 'ok' | 'strong';

/**
 * A hint only: what the bar shows. Longer helps most; mixing kinds of
 * characters helps a little.
 */
export function passwordStrength(password: string): Strength {
  if (passwordProblem(password)) return 'weak';
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const distinct = new Set(password).size;
  if (distinct < 5) return 'weak';
  if (password.length >= 16 || (password.length >= 12 && kinds >= 3)) return 'strong';
  if (password.length >= 10 || kinds >= 3) return 'ok';
  return 'weak';
}

/** Supabase's refusal of a new password, in words. Never "Something went wrong". */
export function passwordErrorMessage(e: unknown): string {
  const err = (e ?? {}) as { code?: string; reasons?: string[] };
  if (err.code === 'weak_password') {
    return err.reasons?.includes('pwned')
      ? 'This password has appeared in a data breach. Choose a different one.'
      : 'Choose a different password.';
  }
  if (err.code === 'same_password') return 'Choose a password you haven’t used here before.';
  return 'Choose a different password.';
}
