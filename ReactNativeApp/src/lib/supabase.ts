import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

/** False until .env has the Supabase URL and key; the sign-in screen explains what to do. */
export const supabaseConfigured = Boolean(url && key);

// Placeholder values keep the app from crashing on launch before .env is
// filled in. No request is made until someone tries to sign in.
export const supabase = createClient(
  url || 'https://not-configured.supabase.co',
  key || 'not-configured',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);

// Only refresh the session token while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL || 'https://yourdomain.com/privacy';
