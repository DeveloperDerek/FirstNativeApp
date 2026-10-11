// Deletes the calling user's account (App Store requirement, section 13).
// Groups they own pass to their longest-standing member (the database does
// that); everything else of theirs goes with the account.
//
// An account with Sign in with Apple has its Apple tokens revoked first
// (step-tracker-group-owners.txt, Part B): the app sends the one-time code
// from asking for Apple again ({"apple_authorization_code": "..."}). If
// that can't be done, the account is deleted anyway and the failure logged
// with the account id only (decision 5).
//
// Secrets for Apple, set in the Supabase dashboard (never in the app or the
// repo): APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8 file's
// contents), APPLE_CLIENT_ID (the app's bundle ID).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { importPKCS8, SignJWT } from 'npm:jose@5.9.6';

import { type AppleConfig, revokeAppleAccount, usesApple } from './apple.ts';

/** Null until all four Apple secrets are set. */
function appleConfig(): AppleConfig | null {
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const privateKey = Deno.env.get('APPLE_PRIVATE_KEY');
  const clientId = Deno.env.get('APPLE_CLIENT_ID');
  if (!teamId || !keyId || !privateKey || !clientId) return null;
  return {
    clientId,
    // Apple's client secret: a JWT signed with the Sign in with Apple key
    async clientSecret() {
      const key = await importPKCS8(privateKey, 'ES256');
      return new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: keyId })
        .setIssuer(teamId)
        .setSubject(clientId)
        .setAudience('https://appleid.apple.com')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(key);
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // The app sends the signed-in user's token automatically
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response('Unauthorized', { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');

  // These two env vars are provided to Edge Functions by Supabase
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Work out WHO is calling from the token. Never accept a user id
  // from the request body, or anyone could delete anyone.
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return new Response('Unauthorized', { status: 401 });
  }
  const user = data.user;

  if (usesApple(user)) {
    const body = await req.json().catch(() => ({}));
    const code =
      typeof body?.apple_authorization_code === 'string' ? body.apple_authorization_code : null;
    const result = await revokeAppleAccount(code, appleConfig(), fetch);
    if (!result.ok) {
      // The account id and a reason only (no tokens, no email)
      const { error: logError } = await admin
        .from('apple_revocation_failures')
        .insert({ user_id: user.id, error: result.error });
      if (logError) console.error('Could not log the Apple revocation failure', logError.message);
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ deleted: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
