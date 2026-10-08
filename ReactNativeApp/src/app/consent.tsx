import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { giveConsent } from '@/api/consent';
import { useAuth } from '@/auth/AuthProvider';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/error-message';
import { privacyUrl } from '@/lib/supabase';

const POINTS = [
  'Only daily step totals are uploaded, nothing else from Health.',
  'Friends you accept and members of groups you join can see them.',
  'We never use your health data for advertising or sell it.',
  'Sharing is required to earn coins for the shop.',
  'You can stop sharing or delete your account any time in Profile.',
];

// Shown once after first sign-in, before anything is uploaded (section 14c).
// No pre-ticked boxes: nothing is shared until "Agree" is tapped.
export default function ConsentScreen() {
  const router = useRouter();
  const { session, reloadProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      await giveConsent(session.user.id);
      // The steps provider sees the new consent and uploads right away.
      await reloadProfile();
      router.back();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Screen title="Share your steps?" inTabs={false}>
      <ThemedText>
        To compare with friends, StepTracker uploads your daily step totals to our servers.
      </ThemedText>

      <View style={styles.points}>
        {POINTS.map((p) => (
          <View key={p} style={styles.point}>
            <ThemedText themeColor="textSecondary">•</ThemedText>
            <ThemedText style={styles.pointText}>{p}</ThemedText>
          </View>
        ))}
      </View>

      <Pressable onPress={() => Linking.openURL(privacyUrl)}>
        <ThemedText type="linkPrimary">Read the privacy policy</ThemedText>
      </Pressable>

      {error && (
        <ThemedText type="small" themeColor="danger">
          {error}
        </ThemedText>
      )}

      <View style={styles.buttons}>
        <Button title="Agree and share my steps" onPress={agree} loading={saving} />
        <Button title="Not now (no coins)" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  points: {
    gap: Spacing.two,
    marginVertical: Spacing.three,
  },
  point: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  pointText: {
    flex: 1,
  },
  buttons: {
    gap: Spacing.three,
    marginTop: Spacing.four,
  },
});
