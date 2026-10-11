import { Linking, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { signOut } from '@/auth/signIn';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { supportEmail } from '@/lib/supabase';

// Paused by an admin while a report is looked into (step-tracker-safety.txt,
// Part D). Nobody can see the account meanwhile; it always ends in the
// pause being lifted or the account being deleted.
export default function PausedScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.content}>
        <ThemedText type="subtitle" accessibilityRole="header">
          Your account is paused while we look into a report.
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          Nobody can see your account in the meantime. We&apos;ll lift the pause if nothing is
          wrong.
        </ThemedText>
        {supportEmail ? (
          <Pressable onPress={() => Linking.openURL(`mailto:${supportEmail}`)} accessibilityRole="link">
            <ThemedText type="linkPrimary">Questions? {supportEmail}</ThemedText>
          </Pressable>
        ) : (
          <ThemedText themeColor="textSecondary">Questions? Contact StepTracker support.</ThemedText>
        )}
        <Button title="Sign out" onPress={() => signOut()} />
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
    gap: Spacing.four,
  },
});
