import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

/** Each provider is only offered once its keys are in .env (see app.config.ts). */
export const appleSignInEnabled =
  Platform.OS === 'ios' && process.env.EXPO_PUBLIC_APPLE_SIGN_IN === 'true';
export const googleSignInEnabled =
  Platform.OS !== 'web' &&
  Boolean(googleWebClientId) &&
  (Platform.OS !== 'ios' || Boolean(googleIosClientId));

if (googleSignInEnabled) {
  GoogleSignin.configure({ webClientId: googleWebClientId, iosClientId: googleIosClientId });
}

// ---------- EMAIL ----------
/** Returns true if the user is signed in now, false if they must confirm their email first. */
export async function signUpWithEmail(email: string, password: string): Promise<boolean> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  // By default Supabase sends a confirmation email before the account
  // can sign in, so there is no session yet.
  return data.session !== null;
}

export async function signInWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

// ---------- APPLE (iOS only) ----------
export async function signInWithApple() {
  if (Platform.OS !== 'ios') throw new Error('Apple sign-in is iOS only');

  // Apple gets the hashed nonce, Supabase gets the raw one.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce
  );

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });
  if (!credential.identityToken) throw new Error('No identity token');

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;

  // Apple only returns the name on the FIRST sign-in. Save it now.
  const name = credential.fullName;
  if (name?.givenName && data.user) {
    await supabase
      .from('profiles')
      .update({
        display_name: [name.givenName, name.familyName].filter(Boolean).join(' '),
      })
      .eq('id', data.user.id);
  }
}

/** True when the user closed the Apple sheet - not worth showing an error for. */
export const isAppleCancel = (e: unknown) =>
  (e as { code?: string } | null)?.code === 'ERR_REQUEST_CANCELED';

// ---------- GOOGLE ----------
/** Returns false if the user cancelled. */
export async function signInWithGoogle(): Promise<boolean> {
  await GoogleSignin.hasPlayServices(); // no-op on iOS
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) return false;
  const idToken = response.data.idToken;
  if (!idToken) throw new Error('Google did not return an ID token');

  // If Supabase rejects this with a nonce error on iOS, turn on
  // "Skip nonce checks" for the Google provider in the dashboard.
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;
  return true;
}

// ---------- SIGN OUT ----------
export async function signOut() {
  if (googleSignInEnabled) {
    // Otherwise the next Google sign-in silently reuses this account.
    await GoogleSignin.signOut().catch(() => {});
  }
  await supabase.auth.signOut();
}
