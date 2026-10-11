import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, View } from 'react-native';

import { deleteAccount } from '@/api/account';
import { withdrawConsent } from '@/api/consent';
import { type Profile, updateDisplayName } from '@/api/profile';
import { type Birthday, changeUsername, getMyBirthday } from '@/api/register';
import { useAuth } from '@/auth/AuthProvider';
import { checkName } from '@/auth/name-rules';
import {
  ageOn,
  cleanUsernameInput,
  isoDayToDate,
  isValidUsername,
  nameProblem,
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
import {
  askForPush,
  getPushEnabled,
  pushAvailable,
  pushPermission,
  setPushEnabled,
} from '@/notifications/push';

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

      {profile && pushAvailable && <NotificationsSection userId={profile.id} />}

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
/**
 * Push notifications on or off for this account (the server checks it
 * before every push). Shown as on only when this phone also allows them.
 */
function NotificationsSection({ userId }: { userId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [allowed, setAllowed] = useState(false);

  // Re-read on every visit: permission can change in the Settings app
  useFocusEffect(
    useCallback(() => {
      getPushEnabled(userId)
        .then(setEnabled)
        .catch(() => {});
      pushPermission()
        .then((p) => setAllowed(p === 'granted'))
        .catch(() => {});
    }, [userId])
  );

  async function toggle(next: boolean) {
    try {
      if (next) {
        const permission = await askForPush();
        setAllowed(permission === 'granted');
        if (permission === 'denied') {
          Alert.alert(
            'Notifications are off for StepTracker',
            'Turn them on in Settings to hear about friend requests.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
          return;
        }
      }
      await setPushEnabled(next);
      setEnabled(next);
    } catch (e) {
      Alert.alert('Could not change notifications', errorMessage(e));
    }
  }

  return (
    <Section title="Notifications">
      <Row title="Friend requests" detail="When someone wants to be your friend">
        <Switch
          value={Boolean(enabled && allowed)}
          disabled={enabled === null}
          onValueChange={toggle}
        />
      </Row>
    </Section>
  );
}

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

  // Compared as the server will save it, so extra spaces aren't a change
  const nameCheck = checkName(displayName, 'display');
  const nameChanged = (nameCheck.ok ? nameCheck.name : displayName) !== (profile.display_name ?? '');
  const usernameChanged = username !== profile.username;

  async function save() {
    if (!isValidUsername(username)) {
      setMessage({
        text: 'Usernames are 3-20 characters: lowercase letters, numbers, and _.',
        error: true,
      });
      return;
    }
    const problem = nameChanged ? nameProblem(nameCheck, 'display') : null;
    if (problem) {
      setMessage({ text: problem, error: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      // The username only changes through the server, which holds the old
      // one for 30 days (step-tracker-register.txt, 9C)
      if (usernameChanged) await changeUsername(username);
      if (nameChanged && nameCheck.ok) await updateDisplayName(profile.id, nameCheck.name);
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
      {/* Longer than 30: emoji count as one here but more for maxLength */}
      <TextField value={displayName} onChangeText={setDisplayName} maxLength={60} />
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
