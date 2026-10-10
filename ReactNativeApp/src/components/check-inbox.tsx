import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { classifyAuthError, maskEmail } from '@/auth/links';
import { resendConfirmation } from '@/auth/verify-link';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useCooldown } from '@/hooks/use-cooldown';

/**
 * After step 1, or signing in before confirming (step-tracker-register.txt,
 * sections 2 and 7, state 2). The app has no session yet, so all it knows
 * is the email typed on this phone.
 */
export function CheckInbox({
  email,
  notConfirmed,
  onSignIn,
  onDifferentEmail,
}: {
  email: string;
  /** They tried to sign in first: "Confirm your email first" */
  notConfirmed: boolean;
  /** "I've confirmed, sign in": e.g. the link was opened on a laptop (8c) */
  onSignIn: () => void;
  onDifferentEmail: () => void;
}) {
  const cooldown = useCooldown(60_000);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  async function resend() {
    setSending(true);
    setNote(null);
    try {
      await resendConfirmation(email);
      cooldown.start();
      setNote({ text: 'Sent. It can take a minute to arrive.', error: false });
    } catch (e) {
      const why = classifyAuthError(e);
      if (why === 'rateLimited') cooldown.start();
      setNote({
        text:
          why === 'rateLimited'
            ? 'Wait a minute before sending another email.'
            : why === 'offline'
              ? 'No connection. Check your internet and try again.'
              : "Couldn't send the email. Try again in a minute.",
        error: true,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.content}>
      <View style={styles.text}>
        <ThemedText type="subtitle" accessibilityRole="header">
          {notConfirmed ? 'Confirm your email first' : 'Check your inbox'}
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          We sent a link to {maskEmail(email)}. Tap the link in the email, then come back.
        </ThemedText>
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
          cooldown.secondsLeft > 0 ? `Resend email (${cooldown.secondsLeft}s)` : 'Resend email'
        }
        variant="secondary"
        onPress={resend}
        loading={sending}
        disabled={cooldown.secondsLeft > 0 || sending}
      />
      <Button title="I've confirmed, sign in" onPress={onSignIn} />
      <Button title="Use a different email" variant="secondary" onPress={onDifferentEmail} />
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
});
