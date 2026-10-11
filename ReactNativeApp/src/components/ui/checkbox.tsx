import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A tick box with its label beside it. Never pre-ticked by callers. */
export function Checkbox({
  checked,
  onChange,
  accessibilityLabel,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  accessibilityLabel: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onChange(!checked)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={accessibilityLabel}
        hitSlop={Spacing.two}
        style={[
          styles.box,
          { borderColor: theme.textSecondary },
          checked && {
            backgroundColor: theme.accent,
            borderColor: theme.accent,
          },
        ]}>
        {checked && <ThemedText style={styles.tick}>✓</ThemedText>}
      </Pressable>
      <View style={styles.label}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  box: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 20,
  },
  label: {
    flex: 1,
  },
});
