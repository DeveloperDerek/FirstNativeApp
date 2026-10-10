import AsyncStorage from '@react-native-async-storage/async-storage';

import { type AuthLink, classifyAuthError } from '@/auth/links';
import { supabase } from '@/lib/supabase';

// One check per token for the life of the app. Signing in swaps the
// screens around the link page, which can open it again; a second
// verifyOtp would find the token used and wrongly report it as expired.
const checks = new Map<string, Promise<void>>();

/** Sends the link's token to Supabase; on success there is a session. */
export function verifyAuthLink(link: AuthLink): Promise<void> {
  let check = checks.get(link.tokenHash);
  if (!check) {
    check = supabase.auth
      .verifyOtp({ token_hash: link.tokenHash, type: link.type })
      .then(({ error }) => {
        if (error) throw error;
      });
    // A dropped connection can be tried again; a refused token can't
    check.catch((e) => {
      if (classifyAuthError(e) === 'offline') checks.delete(link.tokenHash);
    });
    checks.set(link.tokenHash, check);
  }
  return check;
}

/** True once this token has been sent (this app run). */
export const hasCheckedLink = (tokenHash: string) => checks.has(tokenHash);

// The email typed when this phone started a sign-up, so an expired link
// can send a new one without asking again (8c). Only on this phone.
const PENDING_EMAIL = 'pending-signup-email';

export const rememberSignupEmail = (email: string) =>
  AsyncStorage.setItem(PENDING_EMAIL, email).catch(() => {});
export const pendingSignupEmail = () => AsyncStorage.getItem(PENDING_EMAIL).catch(() => null);
export const forgetSignupEmail = () => AsyncStorage.removeItem(PENDING_EMAIL).catch(() => {});

/** "Send a new link" for a sign-up confirmation. */
export async function resendConfirmation(email: string) {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) throw error;
}

/** "Send a new link" for a password reset. Says nothing about whether the account exists. */
export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
}
