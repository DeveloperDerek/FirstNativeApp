import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { acceptLegalDocuments } from '@/api/register';
import { useAuth } from '@/auth/AuthProvider';
import { signOut } from '@/auth/signIn';
import { LegalAgreementText } from '@/components/legal-links';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/error-message';

// A version of the Terms or Privacy Policy that needs accepting again
// (step-tracker-register.txt, section 6h). Until then the server refuses
// everything else; signing out is the other way out.
export default function UpdatedTermsScreen() {
  const { account, reloadAccount } = useAuth();
  const docs = account?.termsToAccept ?? [];
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setSaving(true);
    setError(null);
    try {
      await acceptLegalDocuments(docs);
      // The root layout moves on once the server agrees
      await reloadAccount();
    } catch (e) {
      setError(errorMessage(e));
      setAgreed(false);
      await reloadAccount().catch(() => {});
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.content}>
        <View style={styles.text}>
          <ThemedText type="subtitle" accessibilityRole="header">
            We&apos;ve updated our terms
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            Please read the new version and accept it to keep using StepTracker.
          </ThemedText>
        </View>
        {docs.length > 0 && (
          <Checkbox
            checked={agreed}
            onChange={setAgreed}
            accessibilityLabel="I agree to the updated Terms and Privacy Policy">
            <LegalAgreementText docs={docs} />
          </Checkbox>
        )}
        {error && (
          <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
            {error}
          </ThemedText>
        )}
        <Button
          title="Continue"
          onPress={accept}
          loading={saving}
          disabled={!agreed || saving || docs.length === 0}
        />
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
    marginBottom: Spacing.two,
  },
});
