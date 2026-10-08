import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  appleSignInEnabled,
  googleSignInEnabled,
  isAppleCancel,
  signInWithApple,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '@/auth/signIn';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/error-message';
import { supabaseConfigured } from '@/lib/supabase';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Mode = 'signIn' | 'signUp';

export default function SignInScreen() {
  const scheme = useColorScheme();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // On success the session changes and the root layout swaps this screen
  // for the tabs, so there is nothing to navigate to here.
  async function submitEmail() {
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError('Enter your email and a password.');
      return;
    }
    setBusy('email');
    try {
      if (mode === 'signIn') {
        await signInWithEmail(email.trim(), password);
      } else if (!(await signUpWithEmail(email.trim(), password))) {
        setNotice('Check your inbox to confirm your email, then sign in.');
        setMode('signIn');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function apple() {
    setError(null);
    try {
      await signInWithApple();
    } catch (e) {
      if (!isAppleCancel(e)) setError(errorMessage(e));
    }
  }

  async function google() {
    setError(null);
    setBusy('google');
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.form}>
          <View style={styles.header}>
            <ThemedText type="subtitle">StepTracker</ThemedText>
            <ThemedText themeColor="textSecondary">
              {mode === 'signIn'
                ? 'Sign in to compare steps with friends.'
                : 'Create an account to compare steps with friends.'}
            </ThemedText>
          </View>

          {!supabaseConfigured && (
            <ThemedView type="backgroundElement" style={styles.notice}>
              <ThemedText type="small" themeColor="danger">
                Supabase is not set up yet. Copy .env.example to .env, add your project URL and key,
                then restart the dev server.
              </ThemedText>
            </ThemedView>
          )}

          <TextField
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <TextField
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
            onSubmitEditing={submitEmail}
          />

          {error && (
            <ThemedText type="small" themeColor="danger">
              {error}
            </ThemedText>
          )}
          {notice && <ThemedText type="small">{notice}</ThemedText>}

          <Button
            title={mode === 'signIn' ? 'Sign in' : 'Create account'}
            onPress={submitEmail}
            loading={busy === 'email'}
            disabled={!supabaseConfigured}
          />
          <Pressable
            onPress={() => {
              setMode(mode === 'signIn' ? 'signUp' : 'signIn');
              setError(null);
            }}
            style={styles.switch}>
            <ThemedText type="linkPrimary">
              {mode === 'signIn' ? 'New here? Create an account' : 'Have an account? Sign in'}
            </ThemedText>
          </Pressable>

          {(appleSignInEnabled || googleSignInEnabled) && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.or}>
              or
            </ThemedText>
          )}
          {appleSignInEnabled && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={
                scheme === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={26}
              style={styles.appleButton}
              onPress={apple}
            />
          )}
          {googleSignInEnabled && (
            <Button
              title="Sign in with Google"
              variant="secondary"
              onPress={google}
              loading={busy === 'google'}
            />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
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
    paddingHorizontal: Spacing.four,
  },
  form: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.three,
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
});
