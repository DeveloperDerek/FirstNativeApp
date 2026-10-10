import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';

import { classifyAuthError } from '@/auth/links';
import { clearLocalUserData } from '@/auth/local-data';
import type { LegalDoc } from '@/auth/route';
import { type SocialProvider, SocialSignInError } from '@/auth/social';
import { rememberSignupEmail } from '@/auth/verify-link';
import { errorMessage } from '@/lib/error-message';
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
export async function signUpWithEmail(
  email: string,
  password: string,
  /** The Terms and Privacy versions ticked on screen (section 6h) */
  accepted: LegalDoc[] = []
): Promise<boolean> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // There is no session yet, so the versions travel with the request;
    // the server records them only if they are the current ones
    options: accepted.length
      ? {
          data: {
            accepted_legal: Object.fromEntries(accepted.map((d) => [d.document, d.version])),
          },
        }
      : undefined,
  });
  if (error) throw error;
  if (!data.session) await rememberSignupEmail(email);
  // By default Supabase sends a confirmation email before the account
  // can sign in, so there is no session yet.
  return data.session !== null;
}

export async function signInWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

// ---------- APPLE AND GOOGLE ----------
// Both return false when the person cancelled (say nothing) and throw a
// SocialSignInError with words fit to show otherwise (step-tracker-
// register.txt, 8e).

/** Whether each button can work on this phone; hide the ones that can't. */
export async function socialSignInAvailable(): Promise<{ apple: boolean; google: boolean }> {
  const [apple, google] = await Promise.all([
    appleSignInEnabled ? AppleAuthentication.isAvailableAsync().catch(() => false) : false,
    googleSignInEnabled
      ? Platform.OS === 'android'
        ? GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: false }).catch(() => false)
        : true
      : false,
  ]);
  return { apple, google };
}

/** Supabase's answer to an Apple or Google token. */
async function signInWithProviderToken(provider: SocialProvider, token: string, nonce?: string) {
  const result = await supabase.auth.signInWithIdToken({ provider, token, nonce });
  if (result.error) throw failure(provider, result.error);
  return result.data;
}

function failure(provider: SocialProvider, e: unknown): SocialSignInError {
  const kind = classifyAuthError(e) === 'offline' ? 'offline' : 'failed';
  // For the developer, never shown: what really went wrong (no tokens in it)
  if (kind === 'failed') console.warn(`[sign-in] ${provider} failed:`, errorMessage(e));
  return new SocialSignInError(provider, kind, e);
}

// ---------- APPLE (iOS only) ----------
export async function signInWithApple(): Promise<boolean> {
  if (Platform.OS !== 'ios') throw new SocialSignInError('apple', 'unavailable');

  // Apple gets the hashed nonce, Supabase gets the raw one.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (e) {
    if ((e as { code?: string } | null)?.code === 'ERR_REQUEST_CANCELED') return false;
    throw failure('apple', e);
  }
  if (!credential.identityToken) throw failure('apple', new Error('No identity token'));

  const data = await signInWithProviderToken('apple', credential.identityToken, rawNonce);

  // Apple only returns the name on the FIRST sign-in. Keep it on the login
  // account so step 2 can pre-fill the display name (the profile itself is
  // only written by complete_signup()).
  const name = credential.fullName;
  if (name?.givenName && data.user) {
    await supabase.auth.updateUser({
      data: { full_name: [name.givenName, name.familyName].filter(Boolean).join(' ') },
    });
  }
  return true;
}

// ---------- GOOGLE ----------
export async function signInWithGoogle(): Promise<boolean> {
  let idToken: string | null;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true }); // no-op on iOS
    const response = await GoogleSignin.signIn();
    if (isCancelledResponse(response) || !isSuccessResponse(response)) return false;
    idToken = response.data.idToken;
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS) {
        return false;
      }
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new SocialSignInError('google', 'unavailable', e);
      }
    }
    throw failure('google', e);
  }
  if (!idToken) throw failure('google', new Error('Google did not return an ID token'));

  // No nonce is sent: this version of the Google library can't. If
  // Supabase rejects the token with a nonce error on iOS, reproduce it and
  // review before changing anything. "Skip nonce checks" (dashboard) makes
  // it work but weakens replay protection; the library's paid Universal
  // Sign In module supports a real nonce.
  await signInWithProviderToken('google', idToken);
  return true;
}

// ---------- SIGN OUT ----------
// True while the person signs out here, so a sign-out the server forced
// (session revoked, password changed on another phone) can be told apart.
let signingOut = false;
export const isSigningOut = () => signingOut;

export async function signOut() {
  signingOut = true;
  try {
    const { data } = await supabase.auth.getSession();
    if (googleSignInEnabled) {
      // Otherwise the next Google sign-in silently reuses this account.
      await GoogleSignin.signOut().catch(() => {});
    }
    // Removes the saved session even when the server can't be reached
    await supabase.auth.signOut();
    await clearLocalUserData(data.session?.user.id);
  } finally {
    signingOut = false;
  }
}
