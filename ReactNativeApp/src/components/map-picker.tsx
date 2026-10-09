import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedButton } from '@/components/themed-button';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/ui/section';
import { Spacing } from '@/constants/theme';
import { useMapTheme } from '@/hooks/use-map-theme';
import { THEME_LIST } from '@/track/themes';

/** Choose the map drawn behind every page. Paid maps unlock in the Shop. */
export function MapPicker() {
  const router = useRouter();
  const { theme, canUse, pickTheme } = useMapTheme();
  const anyLocked = THEME_LIST.some((t) => !canUse(t.id));

  return (
    <Section title="Background">
      <View style={styles.wrap}>
        {THEME_LIST.map((t) => (
          <View key={t.id} style={styles.option}>
            {/* Small preview of the map's two colors */}
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={[styles.swatch, { opacity: canUse(t.id) ? 1 : 0.45 }]}>
              <View style={{ flex: 3, backgroundColor: t.sky }} />
              <View style={{ flex: 2, backgroundColor: t.ground }} />
            </View>
            <ThemedButton
              theme={theme}
              title={canUse(t.id) ? t.label : `${t.label} (locked)`}
              selected={t.id === theme.id}
              disabled={!canUse(t.id)}
              onPress={() => pickTheme(t.id)}
            />
          </View>
        ))}
      </View>
      {anyLocked && (
        <View style={styles.locked}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.lockedText}>
            Locked backgrounds are sold in the shop for coins.
          </ThemedText>
          <ThemedButton theme={theme} title="Open shop" onPress={() => router.push('/shop')} />
        </View>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  option: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  swatch: {
    width: 64,
    height: 40,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#2a1a1a',
  },
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  lockedText: {
    flex: 1,
  },
});
