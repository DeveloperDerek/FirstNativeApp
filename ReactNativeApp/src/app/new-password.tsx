import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { classifyAuthError } from '@/auth/links';
import { passwordErrorMessage, passwordProblem } from '@/auth/password';
import { changePassword } from '@/auth/password-change';
import { signOut } from '@/auth/signIn';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { PasswordField } from '@/components/ui/password-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';

// After a reset link (step-tracker-register.txt, 8d). The root layout shows
// this before anything else until a new password is saved or the person
// cancels, which signs them out.
export default function NewPasswordScreen() {
  const { session, endRecovery, setRevocationPending } = useAuth();
  const email = session?.user.email ?? '';
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const problem = passwordProblem(password, [email]);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    let othersSignedOut: boolean;
    try {
      ({ othersSignedOut } = await changePassword(session?.user.id ?? '', { password }));
    } catch (e) {
      setError(
        classifyAuthError(e) === 'offline'
          ? 'No connection. Check your internet and try again.'
          : passwordErrorMessage(e)
      );
      setSaving(false);
      return;
    }
    // If the other phones couldn't be signed out yet, it is retried, and
    // Profile says so meanwhile
    setRevocationPending(!othersSignedOut);
    await endRecovery();
  }

  async function cancel() {
    await endRecovery();
    await signOut();
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.form}>
          <ThemedText type="subtitle" accessibilityRole="header">
            Set a new password
          </ThemedText>
          <PasswordField
            label="New password"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setError(null);
            }}
            showStrength
            error={error ?? (password ? passwordProblem(password, [email]) : null)}
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmitEditing={save}
          />
          <Button title="Save new password" onPress={save} loading={saving} />
          <Button title="Cancel" variant="secondary" onPress={cancel} />
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
});
