import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
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

import { Avatar, PixelSprite } from '@/avatar/Avatar';
import { usePetEdge } from '@/avatar/pet-spot';
import { findPet, type Pet, PET_SIZE } from '@/avatar/pets';
import type { AvatarConfig } from '@/avatar/types';
import type { MapTheme } from '@/track/themes';

const TILE_W = 512; // same sizes as StepTrack
const TILE_H = 160;
const ROAD_H = 48;
const LANDMARK_W = 128;
const LANDMARK_H = 144;
const ROAD_BASE = 6; // feet sit this far above the bottom, as on the map
const HOP_MS = 180;
const STEP_MS = 160; // the body rises a pixel every other frame
const WALK_SPEED = 60; // points per second the scenery slides past

/** Tall enough for the character (with headroom) and a landmark on the road. */
export function sceneHeight(scale: number) {
  return Math.max(56 * scale + 18, ROAD_H + LANDMARK_H);
}

/**
 * A character (and their pet) walking to the right through a map that
 * slides past: the player card and the character editor's preview.
 */
export function WalkingScene({
  theme,
  avatar,
  label,
  width,
  scale = 3,
}: {
  theme: MapTheme;
  avatar: AvatarConfig;
  /** Read by screen readers, e.g. "Sam's character". */
  label: string;
  width: number;
  /** Whole number, like Avatar. */
  scale?: number;
}) {
  const pet = findPet(avatar.pet);
  // The character is centered. Whole points, so an odd screen width can't
  // put the pixel art between screen pixels.
  const spriteLeft = Math.round((width - 32 * scale) / 2); // sprite is 32 wide
  // The pet walks just behind the character, and further back when a
  // cape, wings or long hair would cover it (measured from the art).
  const petEdge = usePetEdge(avatar);
  const petLeft = spriteLeft + ((petEdge ?? 0) - PET_SIZE) * scale;

  return (
    <View style={[styles.scene, { width, height: sceneHeight(scale), backgroundColor: theme.sky }]}>
      <Scenery theme={theme} />
      {pet && petEdge !== null && (
        // The character's sprite has one empty row under the feet; the pet's doesn't
        <View style={[styles.pet, { left: petLeft, bottom: ROAD_BASE + scale }]}>
          <WalkingPet pet={pet} scale={scale} />
        </View>
      )}
      <View style={[styles.character, { left: spriteLeft }]}>
        <WalkingCharacter config={avatar} label={label} scale={scale} />
      </View>
    </View>
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

/** The pet's two walk frames, swapped each step; it walks even under Reduce Motion. */
function WalkingPet({ pet, scale }: { pet: Pet; scale: number }) {
  const walk = useSharedValue(0);
  const second = useDerivedValue(() => Math.floor(walk.get()) % 2 === 1);

  useEffect(() => {
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
    return () => cancelAnimation(walk);
  }, [walk]);

  const showA = useAnimatedStyle(() => ({ opacity: second.get() ? 0 : 1 }));
  const showB = useAnimatedStyle(() => ({ opacity: second.get() ? 1 : 0 }));
  const size = PET_SIZE * scale;

  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={pet.label}>
      <Animated.View style={[StyleSheet.absoluteFill, showA]}>
        <PixelSprite source={pet.frames[0]} width={PET_SIZE} height={PET_SIZE} scale={scale} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, showB]}>
        <PixelSprite source={pet.frames[1]} width={PET_SIZE} height={PET_SIZE} scale={scale} />
      </Animated.View>
    </View>
  );
}

/**
 * Walks along with a little bounce for as long as it is on screen, with a
 * hop when it appears. Tap it to hop again. With Reduce Motion on it still
 * walks and hops when tapped, but skips the hop on appearing.
 */
function WalkingCharacter({
  config,
  label,
  scale,
}: {
  config: AvatarConfig;
  label: string;
  scale: number;
}) {
  // Movement in whole sprite pixels so the character stays on the pixel grid
  const hopHeight = 6 * scale;
  const bob = scale;
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
        withTiming(-hopHeight, { duration: HOP_MS, easing: Easing.out(Easing.quad), reduceMotion: never }),
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
    // Only on appearing; hop() reads nothing that changes afterwards
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: y.get() - (up.get() ? bob : 0) },
      { scaleX: 2 - squash.get() },
      { scaleY: squash.get() },
    ],
  }));

  return (
    <Pressable onPress={hop} accessibilityRole="button" accessibilityHint="Makes the character jump">
      <Animated.View style={[styles.lively, style]}>
        <Avatar config={config} scale={scale} accessibilityLabel={label} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scene: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
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
  pet: {
    position: 'absolute',
  },
  lively: {
    transformOrigin: 'bottom', // squash toward the ground, not the middle
  },
});
