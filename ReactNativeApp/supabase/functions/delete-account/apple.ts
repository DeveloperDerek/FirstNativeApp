// Revoking Sign in with Apple when an account is deleted
// (step-tracker-group-owners.txt, Part B). The app asks for Apple once
// more and sends the one-time code (valid 5 minutes); this swaps it for a
// token and revokes that token, so the app disappears from the person's
// Apple ID > Sign in with Apple. Nothing is stored.
//
// No Deno or npm imports, so `npm test` (Node) can run apple.test.ts
// against a stand-in for Apple: the caller passes fetch and the signer.

const APPLE = 'https://appleid.apple.com';

export type AppleConfig = {
  /** The app's bundle ID (the client_id for a native app) */
  clientId: string;
  /** The client secret: a short-lived JWT signed with the Sign in with Apple key */
  clientSecret: () => Promise<string>;
};

type Response = { ok: boolean; status: number; text(): Promise<string> };
export type Fetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string }
) => Promise<Response>;

export type RevokeResult = { ok: true } | { ok: false; error: string };

/** A reason without any token in it, for the failure log. */
class AppleFailure extends Error {
  /** Worth asking again (no answer, or Apple's side failed) */
  readonly retry: boolean;
  constructor(message: string, retry: boolean) {
    super(message);
    this.retry = retry;
  }
}

async function post(fetchFn: Fetch, path: string, form: Record<string, string>): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(`${APPLE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new AppleFailure(`${path}: no answer`, true);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    // Apple's error code only ("invalid_grant"...), never the body as a whole
    let code = '';
    try {
      code = String((JSON.parse(text) as { error?: unknown }).error ?? '');
    } catch {}
    throw new AppleFailure(`${path}: ${res.status}${code ? ` ${code}` : ''}`, res.status >= 500);
  }
  return text;
}

async function withTries<T>(tries: number, step: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step();
    } catch (e) {
      if (!(e instanceof AppleFailure) || !e.retry || attempt >= tries) throw e;
    }
  }
}

/**
 * Swap the code for a token, then revoke it, each tried up to `tries`
 * times (only when Apple doesn't answer or fails on its side; a bad or old
 * code isn't retried). Never throws: the account is deleted either way,
 * and a failure is logged by the caller (decision 5).
 */
export async function revokeAppleAccount(
  code: string | null,
  config: AppleConfig | null,
  fetchFn: Fetch,
  tries = 2
): Promise<RevokeResult> {
  if (!config) return { ok: false, error: 'Sign in with Apple is not set up on the server' };
  if (!code) return { ok: false, error: 'no authorization code from the app' };
  try {
    const secret = await config.clientSecret();
    const tokens = await withTries(tries, () =>
      post(fetchFn, '/auth/token', {
        client_id: config.clientId,
        client_secret: secret,
        code,
        grant_type: 'authorization_code',
      })
    );
    const parsed = JSON.parse(tokens) as { refresh_token?: string; access_token?: string };
    const token = parsed.refresh_token ?? parsed.access_token;
    if (!token) return { ok: false, error: '/auth/token: no token in the answer' };
    await withTries(tries, () =>
      post(fetchFn, '/auth/revoke', {
        client_id: config.clientId,
        client_secret: secret,
        token,
        token_type_hint: parsed.refresh_token ? 'refresh_token' : 'access_token',
      })
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof AppleFailure ? e.message : 'unexpected error' };
  }
}

/** Whether a signed-in user has Apple as one of their ways in. */
export function usesApple(user: {
  app_metadata?: { providers?: unknown };
  identities?: { provider?: string }[] | null;
}): boolean {
  const providers = user.app_metadata?.providers;
  return (
    (Array.isArray(providers) && providers.includes('apple')) ||
    (user.identities ?? []).some((i) => i.provider === 'apple')
  );
}
