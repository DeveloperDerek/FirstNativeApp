import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, View } from 'react-native';

import { deleteAccount } from '@/api/account';
import { withdrawConsent } from '@/api/consent';
import { type Profile, updateDisplayName } from '@/api/profile';
import { type Birthday, changeUsername, getMyBirthday } from '@/api/register';
import { useAuth } from '@/auth/AuthProvider';
import {
  ageOn,
  cleanUsernameInput,
  isoDayToDate,
  isValidDisplayName,
  isValidUsername,
} from '@/auth/register';
import { signOut } from '@/auth/signIn';
import { Avatar } from '@/avatar/Avatar';
import { formatDay } from '@/components/birthday-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Row, Section } from '@/components/ui/section';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/error-message';
import { privacyUrl } from '@/lib/supabase';

export default function ProfileScreen() {
  const router = useRouter();
  const { session, profile, reloadProfile, revocationPending, signOutOtherDevices } = useAuth();
  const provider = session?.user.app_metadata.provider;
  const hasPassword = (session?.user.app_metadata.providers as string[] | undefined)?.includes(
    'email'
  );
  const myId = session?.user.id ?? '';
  const sharing = Boolean(profile?.sharing_consent_at);

  function toggleSharing(next: boolean) {
    if (next) {
      router.push('/consent');
      return;
    }
    Alert.alert(
      'Stop sharing your steps?',
      'Your uploaded step history will be deleted and friends and groups will no longer see your steps. ' +
        'You keep your coins and items, but stop earning new coins.',
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
      {profile && (
        <Section title="Your character">
          <View style={styles.character}>
            <Avatar config={profile.avatar} scale={3} accessibilityLabel="Your character" />
            <View style={styles.characterText}>
              <ThemedText type="small" themeColor="textSecondary">
                Friends and group members see your character on leaderboards.
              </ThemedText>
              <View style={styles.characterButtons}>
                <Button title="Customize" size="small" onPress={() => router.push('/avatar')} />
                <Button
                  title="Shop"
                  size="small"
                  variant="secondary"
                  onPress={() => router.push('/shop')}
                />
              </View>
            </View>
          </View>
        </Section>
      )}

      {profile && <DetailsForm key={profile.id} profile={profile} onSaved={reloadProfile} />}

      {profile && <BirthdaySection userId={profile.id} />}

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

      <Section title="Sign-in and security">
        {hasPassword ? (
          <Button
            title="Change password"
            variant="secondary"
            onPress={() => router.push('/change-password')}
          />
        ) : (
          <ThemedText themeColor="textSecondary">
            Signed in with{' '}
            {provider === 'apple' ? 'Apple' : provider === 'google' ? 'Google' : provider}
          </ThemedText>
        )}
        {revocationPending && (
          <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
            Your other devices may still be signed in.
          </ThemedText>
        )}
        <Button
          title="Sign out other devices"
          variant="secondary"
          onPress={async () => {
            if (await signOutOtherDevices()) {
              Alert.alert('Done', 'Your other devices have been signed out.');
            } else {
              Alert.alert("Couldn't reach StepTracker", 'Check your connection and try again.');
            }
          }}
        />
      </Section>

      <Section title="Account">
        <Button title="Sign out" variant="secondary" onPress={() => signOut()} />
        <Button title="Delete account" variant="danger" onPress={confirmDelete} />
      </Section>
    </Screen>
  );
}

/**
 * Your birthday, to you only and read-only (step-tracker-register.txt,
 * 6g): corrections go to support. Hidden for accounts made before
 * birthdays were asked.
 */
function BirthdaySection({ userId }: { userId: string }) {
  const router = useRouter();
  const [birthday, setBirthday] = useState<Birthday | null>(null);

  // Again on every visit, so a request just sent shows straight away
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getMyBirthday(userId)
        .then((b) => alive && setBirthday(b))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [userId])
  );

  if (!birthday?.birthDate) return null;
  return (
    <Section title="Birthday">
      <Row
        title={formatDay(isoDayToDate(birthday.birthDate))}
        detail={`${ageOn(birthday.birthDate)} years old · only you can see this`}
      />
      {birthday.openRequestSince ? (
        <ThemedText type="small" themeColor="textSecondary">
          Correction requested. Support will be in touch.
        </ThemedText>
      ) : (
        <Pressable onPress={() => router.push('/birthday-correction')} accessibilityRole="button">
          <ThemedText type="linkPrimary">Wrong date?</ThemedText>
        </Pressable>
      )}
    </Section>
  );
}

function DetailsForm({ profile, onSaved }: { profile: Profile; onSaved: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [username, setUsername] = useState(profile.username);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const nameChanged = displayName.trim() !== (profile.display_name ?? '');
  const usernameChanged = username !== profile.username;

  async function save() {
    if (!isValidUsername(username)) {
      setMessage({
        text: 'Usernames are 3-20 characters: lowercase letters, numbers, and _.',
        error: true,
      });
      return;
    }
    if (nameChanged && !isValidDisplayName(displayName)) {
      setMessage({
        text: 'Use 1 to 30 characters for your name.',
        error: true,
      });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      // The username only changes through the server, which holds the old
      // one for 30 days (step-tracker-register.txt, 9C)
      if (usernameChanged) await changeUsername(username);
      if (nameChanged) await updateDisplayName(profile.id, displayName.trim());
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
      <TextField value={displayName} onChangeText={setDisplayName} maxLength={30} />
      <ThemedText type="small" themeColor="textSecondary">
        Username (friends search for this)
      </ThemedText>
      <TextField
        value={username}
        onChangeText={(t) => setUsername(cleanUsernameInput(t))}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={20}
      />
      {message && (
        <ThemedText type="small" themeColor={message.error ? 'danger' : 'textSecondary'}>
          {message.text}
        </ThemedText>
      )}
      <Button
        title="Save"
        onPress={save}
        loading={saving}
        disabled={!nameChanged && !usernameChanged}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  character: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  characterButtons: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  characterText: {
    flex: 1,
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
});
