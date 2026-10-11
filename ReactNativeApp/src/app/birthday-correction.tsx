import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { RegisterError, requestBirthdayCorrection } from '@/api/register';
import { useAuth } from '@/auth/AuthProvider';
import { classifyAuthError } from '@/auth/links';
import { BirthdayField } from '@/components/birthday-field';
import { GroundText } from '@/components/ground-text';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Section } from '@/components/ui/section';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';

// Profile > "Wrong date?" (step-tracker-register.txt, 6g). The birthday
// can't be changed in the app: this sends a request, tied to the signed-in
// account, that support checks and applies.
export default function BirthdayCorrectionScreen() {
  const router = useRouter();
  const { account } = useAuth();
  const [day, setDay] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    if (!day) return;
    setSending(true);
    setError(null);
    try {
      await requestBirthdayCorrection(day, note.trim());
      setSent(true);
    } catch (e) {
      setError(
        e instanceof RegisterError
          ? e.message
          : classifyAuthError(e) === 'offline'
            ? 'No connection. Check your internet and try again.'
            : "Couldn't send the request. Try again in a minute."
      );
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <Screen title="Request sent" inTabs={false}>
        <Section>
          <ThemedText>
            Support will check it and get in touch. Your birthday stays as it is until then.
          </ThemedText>
        </Section>
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen title="Wrong birthday?" inTabs={false}>
      <Section>
        <View style={styles.form}>
          <ThemedText type="small" themeColor="textSecondary">
            Support checks every request before changing anything. If the right date means you are
            under {account?.minimumAge ?? 13}, StepTracker has to close the account.
          </ThemedText>
          <BirthdayField label="Your correct birthday" onChange={setDay} />
          <View style={styles.field}>
            <ThemedText type="smallBold">Note for support (optional)</ThemedText>
            <TextField
              value={note}
              onChangeText={setNote}
              maxLength={500}
              multiline
              style={styles.note}
              accessibilityLabel="Note for support"
            />
          </View>
          {error && (
            <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
              {error}
            </ThemedText>
          )}
          <Button
            title="Send request"
            onPress={send}
            loading={sending}
            disabled={!day || sending}
          />
        </View>
      </Section>
      <GroundText type="small">Only you and StepTracker support can see your birthday.</GroundText>
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
  note: {
    height: 96,
    paddingTop: Spacing.two,
    textAlignVertical: 'top',
  },
});
