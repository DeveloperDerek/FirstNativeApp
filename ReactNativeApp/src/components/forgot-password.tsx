import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { classifyAuthError } from '@/auth/links';
import { cleanEmail, isValidEmail } from '@/auth/register';
import { sendPasswordReset } from '@/auth/verify-link';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useCooldown } from '@/hooks/use-cooldown';

/**
 * "Forgot password?" (step-tracker-register.txt, 8d). The answer is the
 * same whether or not there is an account, so it can't be used to find
 * out who has one.
 */
export function ForgotPassword({
  initialEmail,
  onBack,
}: {
  initialEmail: string;
  onBack: () => void;
}) {
  const cooldown = useCooldown(60_000);
  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  async function send() {
    const clean = cleanEmail(email);
    if (!isValidEmail(clean)) {
      setNote({ text: 'Enter a valid email address.', error: true });
      return;
    }
    setSending(true);
    setNote(null);
    try {
      await sendPasswordReset(clean);
      cooldown.start();
      setNote({
        text: "If an account exists for that email, we've sent a reset link.",
        error: false,
      });
    } catch (e) {
      const why = classifyAuthError(e);
      if (why === 'rateLimited') {
        // Too soon for this address: says nothing about whether it exists
        cooldown.start();
        setNote({
          text: "If an account exists for that email, we've sent a reset link.",
          error: false,
        });
      } else {
        setNote({
          text:
            why === 'offline'
              ? 'No connection. Check your internet and try again.'
              : "Couldn't send the link. Try again in a minute.",
          error: true,
        });
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.content}>
      <View style={styles.text}>
        <ThemedText type="subtitle" accessibilityRole="header">
          Reset your password
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          We&apos;ll email you a link. Open it on this phone to set a new password.
        </ThemedText>
      </View>
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
          onSubmitEditing={send}
        />
      </View>
      {note && (
        <ThemedText
          type="small"
          themeColor={note.error ? 'danger' : 'textSecondary'}
          accessibilityRole={note.error ? 'alert' : undefined}>
          {note.text}
        </ThemedText>
      )}
      <Button
        title={
          cooldown.secondsLeft > 0
            ? `Send reset link (${cooldown.secondsLeft}s)`
            : 'Send reset link'
        }
        onPress={send}
        loading={sending}
        disabled={cooldown.secondsLeft > 0 || sending}
      />
      <Button title="Back to sign in" variant="secondary" onPress={onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.three,
  },
  text: {
    gap: Spacing.one,
    marginBottom: Spacing.two,
  },
  field: {
    gap: Spacing.two,
  },
});
