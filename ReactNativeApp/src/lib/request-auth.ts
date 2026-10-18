// A request pinned to the account a piece of work started for
// (step-tracker-step-refresh.txt, section 3). The Supabase client adds
// whatever session is current when a request is SENT, so a call made by
// A's refresh just after B signs in would go out as B. A request that
// carries its own token is A's, whenever it lands.

export type RequestAuth = {
  /** The access token when the work started */
  token: string;
  /** Aborted when the account changes */
  signal: AbortSignal;
};

type Pinnable<B> = {
  setHeader(name: string, value: string): B;
  abortSignal(signal: AbortSignal): B;
};

/** Sends the query with `auth`'s token (supabase-js keeps a header the caller set). */
export function pinned<B extends Pinnable<B>>(query: B, auth?: RequestAuth): B {
  if (!auth) return query;
  return query.setHeader('Authorization', `Bearer ${auth.token}`).abortSignal(auth.signal);
}
