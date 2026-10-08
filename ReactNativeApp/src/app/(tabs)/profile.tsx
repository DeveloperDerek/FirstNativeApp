import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, Switch } from 'react-native';

import { deleteAccount } from '@/api/account';
import { withdrawConsent } from '@/api/consent';
import { isValidUsername, normalizeUsername, type Profile, updateProfile } from '@/api/profile';
import { useAuth } from '@/auth/AuthProvider';
import { signOut } from '@/auth/signIn';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Row, Section } from '@/components/ui/section';
import { TextField } from '@/components/ui/text-field';
import { errorMessage } from '@/lib/error-message';
import { privacyUrl } from '@/lib/supabase';

export default function ProfileScreen() {
  const router = useRouter();
  const { session, profile, reloadProfile } = useAuth();
  const myId = session?.user.id ?? '';
  const sharing = Boolean(profile?.sharing_consent_at);

  function toggleSharing(next: boolean) {
    if (next) {
      router.push('/consent');
      return;
    }
    Alert.alert(
      'Stop sharing your steps?',
      'Your uploaded step history will be deleted and friends and groups will no longer see your steps.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop sharing',
          style: 'destructive',
          onPress: async () => {
            try {
              await withdrawConsent(myId);
              await reloadProfile();
            } catch (e) {
              Alert.alert('Could not stop sharing', errorMessage(e));
            }
          },
        },
      ]
    );
  }

  function confirmDelete() {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account, step history, friends, ' +
        'and any groups you own. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
            } catch (e) {
              Alert.alert('Could not delete account', errorMessage(e));
            }
          },
        },
      ]
    );
  }

  return (
    <Screen title="Profile" subtitle={session?.user.email}>
      {profile && <DetailsForm key={profile.id} profile={profile} onSaved={reloadProfile} />}

      <Section title="Privacy">
        <Row
          title="Share my steps"
          detail={sharing ? 'Friends and groups can see your daily totals' : 'Not sharing'}>
          <Switch value={sharing} onValueChange={toggleSharing} />
        </Row>
        <Pressable onPress={() => Linking.openURL(privacyUrl)}>
          <ThemedText type="linkPrimary">Privacy policy</ThemedText>
        </Pressable>
      </Section>

      <Section title="Account">
        <Button title="Sign out" variant="secondary" onPress={() => signOut()} />
        <Button title="Delete account" variant="danger" onPress={confirmDelete} />
      </Section>
    </Screen>
  );
}

function DetailsForm({ profile, onSaved }: { profile: Profile; onSaved: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [username, setUsername] = useState(profile.username);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const changed =
    displayName.trim() !== (profile.display_name ?? '') ||
    normalizeUsername(username) !== profile.username;

  async function save() {
    const cleanUsername = normalizeUsername(username);
    if (!isValidUsername(cleanUsername)) {
      setMessage({
        text: 'Usernames are 3-20 characters: lowercase letters, numbers, and _.',
        error: true,
      });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await updateProfile(profile.id, {
        username: cleanUsername,
        display_name: displayName.trim(),
      });
      await onSaved();
      setMessage({ text: 'Saved.', error: false });
    } catch (e) {
      setMessage({ text: errorMessage(e), error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Your details">
      <ThemedText type="small" themeColor="textSecondary">
        Display name (shown on leaderboards)
      </ThemedText>
      <TextField value={displayName} onChangeText={setDisplayName} maxLength={40} />
      <ThemedText type="small" themeColor="textSecondary">
        Username (friends search for this)
      </ThemedText>
      <TextField
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={20}
      />
      {message && (
        <ThemedText type="small" themeColor={message.error ? 'danger' : 'textSecondary'}>
          {message.text}
        </ThemedText>
      )}
      <Button title="Save" onPress={save} loading={saving} disabled={!changed} />
    </Section>
  );
}
