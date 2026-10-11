import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { changeUsername, RegisterError } from '@/api/register';
import { useAuth } from '@/auth/AuthProvider';
import { cleanUsernameInput, isValidUsername } from '@/auth/register';
import { signOut } from '@/auth/signIn';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/error-message';

// An admin reset this account's username after a report
// (step-tracker-safety.txt, Part D). A new one is picked before going on;
// the server clears the reset when it's saved.
export default function NewUsernameScreen() {
  const { reloadAccount } = useAuth();
  const [username, setUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!isValidUsername(username)) {
      setError('3 to 20 letters, numbers or _');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await changeUsername(username);
      await reloadAccount();
    } catch (e) {
      setError(e instanceof RegisterError ? e.message : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.content}>
        <ThemedText type="subtitle" accessibilityRole="header">
          Pick a new username
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          Your username was changed after a report. Choose a new one to keep using StepTracker.
        </ThemedText>
        <TextField
          value={username}
          onChangeText={(t) => setUsername(cleanUsernameInput(t))}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          accessibilityLabel="New username"
        />
        {error && (
          <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite">
            {error}
          </ThemedText>
        )}
        <Button title="Save" onPress={save} loading={saving} disabled={!username} />
        <Button title="Sign out" variant="secondary" onPress={() => signOut()} />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
});
