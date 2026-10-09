import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { loadPlayerProfile, type PlayerProfile } from '@/api/players';
import { Avatar } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import type { AvatarConfig } from '@/avatar/types';
import { ThemedButton } from '@/components/themed-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Walker } from '@/track/StepTrack';
import { getTheme, type MapTheme } from '@/track/themes';

const TILE_W = 512; // same sizes as StepTrack
const TILE_H = 160;
const ROAD_H = 48;
const LANDMARK_W = 128;
const LANDMARK_H = 144;
const AVATAR_SCALE = 3; // whole number keeps the pixels crisp
// Tall enough for the character (with headroom) and for a landmark on the road
const SCENE_H = Math.max(56 * AVATAR_SCALE + 18, ROAD_H + LANDMARK_H);
const ROAD_BASE = 6; // feet sit this far above the bottom, as on the map
const LOADING = '#e9e2d0'; // neutral while loading, so no wrong background flashes
const INK = '#2a1a1a';

// Movement in whole sprite pixels so the character stays on the pixel grid
const HOP = 6 * AVATAR_SCALE;
const BOB = AVATAR_SCALE;
const HOP_MS = 180;
const STEP_MS = 160; // the body rises a pixel every other frame
const WALK_SPEED = 60; // points per second the scenery slides past

type Loaded = { id: string; profile: PlayerProfile | null; failed: boolean };

/**
 * A profile card over the page, drawn in the OTHER person's map colors so
 * you can see what they have unlocked. Closes on the Close button, a tap
 * outside, or the Android back button.
 */
export function PlayerCard({
  walker,
  onClose,
  onEditMine,
}: {
  /** null = the card is closed */
  walker: Walker | null;
  onClose: () => void;
  /** Shown as "Edit profile" on your own card. */
  onEditMine?: () => void;
}) {
  const { width } = useWindowDimensions();
  // The answer remembers whose it is, so a late reply for someone tapped
  // earlier never shows on the wrong card.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const walkerId = walker?.id;

  // Read the username and chosen background each time a card opens;
  // nothing is cached, so a changed background shows next time.
  useEffect(() => {
    if (!walkerId) return;
    let cancelled = false;
    loadPlayerProfile(walkerId)
      .then((profile) => !cancelled && setLoaded({ id: walkerId, profile, failed: false }))
      .catch(() => !cancelled && setLoaded({ id: walkerId, profile: null, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [walkerId]);

  if (!walker) return null;

  const current = loaded?.id === walker.id ? loaded : null;
  const profile = current?.profile ?? null;
  const failed = Boolean(current?.failed);
  const ready = current !== null;

  // THEIR theme, not the viewer's; unknown ids fall back to the village
  const theme = getTheme(profile?.mapTheme);
  const ink = ready ? theme.ink : INK;
  const cardW = Math.min(width - 2 * Spacing.three, 360);
  const name = walker.isMe ? 'You' : profile?.displayName || walker.name;
  // Prefer the freshly loaded character; fall back to the map's copy
  const avatar = profile?.avatar ?? normalizeAvatar(walker.avatar);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* Dimmed backdrop: tap it to close */}
      <Pressable onPress={onClose} accessibilityLabel="Close profile" style={styles.backdrop}>
        {/* Taps on the card itself must not close it */}
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          style={[styles.card, { width: cardW, backgroundColor: ready ? theme.ground : LOADING }]}>
          {/* Their sky, their scenery, their character */}
          <View style={[styles.scene, { backgroundColor: ready ? theme.sky : LOADING }]}>
            {!ready ? (
              <ActivityIndicator color={INK} />
            ) : (
              <>
                <Scenery theme={theme} />
                <View style={styles.character}>
                  <WalkingCharacter
                    config={avatar}
                    label={`${name === 'You' ? 'Your' : `${name}'s`} character`}
                  />
                </View>
              </>
            )}
          </View>

          {/* Details, on their ground color */}
          <View style={styles.details}>
            <ThemedText type="subtitle" accessibilityRole="header" style={[styles.name, { color: ink }]}>
              {name}
            </ThemedText>
            {profile && <ThemedText style={{ color: ink }}>@{profile.username}</ThemedText>}
            <ThemedText style={{ color: ink }}>
              Today: {walker.steps.toLocaleString()} steps
            </ThemedText>
            {failed && (
              <ThemedText type="small" style={{ color: ink }}>
                Could not load the rest of this profile.
              </ThemedText>
            )}

            <View style={styles.buttons}>
              {walker.isMe && onEditMine && (
                <ThemedButton
                  theme={theme}
                  title="Edit profile"
                  onPress={() => {
                    onClose();
                    onEditMine();
                  }}
                />
              )}
              <ThemedButton theme={theme} title="Close" onPress={onClose} />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Their map sliding past from right to left, so the character looks like
 * it is walking to the right. Each landmark comes by on its own stretch of
 * street, then the whole trip starts over.
 */
function Scenery({ theme }: { theme: MapTheme }) {
  const stretch = theme.tiles.length * TILE_W; // one landmark per stretch
  const stretches = Math.max(1, theme.landmarks.length);
  const lap = stretches * stretch;
  const x = useSharedValue(0);

  useEffect(() => {
    // Slides even under Reduce Motion; Never stops Reanimated skipping it
    const never = ReduceMotion.Never;
    x.set(
      withRepeat(
        withTiming(-lap, { duration: (lap / WALK_SPEED) * 1000, easing: Easing.linear, reduceMotion: never }),
        -1,
        false,
        undefined,
        never
      )
    );
    return () => cancelAnimation(x);
  }, [lap, x]);

  // Whole points only, so the pixel art doesn't shimmer between pixels
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: Math.round(x.get()) }] }));

  // The trip is drawn twice, so when the first lap has slid out of view the
  // second looks exactly like the start and the jump back can't be seen.
  const tiles = Array.from({ length: 2 * stretches * theme.tiles.length }, (_, i) => theme.tiles[i % theme.tiles.length]);
  const landmarks = [...theme.landmarks, ...theme.landmarks];

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.strip, { width: 2 * lap }, style]}>
      <View style={styles.tiles}>
        {tiles.map((source, i) => (
          <Image key={i} source={source} style={{ width: TILE_W, height: TILE_H }} />
        ))}
      </View>
      {landmarks.map((l, i) => (
        <Image
          key={i}
          source={l.image}
          resizeMode="stretch"
          style={[
            styles.landmark,
            { left: (i + 0.5) * stretch - LANDMARK_W / 2, width: LANDMARK_W, height: LANDMARK_H },
          ]}
        />
      ))}
    </Animated.View>
  );
}

