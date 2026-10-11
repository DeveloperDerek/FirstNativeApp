import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { sessionStorage } from '@/lib/session-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

/** False until .env has the Supabase URL and key; the sign-in screen explains what to do. */
export const supabaseConfigured = Boolean(url && key);

// Placeholder values keep the app from crashing on launch before .env is
// filled in. No request is made until someone tries to sign in.
export const supabaseUrl = url || 'https://not-configured.supabase.co';
export const supabaseKey = key || 'not-configured';

export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  {
    auth: {
      // Encrypted on the phone (step-tracker-register.txt, 8a)
      storage: sessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);

// Only refresh the session token while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

export const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL || 'https://yourdomain.com/privacy';
