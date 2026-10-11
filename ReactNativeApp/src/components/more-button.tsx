import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** A "..." button that opens a menu of choices about someone. */
export function MoreButton({ onPress, color }: { onPress: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="More options"
      hitSlop={Spacing.two}
      style={styles.button}>
      <ThemedText type="smallBold" style={color ? { color } : undefined}>
        •••
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
  },
});
