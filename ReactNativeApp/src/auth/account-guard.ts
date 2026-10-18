// Which account work on this phone is for (step-tracker-step-refresh.txt,
// section 3). Work that takes a while (a step refresh) notes the
// generation when it starts and checks it before every save, alert, state
// change or request. React state only catches up after the next render,
// by which time sign-out may already have cleared the phone, so this is
// a plain module that changes the moment the account does. No React
// Native imports, so `npm test` can use it.

let generation = 0;
let signedIn: string | undefined;
let controller = new AbortController();

export type AccountMark = {
  generation: number;
  /** Aborted when the account changes: cancels requests not yet answered. */
  signal: AbortSignal;
};

/** The account's mark right now, to compare against later. */
export function currentAccount(): AccountMark {
  return { generation, signal: controller.signal };
}

/** True while no account change has happened since `mark` was taken. */
export function isCurrent(mark: AccountMark): boolean {
  return mark.generation === generation;
}

/** The account the auth listener last saw; undefined when signed out. */
export function signedInAccount(): string | undefined {
  return signedIn;
}

/** Everything started so far belongs to an account that is going away. */
function accountChanged() {
  generation++;
  controller.abort();
  controller = new AbortController();
}

/**
 * Called by the auth listener with every session it sees, and with
 * undefined first thing on sign-out, before anything is removed. Only a
 * different account (or signing out) counts as a change: a refreshed
 * token for the same person doesn't stop their work.
 */
export function setSignedInAccount(userId: string | undefined) {
  if (userId === signedIn) return;
  signedIn = userId;
  accountChanged();
}
