import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { type ReactNode, useCallback, useState } from 'react';
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useMapTheme } from '@/hooks/use-map-theme';
import { FrontLayer, SkyLayer, useAmbientClock } from '@/track/ambient';
import { centerFor, LANDMARK_EVERY, ROAD_PAD, tileIndex } from '@/track/scale';
import { LANDMARK_H, LANDMARK_W, ROAD_H, TILE_H, TILE_W } from '@/track/sizes';

const SCENE_H = 192; // lit maps: the sky's depth strips start above the tiles
const P = 2; // points per drawing pixel (shadow boxes are in drawing pixels)
// The last page's header height, so a page opening for the first time
// draws its sky in place instead of jumping once it's measured
let lastAbove = 0;

/** A fixed strip of the map's scenery at full height (as on Today), no characters. */
function SceneryBand({ height }: { height: number }) {
  const { theme } = useMapTheme();
  const { width } = useWindowDimensions();
  const scenery = theme.scenery;
  // Lit maps leave a clearing at each tile's ends for a landmark, so lay
  // them out as Today does, with the start (and any landmark in view)
  // standing in its clearing. Other maps lay tiles end to end.
  const tiles = scenery
    ? Array.from({ length: Math.ceil((width - ROAD_PAD) / LANDMARK_EVERY) + 1 }, (_, i) => {
        const left = ROAD_PAD + (i - 1) * LANDMARK_EVERY;
        return { left, index: tileIndex(left, i + 1) };
      })
    : Array.from({ length: Math.ceil(width / TILE_W) }, (_, i) => {
        const left = i * TILE_W;
        return { left, index: tileIndex(left, i) };
      });
  const landmarks = scenery
    ? theme.landmarks
        .map((l, index) => ({ ...l, index, left: centerFor(l.steps) - LANDMARK_W / 2 }))
        .filter((l) => l.left < width)
    : [];
  return (
    <View
      style={[styles.band, { height }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <View style={styles.tiles}>
        {tiles.map((t) => (
          <Image
            key={t.left}
            source={theme.tiles[t.index]}
            style={{ position: 'absolute', left: t.left, width: TILE_W, height: TILE_H }}
          />
        ))}
      </View>
      {landmarks.map((l) => {
        const box = scenery?.shadowBoxes[l.index];
        const shadow = scenery?.landmarkShadows[l.index];
        return box && shadow ? (
          <Image
            key={`shadow-${l.steps}`}
            source={shadow}
            resizeMode="stretch"
            style={[styles.shadow, { left: l.left + box.left * P, width: box.width * P }]}
          />
        ) : null;
      })}
      {landmarks.map((l) => (
        <Image
          key={l.steps}
          source={l.image}
          resizeMode="stretch"
          style={[styles.landmark, { left: l.left }]}
        />
      ))}
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
  /**
   * Under a see-through native header: the title sits level with the back
   * button and clear of it, so the scenery lines up with the tabs'.
   */
  hasHeader?: boolean;
  /** false = sky header only, no strip of scenery. */
  scenery?: boolean;
};

/**
 * The page background shared with Today: the map's sky from the top of
 * the screen with the title on it, a strip of the user's map scenery,
 * then the ground color down to the bottom with the page's content
 * scrolling on it.
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

  // Lit maps: the sky picture, and what moves in it, runs up behind the
  // title as on Today; `above` is the title's height
  const lit = scenery ? theme.scenery : undefined;
  const { width } = useWindowDimensions();
  const clock = useAmbientClock();
  const scrollX = useSharedValue(0);
  const [above, setAbove] = useState(lastAbove);

  return (
    <View style={[styles.screen, { backgroundColor: theme.ground }]}>
      <View style={{ backgroundColor: theme.sky }}>
        {lit && <SkyLayer scenery={lit} clock={clock} scrollX={scrollX} viewport={width} above={above} />}
        <View
          onLayout={(e) => {
            lastAbove = e.nativeEvent.layout.height;
            setAbove(lastAbove);
          }}
          style={{ paddingTop: insets.top }}>
          {/* An empty title (still loading) keeps its line, so nothing jumps */}
          {(title !== undefined || subtitle) && (
            <View style={[styles.header, hasHeader && styles.underHeader]}>
              <View style={styles.inner}>
                {title !== undefined && (
                  <ThemedText
                    type="subtitle"
                    accessibilityRole="header"
                    numberOfLines={hasHeader ? 1 : undefined}
                    style={skyText}>
                    {title || ' '}
                  </ThemedText>
                )}
                {subtitle && <ThemedText style={skyText}>{subtitle}</ThemedText>}
              </View>
            </View>
          )}
        </View>
        {scenery && <SceneryBand height={lit ? SCENE_H : TILE_H} />}
        {lit && <FrontLayer scenery={lit} clock={clock} viewport={width} above={above} />}
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
  underHeader: {
    paddingHorizontal: Spacing.six, // clear of the back button
  },
  band: {
    overflow: 'hidden', // wide tiles past the screen edge
  },
  tiles: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: TILE_H,
  },
  landmark: {
    position: 'absolute',
    bottom: ROAD_H, // sits on top of the road
    width: LANDMARK_W,
    height: LANDMARK_H,
  },
  shadow: {
    position: 'absolute',
    bottom: 0, // covers the road, from its top line down
    height: ROAD_H,
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
