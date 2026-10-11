// Apple and Google sign-in failures in words (step-tracker-register.txt,
// 8e). Cancelling says nothing; the raw error is never shown.

export type SocialProvider = 'apple' | 'google';

/**
 * - offline: no connection
 * - unavailable: this phone can't do it (Google Play services missing)
 * - failed: Apple/Google or Supabase refused (setup problem, expired
 *   token, nonce mismatch, ...); the real error is logged for the developer
 */
export type SocialFailure = 'offline' | 'unavailable' | 'failed';

const NAMES: Record<SocialProvider, string> = { apple: 'Apple', google: 'Google' };

export class SocialSignInError extends Error {
  readonly provider: SocialProvider;
  readonly kind: SocialFailure;
  readonly cause?: unknown;

  constructor(provider: SocialProvider, kind: SocialFailure, cause?: unknown) {
    super(socialErrorMessage(provider, kind));
    this.provider = provider;
    this.kind = kind;
    this.cause = cause;
  }
}

export function socialErrorMessage(provider: SocialProvider, kind: SocialFailure): string {
  switch (kind) {
    case 'offline':
      return 'No connection. Check your internet and try again.';
    case 'unavailable':
      return `${NAMES[provider]} sign-in isn't available on this phone. Use email instead.`;
    default:
      return `Couldn't sign in with ${NAMES[provider]}. Try again, or use email.`;
  }
}
