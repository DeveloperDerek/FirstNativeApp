import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import {
  type AuthFailure,
  type AuthLink,
  classifyAuthError,
  maskEmail,
  parseAuthLink,
} from '@/auth/links';
import { signOut } from '@/auth/signIn';
import {
  forgetSignupEmail,
  hasCheckedLink,
  pendingSignupEmail,
  resendConfirmation,
  sendPasswordReset,
  verifyAuthLink,
} from '@/auth/verify-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useCooldown } from '@/hooks/use-cooldown';
import { useTheme } from '@/hooks/use-theme';

type State =
  | { step: 'invalid' }
  | { step: 'askSignOut'; link: AuthLink }
  | { step: 'checking'; link: AuthLink }
  | { step: 'recovered' }
  | { step: 'failed'; link: AuthLink; why: AuthFailure };

const RESEND_WAIT_MS = 60_000;

/**
 * A link from an email opened the app (step-tracker-register.txt, 8b and
 * 8c). Checks the token with Supabase, then gets out of the way: the root
 * layout picks the next screen (step 2 after a confirmation, "Set a new
 * password" after a reset). `router.replace` also drops the token from
 * the address.
 */
export function AuthLinkScreen({ kind }: { kind: AuthLink['kind'] }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ token_hash?: string; type?: string }>();
  const { session, profile } = useAuth();
  const [state, setState] = useState<State>(() => {
    const link = parseAuthLink(kind, params);
    if (!link) return { step: 'invalid' };
    // Signed in as someone else: ask first. Not when this link already
    // signed them in (the screens around it change, which can reopen it).
    if (session && !hasCheckedLink(link.tokenHash)) return { step: 'askSignOut', link };
    return { step: 'checking', link };
  });

  useEffect(() => {
    if (state.step !== 'checking') return;
    let alive = true;
    verifyAuthLink(state.link).then(
      async () => {
        // A reset link: the root layout takes it from here ("Set a new password")
        if (state.link.kind === 'reset') {
          if (alive) setState({ step: 'recovered' });
          return;
        }
        await forgetSignupEmail();
        // Even if this screen was swapped out meanwhile: signing in changes
        // the screens around it, and the copy left showing has lost the
        // link's query
        router.replace('/');
      },
      (e) => alive && setState({ step: 'failed', link: state.link, why: classifyAuthError(e) })
    );
    return () => {
      alive = false;
    };
  }, [state, router]);

  async function signOutAndContinue(link: AuthLink) {
    await signOut();
    setState({ step: 'checking', link });
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.content}>
        {(state.step === 'checking' || state.step === 'recovered') && <Checking />}
        {state.step === 'invalid' && (
          <Message
            title="This link doesn't look right"
            body="Open it again from the email, or ask for a new one.">
            <Button title="Continue" onPress={() => router.replace('/')} />
          </Message>
        )}
        {state.step === 'askSignOut' && (
          <Message
            title={`Sign out of ${profile ? `@${profile.username}` : (session?.user.email ?? 'this account')} and continue?`}
            body="This link is for signing in to an account.">
            <Button title="Sign out and continue" onPress={() => signOutAndContinue(state.link)} />
            <Button title="Cancel" variant="secondary" onPress={() => router.replace('/')} />
          </Message>
        )}
        {state.step === 'failed' && state.why === 'offline' && (
          <Message title="No connection" body="Check your internet and try again.">
            <Button
              title="Try again"
              onPress={() => setState({ step: 'checking', link: state.link })}
            />
          </Message>
        )}
        {state.step === 'failed' && state.why !== 'offline' && (
          <Expired kind={kind} onSignIn={() => router.replace('/')} />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function Checking() {
  const theme = useTheme();
  return (
    <View style={styles.checking}>
      <ActivityIndicator color={theme.textSecondary} />
      <ThemedText themeColor="textSecondary">Checking your link…</ThemedText>
    </View>
  );
}

/**
 * Supabase answers a used, an expired and a made-up link the same way, so
 * one message covers them all: the person can sign in if it already
 * worked, or ask for a new link.
 */
function Expired({ kind, onSignIn }: { kind: AuthLink['kind']; onSignIn: () => void }) {
  const [email, setEmail] = useState('');
  const [remembered, setRemembered] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const cooldown = useCooldown(RESEND_WAIT_MS);

  // The email from this phone's sign-up, so it needn't be typed again
  useEffect(() => {
    if (kind === 'confirm') pendingSignupEmail().then((e) => e && setRemembered(e));
  }, [kind]);

  const target = (remembered ?? email).trim().toLowerCase();
  const waitSeconds = cooldown.secondsLeft;

  async function send() {
    if (!target.includes('@')) {
      setNote({ text: 'Enter a valid email address.', error: true });
      return;
    }
    setSending(true);
    setNote(null);
    try {
      if (kind === 'confirm') await resendConfirmation(target);
      else await sendPasswordReset(target);
      cooldown.start();
      setNote({
        // The same words whether or not there is an account (8d)
        text:
          kind === 'confirm'
            ? `Sent. Check your inbox at ${maskEmail(target)}.`
            : "If an account exists for that email, we've sent a reset link.",
        error: false,
      });
    } catch (e) {
      const why = classifyAuthError(e);
      setNote({
        text:
          why === 'rateLimited'
            ? 'Wait a minute before sending another link.'
            : why === 'offline'
              ? 'No connection. Check your internet and try again.'
              : "Couldn't send a new link. Try again in a minute.",
        error: true,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Message
      title="This link has expired"
      body={
        kind === 'confirm'
          ? 'Links work once and only for an hour. If you already confirmed your email, just sign in.'
          : 'Links work once and only for an hour. Send a new one to reset your password.'
      }>
      {remembered ? (
        <ThemedText type="small" themeColor="textSecondary">
          We&apos;ll send it to {maskEmail(remembered)}.
        </ThemedText>
      ) : (
        <TextField
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          accessibilityLabel="Email"
        />
      )}
      {note && (
        <ThemedText
          type="small"
          themeColor={note.error ? 'danger' : 'textSecondary'}
          accessibilityRole={note.error ? 'alert' : undefined}>
          {note.text}
        </ThemedText>
      )}
      <Button
        title={waitSeconds > 0 ? `Send a new link (${waitSeconds}s)` : 'Send a new link'}
        onPress={send}
        loading={sending}
        disabled={waitSeconds > 0 || sending}
      />
      {kind === 'confirm' && <Button title="Sign in" variant="secondary" onPress={onSignIn} />}
    </Message>
  );
}

function Message({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <View style={styles.text}>
        <ThemedText type="subtitle" accessibilityRole="header">
          {title}
        </ThemedText>
        <ThemedText themeColor="textSecondary">{body}</ThemedText>
      </View>
      {children}
    </>
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
  checking: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  text: {
    gap: Spacing.one,
    marginBottom: Spacing.two,
  },
});