/**
 * Walks along with a little bounce for as long as the card is open, with a
 * hop when it opens. Tap it to hop again. With Reduce Motion on it still
 * walks and hops when tapped, but skips the hop on open.
 */
function WalkingCharacter({ config, label }: { config: AvatarConfig; label: string }) {
  const reducedMotion = useReducedMotion();
  const y = useSharedValue(0);
  const squash = useSharedValue(1); // 1 = normal; below 1 = flattened on landing

  // Counts 0 to 2 over and over: in the second half the body is a pixel up.
  // Whole frames, not a smooth sway, to match the pixel art.
  const walk = useSharedValue(0);
  const up = useDerivedValue(() => Math.floor(walk.get()) % 2 === 1);

  // A tap always hops. Reanimated would otherwise skip straight to the
  // end under Reduce Motion, so the hop itself opts out with Never.
  function hop() {
    const never = ReduceMotion.Never;
    y.set(
      withSequence(
        never,
        withTiming(-HOP, { duration: HOP_MS, easing: Easing.out(Easing.quad), reduceMotion: never }),
        withTiming(0, { duration: HOP_MS, easing: Easing.in(Easing.quad), reduceMotion: never })
      )
    );
    squash.set(
      withSequence(
        never,
        withDelay(2 * HOP_MS, withTiming(0.88, { duration: 70, reduceMotion: never }), never),
        withSpring(1, { damping: 6, stiffness: 300, reduceMotion: never })
      )
    );
  }

  useEffect(() => {
    // Walks even under Reduce Motion; Never stops Reanimated skipping it
    const never = ReduceMotion.Never;
    walk.set(
      withRepeat(
        withTiming(2, { duration: 2 * STEP_MS, easing: Easing.linear, reduceMotion: never }),
        -1,
        false,
        undefined,
        never
      )
    );
    if (!reducedMotion) hop();
    return () => {
      cancelAnimation(walk);
      cancelAnimation(y);
      cancelAnimation(squash);
    };
    // Only on open; hop() reads nothing that changes while the card is up
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: y.get() - (up.get() ? BOB : 0) },
      { scaleX: 2 - squash.get() },
      { scaleY: squash.get() },
    ],
  }));

  return (
    <Pressable onPress={hop} accessibilityRole="button" accessibilityHint="Makes the character jump">
      <Animated.View style={[styles.lively, style]}>
        <Avatar config={config} scale={AVATAR_SCALE} accessibilityLabel={label} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 12,
    borderWidth: 3,
    borderColor: INK,
    overflow: 'hidden',
  },
  scene: {
    height: SCENE_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
  tiles: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    flexDirection: 'row',
  },
  landmark: {
    position: 'absolute',
    bottom: ROAD_H, // stands on the road, as on the map
  },
  character: {
    position: 'absolute',
    bottom: ROAD_BASE,
  },
  lively: {
    transformOrigin: 'bottom', // squash toward the ground, not the middle
  },
  details: {
    padding: Spacing.three,
    gap: Spacing.one,
  },
  name: {
    fontSize: 24,
    lineHeight: 30,
  },
  buttons: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
});
