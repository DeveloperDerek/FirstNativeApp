// Deletes the calling user's account (App Store requirement, section 13).
// Every table cascades from auth.users, so this also removes their
// profile, steps, friendships, memberships, and groups they own.
//
// TODO before App Review (13f): revoke the user's Sign in with Apple token.
import { createClient } from 'npm:@supabase/supabase-js@2';

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

  const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
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
