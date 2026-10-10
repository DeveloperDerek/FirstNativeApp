import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { saveAvatar } from '@/api/avatar';
import { completeSignup, RegisterError, usernameAvailable } from '@/api/register';
import { useAuth } from '@/auth/AuthProvider';
import {
  cleanUsernameInput,
  isValidDisplayName,
  isValidUsername,
  suggestUsername,
  usernameCandidates,
} from '@/auth/register';
import { signOut } from '@/auth/signIn';
import { Avatar } from '@/avatar/Avatar';
import { DEFAULT_AVATAR, STARTER_LOOKS } from '@/avatar/types';
import { BirthdayField } from '@/components/birthday-field';
import { LegalAgreementText } from '@/components/legal-links';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Check = 'empty' | 'invalid' | 'checking' | 'available' | 'taken' | 'unknown';

const CONNECTION_ERROR = "Couldn't save. Check your connection and try again.";

// Step 2: "Set up your profile" (step-tracker-register.txt, section 3).
// Shown by the root layout while the account has no finished profile, for
// email, Apple and Google sign-ups alike. Saving only asks the server to
// look again; the root layout then moves on by itself.
export default function SetupScreen() {
  const { session, account, reloadAccount } = useAuth();
  const user = session?.user;
  const viaProvider = user?.app_metadata.provider !== 'email';
  const providerName: string | null =
    (user?.user_metadata.full_name as string | undefined) ??
    (user?.user_metadata.name as string | undefined) ??
    null;

  const [username, setUsername] = useState('');
  // The server's last answer, for the name it was about
  const [checked, setChecked] = useState<{
    name: string;
    result: Check;
  } | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(viaProvider ? (providerName ?? '') : '');
  const [birthDay, setBirthDay] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [look, setLook] = useState<(typeof STARTER_LOOKS)[number] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = useRef(false);

  const termsToAccept = account?.termsToAccept ?? [];

  // A starting username, with numbers added if it is taken. Skipped once
  // they start typing their own.
  useEffect(() => {
    const base = suggestUsername(viaProvider ? providerName : null, user?.email ?? null);
    if (!base) return;
    let alive = true;
    (async () => {
      for (const candidate of usernameCandidates(base)) {
        const free = await usernameAvailable(candidate).catch(() => null);
        if (!alive || typed.current) return;
        if (free !== false) {
          setUsername(candidate);
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
    // Once, when the screen opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check: Check = !username
    ? 'empty'
    : !isValidUsername(username)
      ? 'invalid'
      : checked?.name === username
        ? checked.result
        : 'checking';

  // The live check, half a second after the last key
  useEffect(() => {
    if (!isValidUsername(username)) return;
    let alive = true;
    const timer = setTimeout(() => {
      usernameAvailable(username)
        .then(
          (free) =>
            alive &&
            setChecked({
              name: username,
              result: free ? 'available' : 'taken',
            })
        )
        // Offline or too many checks: the server decides on save
        .catch(() => alive && setChecked({ name: username, result: 'unknown' }));
    }, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [username]);

  // Android back button: there is no half-finished account to go back to
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmLeave();
      return true;
    });
    return () => sub.remove();
  }, []);

  const ready =
    isValidUsername(username) &&
    check !== 'taken' &&
    isValidDisplayName(displayName) &&
    birthDay !== null &&
    look !== null &&
    (termsToAccept.length === 0 || agreed);

  async function save() {
    if (!ready || !birthDay || !look) return;
    setSaving(true);
    setError(null);
    try {
      const result = await completeSignup({
        username,
        displayName: displayName.trim(),
        birthDate: birthDay,
        terms: termsToAccept.length ? termsToAccept : undefined,
      });
      // Dress the new character. Only possible once the account is active,
      // so after the step above; if it fails they start in the default
      // look and can change it in Customize.
      if (result !== 'UNDER_AGE' && user) {
        await saveAvatar(user.id, look.avatar).catch(() => {});
      }
      // OK, ALREADY_ONBOARDED (an earlier try worked) and UNDER_AGE all
      // move on from here: the root layout follows the server's answer.
      await reloadAccount();
    } catch (e) {
      if (e instanceof RegisterError) {
        if (e.code.startsWith('USERNAME') || e.code === 'BAD_USERNAME') {
          setUsernameError(e.message);
          if (e.code === 'USERNAME_TAKEN') setChecked({ name: username, result: 'taken' });
        } else {
          setError(e.message);
        }
        // The Terms changed while this screen was open: show the new ones
        if (e.code === 'TERMS_NOT_ACCEPTED' || e.code === 'LEGAL_VERSION_NOT_CURRENT') {
          setAgreed(false);
          await reloadAccount().catch(() => {});
        }
      } else {
        // The save may have worked with the reply lost: ask again before
        // showing an error. If it did, the root layout moves on.
        await reloadAccount().catch(() => {});
        setError(CONNECTION_ERROR);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <ThemedText type="subtitle">Set up your profile</ThemedText>
              <View style={styles.preview}>
                <Avatar
                  config={look?.avatar ?? DEFAULT_AVATAR}
                  scale={3}
                  accessibilityLabel="Your character"
                />
                <ThemedText type="smallBold" numberOfLines={1}>
                  {displayName.trim() || ' '}
                </ThemedText>
              </View>
            </View>

            <View style={styles.field}>
              <ThemedText type="smallBold" nativeID="usernameLabel">
                Username
              </ThemedText>
              <View style={styles.usernameRow}>
                <ThemedText themeColor="textSecondary">@</ThemedText>
                <TextField
                  style={styles.flex}
                  value={username}
                  onChangeText={(t) => {
                    typed.current = true;
                    setUsernameError(null);
                    setUsername(cleanUsernameInput(t));
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username-new"
                  textContentType="username"
                  maxLength={20}
                  accessibilityLabel="Username"
                  accessibilityLabelledBy="usernameLabel"
                />
              </View>
              <UsernameStatus check={check} error={usernameError} />
            </View>

            <View style={styles.field}>
              <ThemedText type="smallBold">Display name</ThemedText>
              <TextField
                value={displayName}
                onChangeText={setDisplayName}
                maxLength={30}
                autoComplete="name"
                textContentType="name"
                accessibilityLabel="Display name"
              />
              <ThemedText type="small" themeColor="textSecondary">
                What friends see on leaderboards and the step road.
              </ThemedText>
            </View>

            <StarterLookPicker value={look} onChange={setLook} />

            <BirthdayField
              label="Birthday"
              hint="Used to check your age. Never shown to anyone."
              onChange={setBirthDay}
            />

            {termsToAccept.length > 0 && (
              <Checkbox
                checked={agreed}
                onChange={setAgreed}
                accessibilityLabel="I agree to the Terms and Privacy Policy">
                <LegalAgreementText docs={termsToAccept} />
              </Checkbox>
            )}

            {error && (
              <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
                {error}
              </ThemedText>
            )}

            <Button
              title={error === CONNECTION_ERROR ? 'Try again' : 'Start walking'}
              onPress={save}
              loading={saving}
              disabled={!ready || saving}
            />
            <Button title="Sign out" variant="secondary" onPress={confirmLeave} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

/** Men's or women's clothes to start in. Everything can be changed later. */
function StarterLookPicker({
  value,
  onChange,
}: {
  value: (typeof STARTER_LOOKS)[number] | null;
  onChange: (look: (typeof STARTER_LOOKS)[number]) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold" nativeID="lookLabel">
        Starting clothes
      </ThemedText>
      <View style={styles.looks} accessibilityRole="radiogroup" accessibilityLabelledBy="lookLabel">
        {STARTER_LOOKS.map((l) => {
          const selected = value?.id === l.id;
          return (
            <Pressable
              key={l.id}
              onPress={() => onChange(l)}
              accessibilityRole="radio"
              accessibilityLabel={l.label}
              accessibilityState={{ checked: selected }}
              style={({ pressed }) => [styles.flex, pressed && styles.pressed]}>
              <ThemedView
                type={selected ? 'backgroundSelected' : 'backgroundElement'}
                style={[styles.look, { borderColor: selected ? theme.accent : 'transparent' }]}>
                <Avatar config={l.avatar} scale={2} accessibilityLabel={l.label} />
                <ThemedText type="smallBold">{l.label}</ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        You can change your hair and clothes any time in Customize.
      </ThemedText>
    </View>
  );
}

function UsernameStatus({ check, error }: { check: Check; error: string | null }) {
  const [text, color]: [string, 'textSecondary' | 'danger' | 'text'] = error
    ? [error, 'danger']
    : check === 'invalid'
      ? ['3 to 20 letters, numbers or _', 'danger']
      : check === 'available'
        ? ['✓ Available', 'text']
        : check === 'taken'
          ? ['✗ That username is taken.', 'danger']
          : check === 'unknown'
            ? ["Can't check right now", 'textSecondary']
            : check === 'checking'
              ? ['Checking…', 'textSecondary']
              : ['Friends search for this.', 'textSecondary'];

  // Android reads the live region; iOS needs telling. Only the answers,
  // not the hint or "Checking…" (section 10: errors are read out).
  const answer = error || ['invalid', 'available', 'taken', 'unknown'].includes(check);
  useEffect(() => {
    if (Platform.OS === 'ios' && answer) AccessibilityInfo.announceForAccessibility(text);
  }, [answer, text]);

  return (
    <ThemedText type="small" themeColor={color} accessibilityLiveRegion="polite">
      {text}
    </ThemedText>
  );
}

function confirmLeave() {
  Alert.alert('Leave sign-up?', 'You can finish setting up your profile next time you sign in.', [
    { text: 'Stay', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
  ]);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  flex: {
    flex: 1,
  },
  form: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.four,
  },
  header: {
    gap: Spacing.three,
  },
  preview: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  field: {
    gap: Spacing.two,
  },
  looks: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  look: {
    alignItems: 'center',
    gap: Spacing.one,
    padding: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.7,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
