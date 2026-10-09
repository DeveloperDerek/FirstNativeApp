import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import type { MapTheme } from '@/track/themes';

const OUTLINE = '#2a1a1a';
const DANGER = '#b3261e';

type ThemedButtonProps = {
  title: string;
  onPress: () => void;
  theme: MapTheme;
  disabled?: boolean;
  /** For "which mode / map is active": swaps the two colors. */
  selected?: boolean;
  /** Destructive actions stay red on every map. */
  danger?: boolean;
  loading?: boolean;
  size?: 'large' | 'small';
};

/**
 * A raised, pixel-style button in the map's strong color: dark outline
 * and a thick bottom edge that "pushes down" on tap. React Native's
 * built-in <Button> can't be styled the same way on both platforms.
 */
export function ThemedButton({
  title,
  onPress,
  theme,
  disabled = false,
  selected = false,
  danger = false,
  loading = false,
  size = 'small',
}: ThemedButtonProps) {
  const base = danger ? DANGER : theme.button;
  const text = danger ? '#ffffff' : theme.buttonText;
  const bg = selected ? text : base;
  const fg = selected ? base : text;
  const inactive = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, selected, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        size === 'large' ? styles.large : styles.small,
        {
          backgroundColor: bg,
          borderBottomWidth: pressed ? 2 : 5,
          marginTop: pressed ? 3 : 0,
          opacity: disabled ? 0.45 : 1,
        },
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.text, { color: fg }]} numberOfLines={1}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderColor: OUTLINE,
    borderWidth: 2,
    borderRadius: 6,
  },
  small: {
    minHeight: 44, // comfortable tap target
  },
  large: {
    minHeight: 52,
  },
  text: {
    fontWeight: 'bold',
    fontSize: 14,
  },
});
