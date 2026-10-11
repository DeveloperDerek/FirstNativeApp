import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type UserAttributes } from '@supabase/supabase-js';

import { classifyAuthError } from '@/auth/links';
import { supabase, supabaseKey, supabaseUrl } from '@/lib/supabase';
import { unregisterOtherPushDevices } from '@/notifications/push';

// Saving a new password does not by itself sign out other phones
// (step-tracker-register.txt, 8d). So after every password change the
// other sessions are signed out explicitly, and a mark on this phone keeps
// that from being forgotten if it fails: it is set before the change and
// cleared only once the other sessions are gone.
const pendingKey = (userId: string) => `revoke-others-pending:${userId}`;

export const isRevocationPending = (userId: string) =>
  AsyncStorage.getItem(pendingKey(userId))
    .then((v) => v === '1')
    .catch(() => false);

/** Signs out every session of this account except this phone's. True when done. */
export async function signOutOtherDevices(userId: string): Promise<boolean> {
  // Their push addresses first: a signed-out phone can't remove its own.
  // If this fails, the whole sign-out is retried later.
  try {
    await unregisterOtherPushDevices();
  } catch {
    return false;
  }
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) return false;
  await AsyncStorage.removeItem(pendingKey(userId)).catch(() => {});
  return true;
}

/** Retries a pending sign-out of the other devices. Returns whether one is still pending. */
export async function retryPendingRevocation(userId: string): Promise<boolean> {
  if (!(await isRevocationPending(userId))) return false;
  return !(await signOutOtherDevices(userId));
}

/**
 * Saves a new password, then signs out the other devices. Throws if the
 * password was refused. `othersSignedOut: false` means it will be retried
 * (on open, on returning to the app, and every half minute meanwhile).
 */
export async function changePassword(
  userId: string,
  attributes: Pick<UserAttributes, 'password' | 'current_password' | 'nonce'>
): Promise<{ othersSignedOut: boolean }> {
  await AsyncStorage.setItem(pendingKey(userId), '1').catch(() => {});
  const { error } = await supabase.auth.updateUser(attributes);
  if (error) {
    // Refused: nothing changed, nothing to sign out. Lost on the way: it
    // may have been saved, so the mark stays and the retry runs anyway.
    if (classifyAuthError(error) !== 'offline') {
      await AsyncStorage.removeItem(pendingKey(userId)).catch(() => {});
    }
    throw error;
  }
  return { othersSignedOut: await signOutOtherDevices(userId) };
}

/**
 * Whether `password` is this account's current password. Checked on a
 * separate client that saves nothing, so this phone's session is untouched;
 * the short session it makes is ended straight away.
 */
export async function isCurrentPassword(email: string, password: string): Promise<boolean> {
  const check = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await check.auth.signInWithPassword({ email, password });
  if (error) {
    if ((error as { code?: string }).code === 'invalid_credentials') return false;
    throw error;
  }
  await check.auth.signOut({ scope: 'local' }).catch(() => {});
  return true;
}
