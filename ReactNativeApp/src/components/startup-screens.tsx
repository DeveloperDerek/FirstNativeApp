import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { signOut } from '@/auth/signIn';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Signed in, account still loading: never the tabs or step 2 meanwhile. */
export function LoadingScreen() {
  const theme = useTheme();
  return (
    <ThemedView style={styles.container}>
      <ActivityIndicator color={theme.textSecondary} accessibilityLabel="Loading" />
    </ThemedView>
  );
}

/** The account couldn't be loaded (section 7). */
export function LoadFailedScreen() {
  const { reloadAccount } = useAuth();
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    // On success the root layout moves on; on failure this screen comes back
    await reloadAccount(true).catch(() => {});
    setBusy(false);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.content}>
        <View style={styles.text}>
          <ThemedText type="subtitle">Can&apos;t reach StepTracker</ThemedText>
          <ThemedText themeColor="textSecondary">
            Check your internet connection and try again.
          </ThemedText>
        </View>
        <Button title="Try again" onPress={retry} loading={busy} />
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
  text: {
    gap: Spacing.one,
    marginBottom: Spacing.three,
  },
});
