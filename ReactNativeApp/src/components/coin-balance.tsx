import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** Small coin badge. Swap the circle for a pixel-art coin sprite later. */
export function CoinBalance({ balance, color }: { balance: number | null; color?: string }) {
  const label = balance === null ? '…' : balance.toLocaleString();
  return (
    <View
      accessible
      accessibilityLabel={balance === null ? 'Loading coins' : `${balance} coins`}
      style={styles.row}>
      <View style={styles.coin} />
      <ThemedText type="smallBold" style={[styles.num, color ? { color } : null]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
  },
  coin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#f7c948',
    borderWidth: 2,
    borderColor: '#3a2a2a',
  },
  num: {
    fontVariant: ['tabular-nums'],
  },
});
