import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { googleSignInEnabled, signOut } from '@/auth/signIn';
import { supabase } from '@/lib/supabase';

export async function deleteAccount() {
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) throw error;

  // Disconnect Google so the next sign-in asks for consent again
  if (googleSignInEnabled) {
    await GoogleSignin.revokeAccess().catch(() => {}); // not signed in with Google
  }

  await signOut(); // the saved session, its key and this account's cached data
  await AsyncStorage.clear(); // anything else from Part 1
}
