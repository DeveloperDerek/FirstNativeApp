import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { RegisterError } from '@/api/register';
import { NOTE_MAX, REPORT_REASONS, type ReportKind, reportGroup, reportUser } from '@/api/reports';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Row, Section } from '@/components/ui/section';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/error-message';

/**
 * The report sheet (step-tracker-safety.txt, section 8): a reason for this
 * kind of target, an optional note, and for a person "Also block" (off).
 * Opened with ?kind=person|group&id=...&label=@name or the group's name.
 */
export default function ReportScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ kind?: string; id?: string; label?: string }>();
  const kind: ReportKind = params.kind === 'group' ? 'group' : 'person';
  const id = params.id ?? '';
  const label = params.label ?? '';

  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!reason || !id) return;
    setSending(true);
    setError(null);
    try {
      if (kind === 'person') await reportUser(id, reason, note, alsoBlock);
      else await reportGroup(id, reason, note);
      // Nothing promised about hours or outcome; the person isn't told who
      Alert.alert('Thanks', 'We review every report.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      setError(e instanceof RegisterError ? e.message : errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen
      title={kind === 'group' ? 'Report group name' : 'Report'}
      subtitle={kind === 'group' ? `"${label}"` : label}>
      <Section title="What's wrong?">
        {REPORT_REASONS[kind].map((r) => {
          const selected = reason === r.id;
          return (
            <Pressable
              key={r.id}
              onPress={() => setReason(r.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={styles.reason}>
              <View
                style={[
                  styles.radio,
                  { borderColor: theme.text },
                  selected && { backgroundColor: theme.text },
                ]}
              />
              <ThemedText>{r.label}</ThemedText>
            </Pressable>
          );
        })}
      </Section>

      <Section title="Anything to add? (optional)">
        <TextField
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={NOTE_MAX}
          accessibilityLabel="Note"
          style={styles.note}
        />
        <ThemedText type="small" themeColor="textSecondary">
          {note.length}/{NOTE_MAX}. Only StepTracker sees this. {kind === 'person' ? "They won't be told who reported them." : ''}
        </ThemedText>
      </Section>

      {kind === 'person' && (
        <Section>
          <Row title="Also block this person" detail="They won't be able to find you or see your steps">
            <Switch value={alsoBlock} onValueChange={setAlsoBlock} accessibilityLabel="Also block this person" />
          </Row>
        </Section>
      )}

      {error && (
        <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      )}
      <Button title="Send" onPress={send} loading={sending} disabled={!reason} />
      <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  note: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
