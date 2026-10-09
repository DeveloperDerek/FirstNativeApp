import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { type ReactNode, useCallback } from 'react';
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useMapTheme } from '@/hooks/use-map-theme';

const TILE_W = 512; // same sizes as StepTrack
const TILE_H = 160;

/** A fixed strip of the map's scenery at full height (as on Today), no characters. */
function SceneryBand() {
  const { theme } = useMapTheme();
  const { width } = useWindowDimensions();
  const count = Math.ceil(width / TILE_W);
  return (
    <View
      style={styles.band}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <View style={styles.tiles}>
        {Array.from({ length: count }, (_, i) => (
          <Image
            key={i}
            source={theme.tiles[i % theme.tiles.length]}
            style={{ width: TILE_W, height: TILE_H }}
          />
        ))}
      </View>
    </View>
  );
}

type ScreenProps = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Shows pull-to-refresh when provided. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Tab screens leave room for the tab bar; pushed screens and modals don't. */
  inTabs?: boolean;
  /** Screens under a native header don't need to pad for the status bar. */
  hasHeader?: boolean;
  /** false = sky header only, no strip of scenery. */
  scenery?: boolean;
};

/**
 * The page background shared with Today: sky color from the top of the
 * screen, a strip of the user's map scenery, then the ground color down
 * to the bottom with the page's content scrolling on it.
 */
export function Screen({
  title,
  subtitle,
  children,
  onRefresh,
  refreshing = false,
  inTabs = true,
  hasHeader = false,
  scenery = true,
}: ScreenProps) {
  const { theme } = useMapTheme();
  const insets = useSafeAreaInsets();

  // Status bar text that reads on this map's sky while the page is visible
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(theme.statusBar);
      return () => setStatusBarStyle('auto');
    }, [theme.statusBar])
  );
  const skyText = { color: theme.skyInk };

  return (
    <View style={[styles.screen, { backgroundColor: theme.ground }]}>
      <View style={{ backgroundColor: theme.sky, paddingTop: hasHeader ? 0 : insets.top }}>
        {(title || subtitle) && (
          <View style={styles.header}>
            <View style={styles.inner}>
              {title && (
                <ThemedText type="subtitle" accessibilityRole="header" style={skyText}>
                  {title}
                </ThemedText>
              )}
              {subtitle && <ThemedText style={skyText}>{subtitle}</ThemedText>}
            </View>
          </View>
        )}
        {scenery && <SceneryBand />}
      </View>

      <ScrollView
        style={styles.screen}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.ink} />
          ) : undefined
        }
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + (inTabs ? BottomTabInset : 0) + Spacing.three },
        ]}>
        <View style={styles.inner}>{children}</View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  band: {
    height: TILE_H,
    overflow: 'hidden', // wide tiles past the screen edge
  },
  tiles: {
    position: 'absolute',
    bottom: 0,
    flexDirection: 'row',
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  inner: {
    flex: 1,
    maxWidth: MaxContentWidth,
    gap: Spacing.two,
  },
});
