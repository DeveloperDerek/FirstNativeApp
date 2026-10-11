import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { getCurrentLegalDocs } from '@/api/register';
import { classifyAuthError } from '@/auth/links';
import { passwordErrorMessage, passwordProblem } from '@/auth/password';
import { cleanEmail, isValidEmail } from '@/auth/register';
import type { LegalDoc } from '@/auth/route';
import { signUpWithEmail } from '@/auth/signIn';
import { LegalAgreementText } from '@/components/legal-links';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PasswordField } from '@/components/ui/password-field';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';

const EMAIL_ERROR = 'Enter a valid email address.';

/**
 * Step 1: "Create your account" (step-tracker-register.txt, section 2).
 * With email confirmation on there is no session afterwards; `onSent`
 * shows "Check your inbox".
 */
export function SignUpForm({
  disabled,
  onSent,
}: {
  disabled: boolean;
  onSent: (email: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalDoc[] | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The exact versions being agreed to. None published yet: no checkbox.
  useEffect(() => {
    getCurrentLegalDocs()
      .then(setLegal)
      .catch(() => setLegal([]));
  }, []);

  const clean = cleanEmail(email);
  // As you type, but only once there is something to judge
  const livePasswordError = passwordError ?? (password ? passwordProblem(password, [clean]) : null);
  const ready =
    isValidEmail(clean) &&
    !passwordProblem(password, [clean]) &&
    legal !== null &&
    (legal.length === 0 || agreed);

  async function submit() {
    if (!isValidEmail(clean)) {
      setEmailError(EMAIL_ERROR);
      return;
    }
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const signedIn = await signUpWithEmail(clean, password, legal ?? []);
      // An email already registered looks exactly the same (Supabase keeps
      // it secret), so strangers can't find out who has an account
      if (!signedIn) onSent(clean);
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === 'weak_password') setPasswordError(passwordErrorMessage(e));
      else if (err.code === 'email_address_invalid' || err.code === 'validation_failed') {
        setEmailError(EMAIL_ERROR);
      } else {
        const why = classifyAuthError(e);
        setError(
          why === 'offline'
            ? 'No connection. Check your internet and try again.'
            : why === 'rateLimited'
              ? 'Too many tries. Wait a minute, then try again.'
              : "Couldn't create your account. Try again in a minute."
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <View style={styles.field}>
        <ThemedText type="smallBold">Email</ThemedText>
        <TextField
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            setEmailError(null);
          }}
          // Checked when the field is left, not on every key
          onBlur={() => email && !isValidEmail(clean) && setEmailError(EMAIL_ERROR)}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          accessibilityLabel="Email"
        />
        {emailError && (
          <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
            {emailError}
          </ThemedText>
        )}
      </View>

      <PasswordField
        label="Password"
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          setPasswordError(null);
        }}
        showStrength
        error={livePasswordError}
        autoComplete="new-password"
        textContentType="newPassword"
      />

      {legal && legal.length > 0 && (
        <Checkbox
          checked={agreed}
          onChange={setAgreed}
          accessibilityLabel="I agree to the Terms and Privacy Policy">
          <LegalAgreementText docs={legal} />
        </Checkbox>
      )}

      {error && (
        <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
          {error}
        </ThemedText>
      )}

      <Button
        title="Continue"
        onPress={submit}
        loading={busy}
        disabled={!ready || busy || disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Spacing.three,
  },
  field: {
    gap: Spacing.two,
  },
});
