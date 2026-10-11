// Links from emails (step-tracker-register.txt, 8b and 8c). They carry a
// one-time token_hash that the app sends to Supabase (verifyOtp); only
// then is there a session. Kept free of React Native so `npm test` runs it.

export type AuthLink =
  | { kind: 'confirm'; tokenHash: string; type: 'email' | 'signup' }
  | { kind: 'reset'; tokenHash: string; type: 'recovery' };

type Param = string | string[] | undefined;
const one = (p: Param) => (Array.isArray(p) ? p[0] : p);

/** The link's query, checked. Null for anything that isn't a link we sent. */
export function parseAuthLink(
  kind: AuthLink['kind'],
  params: { token_hash?: Param; type?: Param }
): AuthLink | null {
  const tokenHash = one(params.token_hash);
  const type = one(params.type);
  if (!tokenHash || !/^[A-Za-z0-9_-]{16,200}$/.test(tokenHash)) return null;
  if (kind === 'confirm' && (type === 'email' || type === 'signup')) {
    return { kind, tokenHash, type };
  }
  if (kind === 'reset' && type === 'recovery') return { kind, tokenHash, type };
  return null;
}

/**
 * Why a link, resend or sign-in didn't work. Supabase answers a used, an
 * expired and a made-up link all the same way (otp_expired), so "expired"
 * covers all three.
 */
export type AuthFailure = 'expired' | 'rateLimited' | 'offline' | 'other';

export function classifyAuthError(e: unknown): AuthFailure {
  const err = (e ?? {}) as { code?: string; name?: string; status?: number };
  if (err.code === 'otp_expired') return 'expired';
  if (err.code === 'over_email_send_rate_limit' || err.status === 429) return 'rateLimited';
  if (err.name === 'AuthRetryableFetchError' || err.status === 0 || e instanceof TypeError) {
    return 'offline';
  }
  return 'other';
}

/** "d***@gmail.com": enough to recognize, not the whole address. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  return `${name[0]}***@${domain}`;
}
