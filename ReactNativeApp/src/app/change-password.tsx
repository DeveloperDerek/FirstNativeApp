import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { classifyAuthError, maskEmail } from '@/auth/links';
import { passwordErrorMessage, passwordProblem } from '@/auth/password';
import { changePassword, isCurrentPassword } from '@/auth/password-change';
import { GroundText } from '@/components/ground-text';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { PasswordField } from '@/components/ui/password-field';
import { Screen } from '@/components/ui/screen';
import { Section } from '@/components/ui/section';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

const OFFLINE = 'No connection. Check your internet and try again.';

// Profile > Change password (step-tracker-register.txt, 8d). Asks for the
// current password first. If the sign-in is more than a day old, Supabase
// ("secure password change") also wants a code sent to the email.
export default function ChangePasswordScreen() {
  const router = useRouter();
  const { session, setRevocationPending } = useAuth();
  const email = session?.user.email ?? '';
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ othersSignedOut: boolean } | null>(null);

  const newPasswordError = password ? passwordProblem(password, [email]) : null;

  async function save() {
    if (!current || !password || newPasswordError) return;
    setSaving(true);
    setError(null);
    try {
      if (code === null && !(await isCurrentPassword(email, current))) {
        setError("That's not your current password.");
        return;
      }
      const result = await changePassword(session?.user.id ?? '', {
        password,
        current_password: current,
        nonce: code?.trim() || undefined,
      });
      setRevocationPending(!result.othersSignedOut);
      setDone(result);
    } catch (e) {
      const errorCode = (e as { code?: string }).code;
      if (errorCode === 'reauthentication_needed') {
        // Sends the code to the account's email
        const { error: sendError } = await supabase.auth.reauthenticate();
        if (sendError)
          setError(
            classifyAuthError(sendError) === 'offline'
              ? OFFLINE
              : "Couldn't send the code. Try again in a minute."
          );
        else setCode('');
      } else if (errorCode === 'reauthentication_not_valid') {
        setError("That code didn't work. Check the email and try again.");
      } else if (classifyAuthError(e) === 'offline') {
        setError(OFFLINE);
      } else {
        setError(passwordErrorMessage(e));
      }
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <Screen title="Password changed" inTabs={false}>
        <Section>
          <ThemedText>
            {done.othersSignedOut
              ? 'Your other devices have been signed out.'
              : "Your other devices may still be signed in. We'll keep trying to sign them out."}
          </ThemedText>
        </Section>
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen title="Change password" inTabs={false}>
      <Section>
        <View style={styles.form}>
          <PasswordField
            label="Current password"
            value={current}
            onChangeText={(t) => {
              setCurrent(t);
              setError(null);
            }}
            autoComplete="current-password"
            textContentType="password"
          />
          <PasswordField
            label="New password"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setError(null);
            }}
            showStrength
            error={newPasswordError}
            autoComplete="new-password"
            textContentType="newPassword"
          />
          {code !== null && (
            <View style={styles.field}>
              <ThemedText type="smallBold">Code from your email</ThemedText>
              <TextField
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={10}
                accessibilityLabel="Code from your email"
              />
              <ThemedText type="small" themeColor="textSecondary">
                For your security, we sent a code to {maskEmail(email)}.
              </ThemedText>
            </View>
          )}
          {error && (
            <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
              {error}
            </ThemedText>
          )}
          <Button
            title="Change password"
            onPress={save}
            loading={saving}
            disabled={!current || !password || !!newPasswordError || code === '' || saving}
          />
        </View>
      </Section>
      <GroundText type="small">
        Changing your password signs you out on your other devices.
      </GroundText>
      <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Spacing.three,
  },
  field: {
    gap: Spacing.two,
  },
});
