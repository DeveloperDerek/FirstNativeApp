import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { classifyAuthError } from '@/auth/links';
import { cleanEmail } from '@/auth/register';
import {
  socialSignInAvailable,
  signInWithApple,
  signInWithEmail,
  signInWithGoogle,
} from '@/auth/signIn';
import { forgetSignupEmail, pendingSignupEmail } from '@/auth/verify-link';
import { Avatar } from '@/avatar/Avatar';
import { DEFAULT_AVATAR } from '@/avatar/types';
import { CheckInbox } from '@/components/check-inbox';
import { ForgotPassword } from '@/components/forgot-password';
import { SignUpForm } from '@/components/sign-up-form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { PasswordField } from '@/components/ui/password-field';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabaseConfigured } from '@/lib/supabase';

type Mode =
  | { name: 'signIn'; email: string }
  | { name: 'signUp' }
  | { name: 'forgot'; email: string }
  | { name: 'inbox'; email: string; notConfirmed: boolean };

// Signed out: sign in, create an account (step 1), or wait for the
// confirmation email (step-tracker-register.txt, sections 2 and 7). On
// success the session changes and the root layout moves on by itself.
export default function SignInScreen() {
  const scheme = useColorScheme();
  const { signedOutByServer } = useAuth();
  const [mode, setMode] = useState<Mode>({ name: 'signIn', email: '' });
  // One sign-in at a time: the others are disabled meanwhile (8e)
  const [busy, setBusy] = useState<'email' | 'apple' | 'google' | null>(null);
  // Buttons for sign-ins this phone can't do are hidden, not left to fail (8e)
  const [social, setSocial] = useState({ apple: false, google: false });
  const [error, setError] = useState<string | null>(null);

  // A sign-up started on this phone and not confirmed yet: back to "Check your inbox"
  useEffect(() => {
    pendingSignupEmail().then(
      (email) => email && setMode({ name: 'inbox', email, notConfirmed: false })
    );
  }, []);

  function go(next: Mode) {
    setError(null);
    setMode(next);
  }

  useEffect(() => {
    socialSignInAvailable().then(setSocial);
  }, []);

  // Cancelling says nothing; anything else is already in words (8e)
  async function signInWithProvider(provider: 'apple' | 'google') {
    if (busy) return; // the Apple button can't be disabled, so ignore it here
    setError(null);
    setBusy(provider);
    try {
      await (provider === 'apple' ? signInWithApple() : signInWithGoogle());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            {(mode.name === 'signIn' || mode.name === 'signUp') && (
              <View style={styles.header}>
                <Avatar
                  config={DEFAULT_AVATAR}
                  scale={3}
                  accessibilityLabel="A StepTracker character"
                />
                <ThemedText type="subtitle" accessibilityRole="header">
                  {mode.name === 'signIn' ? 'StepTracker' : 'Create your account'}
                </ThemedText>
                <ThemedText themeColor="textSecondary">
                  {mode.name === 'signIn'
                    ? 'Sign in to compare steps with friends.'
                    : 'Then set up your profile and start walking.'}
                </ThemedText>
              </View>
            )}

            {signedOutByServer && mode.name === 'signIn' && (
              <ThemedView type="backgroundElement" style={styles.notice}>
                <ThemedText type="small" accessibilityRole="alert">
                  You&apos;ve been signed out. Sign in again.
                </ThemedText>
              </ThemedView>
            )}

            {!supabaseConfigured && (
              <ThemedView type="backgroundElement" style={styles.notice}>
                <ThemedText type="small" themeColor="danger">
                  Supabase is not set up yet. Copy .env.example to .env, add your project URL and
                  key, then restart the dev server.
                </ThemedText>
              </ThemedView>
            )}

            {mode.name === 'signIn' && (
              <SignInForm
                key={mode.email}
                initialEmail={mode.email}
                disabled={busy !== null || !supabaseConfigured}
                onBusy={(b) => setBusy(b ? 'email' : null)}
                onNotConfirmed={(email) => go({ name: 'inbox', email, notConfirmed: true })}
                onForgot={(email) => go({ name: 'forgot', email })}
              />
            )}
            {mode.name === 'forgot' && (
              <ForgotPassword
                initialEmail={mode.email}
                onBack={() => go({ name: 'signIn', email: mode.email })}
              />
            )}
            {mode.name === 'signUp' && (
              <SignUpForm
                disabled={busy !== null || !supabaseConfigured}
                onSent={(email) => go({ name: 'inbox', email, notConfirmed: false })}
              />
            )}
            {mode.name === 'inbox' && (
              <CheckInbox
                email={mode.email}
                notConfirmed={mode.notConfirmed}
                onSignIn={() => go({ name: 'signIn', email: mode.email })}
                onDifferentEmail={async () => {
                  await forgetSignupEmail();
                  go({ name: 'signUp' });
                }}
              />
            )}

            {(mode.name === 'signIn' || mode.name === 'signUp') && (
              <Pressable
                onPress={() =>
                  go(mode.name === 'signIn' ? { name: 'signUp' } : { name: 'signIn', email: '' })
                }
                accessibilityRole="button"
                style={styles.switch}>
                <ThemedText type="linkPrimary">
                  {mode.name === 'signIn'
                    ? 'New here? Create an account'
                    : 'Already have an account? Sign in'}
                </ThemedText>
              </Pressable>
            )}

            {error && (
              <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
                {error}
              </ThemedText>
            )}

            {(mode.name === 'signIn' || mode.name === 'signUp') &&
              (social.apple || social.google) && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.or}>
                  or
                </ThemedText>
              )}
            {(mode.name === 'signIn' || mode.name === 'signUp') && social.apple && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={
                  scheme === 'dark'
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={26}
                style={[styles.appleButton, busy !== null && styles.waiting]}
                onPress={() => signInWithProvider('apple')}
              />
            )}
            {(mode.name === 'signIn' || mode.name === 'signUp') && social.google && (
              <Button
                title="Sign in with Google"
                variant="secondary"
                onPress={() => signInWithProvider('google')}
                loading={busy === 'google'}
                disabled={busy !== null}
              />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function SignInForm({
  initialEmail,
  disabled,
  onBusy,
  onNotConfirmed,
  onForgot,
}: {
  initialEmail: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onNotConfirmed: (email: string) => void;
  onForgot: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const clean = cleanEmail(email);
    if (!clean || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      await signInWithEmail(clean, password);
      await forgetSignupEmail();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'email_not_confirmed') {
        onNotConfirmed(clean);
        return;
      }
      const why = classifyAuthError(e);
      setError(
        code === 'invalid_credentials'
          ? "That email and password don't match."
          : why === 'offline'
            ? 'No connection. Check your internet and try again.'
            : why === 'rateLimited'
              ? 'Too many tries. Wait a minute, then try again.'
              : "Couldn't sign in. Try again in a minute."
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <View style={styles.signInForm}>
      <View style={styles.field}>
        <ThemedText type="smallBold">Email</ThemedText>
        <TextField
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          accessibilityLabel="Email"
        />
      </View>
      <PasswordField
        label="Password"
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={submit}
      />
      {error && (
        <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
          {error}
        </ThemedText>
      )}
      <Button title="Sign in" onPress={submit} loading={busy} disabled={disabled && !busy} />
      <Pressable
        onPress={() => onForgot(cleanEmail(email))}
        accessibilityRole="button"
        style={styles.switch}>
        <ThemedText type="linkPrimary">Forgot password?</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  flex: {
    flex: 1,
  },
  form: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
  },
  signInForm: {
    gap: Spacing.three,
  },
  field: {
    gap: Spacing.two,
  },
  header: {
    gap: Spacing.one,
    marginBottom: Spacing.three,
  },
  notice: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  switch: {
    alignItems: 'center',
  },
  or: {
    textAlign: 'center',
  },
  appleButton: {
    height: 52,
  },
  waiting: {
    opacity: 0.5,
  },
});
