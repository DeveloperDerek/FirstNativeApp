// Which screen to show (step-tracker-register.txt, section 7). Decided only
// from what the server says, never from anything saved on the phone, and
// only here: screens never navigate into the app themselves.

export type LegalDoc = {
  document: 'terms' | 'privacy';
  version: string;
  url: string;
};

/** From account_status() on the server. */
export type AccountStatus = {
  onboarded: boolean;
  blocked: boolean;
  /** false = a version that requires re-acceptance hasn't been accepted */
  termsOk: boolean;
  minimumAge: number;
  /** Current versions not accepted yet (step 2's checkbox, "Updated Terms") */
  termsToAccept: LegalDoc[];
};

export type Route =
  | 'starting' // reading the saved session
  | 'signedOut' // sign in / create account
  | 'recovery' // signed in by a reset link: "Set a new password" before anything else
  | 'loading' // signed in, account not loaded yet: splash, never the tabs
  | 'loadFailed' // "Can't reach StepTracker"
  | 'blocked' // under the minimum age
  | 'setup' // step 2
  | 'updatedTerms'
  | 'app';

export function routeFor(state: {
  sessionRestored: boolean;
  signedIn: boolean;
  /** Signed in by a reset link, and no new password saved yet */
  recovering?: boolean;
  account: AccountStatus | 'loading' | 'failed';
}): Route {
  if (!state.sessionRestored) return 'starting';
  if (!state.signedIn) return 'signedOut';
  if (state.recovering) return 'recovery';
  if (state.account === 'loading') return 'loading';
  if (state.account === 'failed') return 'loadFailed';
  if (state.account.blocked) return 'blocked';
  if (!state.account.onboarded) return 'setup';
  if (!state.account.termsOk) return 'updatedTerms';
  return 'app';
}

/** account_status() as returned by the server (snake_case JSON). */
export function parseAccountStatus(raw: unknown): AccountStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    onboarded: r.onboarded === true,
    blocked: r.blocked === true,
    termsOk: r.terms_ok === true,
    minimumAge: typeof r.minimum_age === 'number' ? r.minimum_age : 13,
    termsToAccept: Array.isArray(r.terms_to_accept) ? (r.terms_to_accept as LegalDoc[]) : [],
  };
}
