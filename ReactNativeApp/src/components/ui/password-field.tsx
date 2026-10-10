import { useState } from 'react';
import { Pressable, StyleSheet, type TextInputProps, View } from 'react-native';

import { type Strength, passwordStrength } from '@/auth/password';
import { ThemedText } from '@/components/themed-text';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = Pick<TextInputProps, 'onSubmitEditing' | 'textContentType' | 'autoComplete'> & {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Shows the Weak / OK / Strong bar (new passwords only) */
  showStrength?: boolean;
  /** A refusal to show under the field */
  error?: string | null;
};

const STRENGTH: Record<Strength, { label: string; filled: number }> = {
  weak: { label: 'Weak', filled: 1 },
  ok: { label: 'OK', filled: 2 },
  strong: { label: 'Strong', filled: 3 },
};

/**
 * A password with an eye button instead of a "confirm password" field
 * (step-tracker-register.txt, section 2): you can see what you typed.
 */
export function PasswordField({
  label,
  value,
  onChangeText,
  showStrength = false,
  error,
  ...input
}: Props) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const strength = STRENGTH[passwordStrength(value)];
  const barColor = { weak: theme.danger, ok: '#E3A008', strong: '#2E9E5B' }[
    passwordStrength(value)
  ];

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={styles.row}>
        <TextField
          style={styles.flex}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={100}
          accessibilityLabel={label}
          {...input}
        />
        <Pressable
          onPress={() => setVisible(!visible)}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          hitSlop={Spacing.two}>
          <ThemedText type="linkPrimary">{visible ? 'Hide' : 'Show'}</ThemedText>
        </Pressable>
      </View>
      {showStrength && value.length > 0 && (
        <View
          style={styles.strength}
          accessible
          accessibilityLabel={`Password strength: ${strength.label}`}>
          <View style={styles.bars}>
            {[1, 2, 3].map((n) => (
              <View
                key={n}
                style={[
                  styles.bar,
                  { backgroundColor: n <= strength.filled ? barColor : theme.backgroundSelected },
                ]}
              />
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {strength.label}
          </ThemedText>
        </View>
      )}
      {error ? (
        <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
          {error}
        </ThemedText>
      ) : (
        showStrength && (
          <ThemedText type="small" themeColor="textSecondary">
            At least 8 characters. Longer is stronger.
          </ThemedText>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  flex: {
    flex: 1,
  },
  strength: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  bars: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.one,
  },
  bar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
});
