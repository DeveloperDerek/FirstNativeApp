import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { googleSignInEnabled, signOut } from '@/auth/signIn';
import { supabase } from '@/lib/supabase';

/**
 * appleCode: for an account with Sign in with Apple, the one-time code from
 * asking for Apple again, so the server can revoke the app's Apple tokens.
 * Without it the account is still deleted (the server logs it).
 */
export async function deleteAccount(appleCode?: string | null) {
  const { error } = await supabase.functions.invoke('delete-account', {
    method: 'POST',
    body: appleCode ? { apple_authorization_code: appleCode } : {},
  });
  if (error) throw error;

  // Disconnect Google so the next sign-in asks for consent again
  if (googleSignInEnabled) {
    await GoogleSignin.revokeAccess().catch(() => {}); // not signed in with Google
  }

  await signOut(); // the saved session, its key and this account's cached data
  await AsyncStorage.clear(); // anything else from Part 1
}
