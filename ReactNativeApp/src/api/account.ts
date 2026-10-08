import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { googleSignInEnabled } from '@/auth/signIn';
import { supabase } from '@/lib/supabase';

export async function deleteAccount() {
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) throw error;

  // Disconnect Google so the next sign-in asks for consent again
  if (googleSignInEnabled) {
    await GoogleSignin.revokeAccess().catch(() => {}); // not signed in with Google
  }

  await AsyncStorage.clear(); // local step cache from Part 1
  await supabase.auth.signOut({ scope: 'local' });
}
