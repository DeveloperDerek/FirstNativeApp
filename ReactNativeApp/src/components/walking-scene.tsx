import { Canvas, Group, Rect } from '@shopify/react-native-skia';
import { useIsFocused } from 'expo-router';
import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { PixelSprite } from '@/avatar/Avatar';
import { type PetEdges, usePetEdge } from '@/avatar/pet-spot';
import { findPet, type Pet, PET_SIZE } from '@/avatar/pets';
import type { AvatarConfig } from '@/avatar/types';
import { WALK_FRAMES, WalkingAvatar } from '@/avatar/WalkingAvatar';
import type { MapTheme } from '@/track/themes';

const TILE_W = 512; // same sizes as StepTrack
const TILE_H = 160;
const ROAD_H = 48;
const LANDMARK_W = 128;
const LANDMARK_H = 144;
const ROAD_BASE = 6; // feet sit this far above the bottom, as on the map
const SPRITE_W = 32; // the character's sprite, in sprite pixels
const SPRITE_H = 56;
const HOP_MS = 180;
const STEP_MS = 160; // one frame of the walk
// Sprite pixels the ground moves each frame, so the feet don't slide
const STEP_PX = 3;
const SHADOW = 'rgba(0, 0, 0, 0.2)';
const DUST = 'rgba(255, 255, 255, 0.75)';
const DUST_S = 0.32; // seconds a puff lasts
const EMOTE_S = 1.6;
// Wandering, in seconds: how long it walks, then stands
const WALK_FOR = [2, 6];
const STAND_FOR = [1.5, 4];

/** Tall enough for the character (with headroom) and a landmark on the road. */
export function sceneHeight(scale: number) {
  return Math.max(56 * scale + 18, ROAD_H + LANDMARK_H);
}

/**
 * A character (and their pet) in their map, Stardew-style. With `wander`
 * they stroll back and forth, stop to look around and blink, and the map
 * follows them when they near an edge (the player card, Profile). Without
 * it they walk on the spot to the right while the map slides past (the
 * character editor's preview), as they also do under Reduce Motion.
 */
export function WalkingScene({
  theme,
  avatar,
  label,
  width,
  scale = 3,
  wander = false,
}: {
  theme: MapTheme;
  avatar: AvatarConfig;
  /** Read by screen readers, e.g. "Sam's character". */
  label: string;
  width: number;
  /** Whole number, like Avatar. */
  scale?: number;
  wander?: boolean;
}) {
  const pet = findPet(avatar.pet);
  // The pet walks just behind the character, and further back when a
  // cape, wings, long hair or a held item would cover it (measured from the art)
  const petEdges = usePetEdge(avatar);
  const reducedMotion = useReducedMotion();
  const walker = useWalker({ width, scale, wander: wander && !reducedMotion, petEdges });
  const height = sceneHeight(scale);

  return (
    <View style={[styles.scene, { width, height, backgroundColor: theme.sky }]}>
      <Scenery theme={theme} cam={walker.cam} />
      {pet && petEdges !== null && <WalkingPet pet={pet} scale={scale} walker={walker} />}
      <Dust walker={walker} scale={scale} />
      <Shadow x={walker.x} y={walker.hopY} scale={scale} width={14} />
      <WalkingCharacter config={avatar} label={label} scale={scale} walker={walker} />
      <Emote walker={walker} scale={scale} sceneH={height} />
    </View>
  );
}

// ---------------------------------------------------------------- the walker

type Walker = ReturnType<typeof useWalker>;

/**
 * Where everyone is, run a frame at a time on the UI thread: the
 * character's position (screen points), the camera, the walk frame,
 * where the eyes look and when they blink, the pet, dust and emotes.
 */
function useWalker({
  width,
  scale,
  wander,
  petEdges,
}: {
  width: number;
  scale: number;
  wander: boolean;
  petEdges: PetEdges | null;
}) {
  const spriteW = SPRITE_W * scale;
  const petW = PET_SIZE * scale;
  const stride = STEP_PX * scale; // points per walk frame
  const speed = stride / (STEP_MS / 1000);
  const center = Math.round((width - spriteW) / 2);
  // The character walks freely inside this band, with room for the pet
  // either side; past it the camera follows instead
  let bandL = petW + 8;
  let bandR = width - spriteW - petW - 8;
  if (bandL > bandR) bandL = bandR = center;
  const edges = petEdges ?? { left: 0, right: 0 };
  const behindR = (edges.left - PET_SIZE) * scale; // pet's left, walking right
  const behindL = edges.right * scale; // walking left

  // Outputs, read by the views
  const x = useSharedValue(center); // character's left edge on screen
  const cam = useSharedValue(0); // how far along the map the view is
  const frame = useSharedValue(0);
  const look = useSharedValue(0);
  const blink = useSharedValue(0);
  const petX = useSharedValue(center + behindR);
  const petFlip = useSharedValue(1); // -1 when walking left
  const petFrame = useSharedValue(0);
  const dust = useSharedValue([
    { x: 0, age: DUST_S },
    { x: 0, age: DUST_S },
  ]);
  const emote = useSharedValue({ icon: 0, left: 0 });
  const hopY = useSharedValue(0);
  const squash = useSharedValue(1); // 1 = normal; below 1 = flattened on landing

  // Inner state, in map points
  const state = useSharedValue({
    walking: true,
    dir: 1,
    left: wander ? 3 : Infinity, // seconds until it stops or starts
    x: center, // character's left edge on the map
    cam: 0,
    walked: 0,
    look: 0,
    nextLook: 0,
    nextBlink: 2,
    shut: 0,
    petX: center + behindR,
    petDir: 1,
    petMoving: false,
    petWalked: 0,
    puff: 0,
  });

  const frames = useFrameCallback((info) => {
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 0) / 1000);
    state.modify((s) => {
      'worklet';
      // Stroll, then stand a while; mostly onward, sometimes back. On
      // the spot, always onward.
      s.left -= dt;
      if (!wander) {
        s.walking = true;
        s.dir = 1;
      } else if (s.left <= 0) {
        s.walking = !s.walking;
        if (s.walking) {
          s.dir = Math.random() < 0.7 ? 1 : -1;
          s.left = WALK_FOR[0] + Math.random() * (WALK_FOR[1] - WALK_FOR[0]);
        } else {
          s.left = STAND_FOR[0] + Math.random() * (STAND_FOR[1] - STAND_FOR[0]);
          s.nextLook = 0.5;
          if (Math.random() < 0.2) emote.set({ icon: 1 + Math.floor(Math.random() * EMOTES.length), left: EMOTE_S });
        }
      }

      const before = Math.floor(s.walked / stride);
      if (s.walking) {
        s.x += s.dir * speed * dt;
        s.walked += speed * dt;
      }
      const step = Math.floor(s.walked / stride);
      const f = s.walking ? step % WALK_FRAMES : 0;
      // A foot comes down (onto a stand frame): now and then a puff of
      // dust at its heel
      if (step !== before && f % 2 === 0 && Math.random() < 0.4) {
        const foot = f === 0 ? 10 : 16; // left foot's columns 10-15, right 16-21
        const heel = s.dir > 0 ? foot - 2 : foot + 6;
        s.puff = 1 - s.puff;
        const puffs = [...dust.get()];
        puffs[s.puff] = { x: s.x + heel * scale, age: 0 };
        dust.set(puffs);
      }

      // The camera: on the spot it keeps them centered; wandering, it
      // moves only when they would leave the band
      if (!wander) s.cam = s.x - center;
      else if (s.x - s.cam > bandR) s.cam = s.x - bandR;
      else if (s.x - s.cam < bandL) s.cam = s.x - bandL;

      // Eyes ahead while walking; standing, they look around
      if (!wander) s.look = 0;
      else if (s.walking) s.look = s.dir;
      else {
        s.nextLook -= dt;
        if (s.nextLook <= 0) {
          s.look = Math.floor(Math.random() * 3) - 1;
          s.nextLook = 0.8 + Math.random() * 1.4;
        }
      }
      s.nextBlink -= dt;
      if (s.nextBlink <= 0) {
        s.shut = 0.12;
        s.nextBlink = 2 + Math.random() * 3;
      }
      s.shut = Math.max(0, s.shut - dt);

      // The pet heads for its spot behind them, once it has fallen a
      // little behind, and hurries when it is far
      const target = s.x + (s.dir > 0 ? behindR : behindL);
      const gap = target - s.petX;
      if (!s.petMoving && Math.abs(gap) > 3 * scale) s.petMoving = true;
      if (s.petMoving) {
        const move = Math.min(Math.abs(gap), speed * (Math.abs(gap) > 6 * scale ? 1.3 : 1) * dt);
        s.petX += Math.sign(gap) * move;
        s.petWalked += move;
        s.petDir = gap < 0 ? -1 : 1;
        if (Math.abs(gap) < 0.5) {
          s.petX = target;
          s.petMoving = false;
        }
      }
      return s;
    });

    // Set only what changed, so nothing redraws for nothing. Written out
    // (no little helper functions): the React Compiler hoists those out
    // of the worklet, and the UI thread can't call them.
    const s = state.get();
    const nx = Math.round(s.x - s.cam);
    if (x.get() !== nx) x.set(nx);
    const ncam = Math.round(s.cam);
    if (cam.get() !== ncam) cam.set(ncam);
    const nframe = s.walking ? Math.floor(s.walked / stride) % WALK_FRAMES : 0;
    if (frame.get() !== nframe) frame.set(nframe);
    if (look.get() !== s.look) look.set(s.look);
    const nblink = s.shut > 0 ? 1 : 0;
    if (blink.get() !== nblink) blink.set(nblink);
    const npet = Math.round(s.petX - s.cam);
    if (petX.get() !== npet) petX.set(npet);
    if (petFlip.get() !== s.petDir) petFlip.set(s.petDir);
    const npetFrame = s.petMoving ? Math.floor(s.petWalked / stride) % 2 : 0;
    if (petFrame.get() !== npetFrame) petFrame.set(npetFrame);
    const puffs = dust.get();
    if (puffs[0].age < DUST_S || puffs[1].age < DUST_S) {
      dust.set([
        { x: puffs[0].x, age: puffs[0].age + dt },
        { x: puffs[1].x, age: puffs[1].age + dt },
      ]);
    }
    const e = emote.get();
    if (e.left > 0) emote.set({ icon: e.left - dt > 0 ? e.icon : 0, left: e.left - dt });
  }, false);

  // Only while the page is showing
  const focused = useIsFocused();
  useEffect(() => {
    frames.setActive(focused);
  }, [frames, focused]);

  return { x, cam, frame, look, blink, petX, petFlip, petFrame, dust, emote, hopY, squash };
}

// ---------------------------------------------------------------- the scenery

/**
 * Their map: the camera's position slides it past. Each landmark comes
 * by on its own stretch of street, then the whole trip starts over.
 */
function Scenery({ theme, cam }: { theme: MapTheme; cam: SharedValue<number> }) {
  const stretch = theme.tiles.length * TILE_W; // one landmark per stretch
  const stretches = Math.max(1, theme.landmarks.length);
  const lap = stretches * stretch;

  // Whole points only, so the pixel art doesn't shimmer between pixels.
  // The trip is drawn twice, so wrapping a lap back can't be seen.
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -((((cam.get() % lap) + lap) % lap) | 0) }],
  }));

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

// ---------------------------------------------------------------- the character

/**
 * Walks, with a hop when it appears. Tap it to hop and show an emote.
 * With Reduce Motion on it still walks and hops when tapped, but skips
 * the hop on appearing.
 */
function WalkingCharacter({
  config,
  label,
  scale,
  walker,
}: {
  config: AvatarConfig;
  label: string;
  scale: number;
  walker: Walker;
}) {
  const { hopY, squash, emote } = walker;
  // Movement in whole sprite pixels so the character stays on the pixel grid
  const hopHeight = 6 * scale;
  const reducedMotion = useReducedMotion();

  // A tap always hops. Reanimated would otherwise skip straight to the
  // end under Reduce Motion, so the hop itself opts out with Never.
  function hop() {
    const never = ReduceMotion.Never;
    hopY.set(
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

  function tap() {
    hop();
    emote.set({ icon: 1 + Math.floor(Math.random() * EMOTES.length), left: EMOTE_S });
  }

  useEffect(() => {
    if (!reducedMotion) hop();
    return () => {
      cancelAnimation(hopY);
      cancelAnimation(squash);
    };
    // Only on appearing; hop() reads nothing that changes afterwards
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const place = useAnimatedStyle(() => ({ transform: [{ translateX: walker.x.get() }] }));
  const lively = useAnimatedStyle(() => ({
    transform: [
      { translateY: Math.round(hopY.get() / scale) * scale },
      { scaleX: 2 - squash.get() },
      { scaleY: squash.get() },
    ],
  }));

  return (
    <Animated.View style={[styles.character, place]}>
      <Pressable onPress={tap} accessibilityRole="button" accessibilityHint="Makes the character jump">
        <Animated.View style={[styles.lively, lively]}>
          <WalkingAvatar
            config={config}
            pose={{ frame: walker.frame, look: walker.look, blink: walker.blink }}
            scale={scale}
            accessibilityLabel={label}
          />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A pixel oval on the ground under someone, `width` sprite pixels wide
 * (centered on a 32-pixel sprite), smaller while they are in the air.
 */
function Shadow({
  x,
  y,
  scale,
  width,
  sprite = SPRITE_W,
  bottom = ROAD_BASE - scale,
}: {
  x: SharedValue<number>;
  y?: SharedValue<number>;
  scale: number;
  width: number;
  sprite?: number;
  bottom?: number;
}) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const ground = useAnimatedStyle(() => ({ opacity: y && y.get() < -2 * scale ? 0 : 1 }));
  const air = useAnimatedStyle(() => ({ opacity: y && y.get() < -2 * scale ? 1 : 0 }));
  const oval = (w: number) =>
    [w - 4, w, w - 4].map((rowW, i) => (
      <View
        key={i}
        style={{
          position: 'absolute',
          top: i * scale,
          left: ((sprite - rowW) / 2) * scale,
          width: rowW * scale,
          height: scale,
          backgroundColor: SHADOW,
        }}
      />
    ));
  return (
    <Animated.View pointerEvents="none" style={[styles.shadow, { bottom, width: sprite * scale, height: 3 * scale }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, ground]}>{oval(width)}</Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, air]}>{oval(width - 4)}</Animated.View>
    </Animated.View>
  );
}

/** Puffs of dust at the heels, left where the foot came down. */
function Dust({ walker, scale }: { walker: Walker; scale: number }) {
  return [0, 1].map((i) => <Puff key={i} index={i} walker={walker} scale={scale} />);
}

function Puff({ index, walker, scale }: { index: number; walker: Walker; scale: number }) {
  const style = useAnimatedStyle(() => {
    const p = walker.dust.get()[index];
    const young = p.age < DUST_S / 2;
    return {
      opacity: p.age >= DUST_S ? 0 : young ? 1 : 0.5,
      transform: [
        { translateX: Math.round(p.x - walker.cam.get()) },
        { translateY: young ? 0 : -scale }, // drifts up a pixel as it fades
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.puff, { bottom: ROAD_BASE + scale, width: 2 * scale, height: 2 * scale }, style]}
    />
  );
}

// ---------------------------------------------------------------- emotes

// Drawn in a speech bubble, 8 x 6 each: K dark, R red
const EMOTES = [
  [' RR  RR ', 'RRRRRRRR', 'RRRRRRRR', ' RRRRRR ', '  RRRR  ', '   RR   '], // heart
  ['   KK   ', '   KK   ', '   KK   ', '   KK   ', '        ', '   KK   '], // !
  ['  KKKK  ', ' KK  KK ', '     KK ', '   KK   ', '        ', '   KK   '], // ?
  ['   KK   ', '   K K  ', '   K  K ', '   K    ', ' KKK    ', ' KKK    '], // a note
];
const INK = { O: '#3a2a2a', W: '#ffffff', K: '#3a2a2a', R: '#e8506a' } as const;

/** Each emote in its bubble, as rows of pixels; a tail at the bottom left. */
const BUBBLES = EMOTES.map((icon) => [
  '..OOOOOOOO..',
  '.OWWWWWWWWO.',
  ...icon.map((row) => `OW${row.replace(/ /g, 'W')}WO`),
  '.OWWWWWWWWO.',
  '..OOOWWOOOO.',
  '....OO......',
]);
const BUBBLE_W = 12;
const BUBBLE_H = BUBBLES[0].length;

/** The emote bubble over their head, top right as in Stardew. */
function Emote({ walker, scale, sceneH }: { walker: Walker; scale: number; sceneH: number }) {
  // Its bottom on the row just over the head
  const spriteTop = sceneH - ROAD_BASE - SPRITE_H * scale;
  const top = spriteTop + (9 - BUBBLE_H) * scale;
  const style = useAnimatedStyle(() => ({
    opacity: walker.emote.get().left > 0 ? 1 : 0,
    transform: [{ translateX: walker.x.get() + 20 * scale }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.emote, { top }, style]}>
      <Canvas style={{ width: BUBBLE_W * scale, height: BUBBLE_H * scale }}>
        {BUBBLES.map((rows, i) => (
          <Bubble key={i} rows={rows} icon={i + 1} emote={walker.emote} scale={scale} />
        ))}
      </Canvas>
    </Animated.View>
  );
}

function Bubble({
  rows,
  icon,
  emote,
  scale,
}: {
  rows: string[];
  icon: number;
  emote: Walker['emote'];
  scale: number;
}) {
  const opacity = useDerivedValue(() => (emote.get().icon === icon ? 1 : 0));
  return (
    <Group opacity={opacity}>
      {rows.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === '.' ? null : (
            <Rect
              key={`${x},${y}`}
              x={x * scale}
              y={y * scale}
              width={scale}
              height={scale}
              color={INK[c as keyof typeof INK]}
            />
          )
        )
      )}
    </Group>
  );
}

// ---------------------------------------------------------------- the pet

/** The pet's two walk frames, swapped as it walks; mirrored walking left. */
function WalkingPet({ pet, scale, walker }: { pet: Pet; scale: number; walker: Walker }) {
  const second = useDerivedValue(() => walker.petFrame.get() === 1);
  const showA = useAnimatedStyle(() => ({ opacity: second.get() ? 0 : 1 }));
  const showB = useAnimatedStyle(() => ({ opacity: second.get() ? 1 : 0 }));
  const place = useAnimatedStyle(() => ({
    transform: [{ translateX: walker.petX.get() }, { scaleX: walker.petFlip.get() }],
  }));
  const size = PET_SIZE * scale;

  return (
    <>
      <Shadow x={walker.petX} scale={scale} width={12} sprite={PET_SIZE} />
      <Animated.View
        style={[styles.pet, { bottom: ROAD_BASE + scale, width: size, height: size }, place]}
        accessible
        accessibilityLabel={pet.label}>
        <Animated.View style={[StyleSheet.absoluteFill, showA]}>
          <PixelSprite source={pet.frames[0]} width={PET_SIZE} height={PET_SIZE} scale={scale} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, showB]}>
          <PixelSprite source={pet.frames[1]} width={PET_SIZE} height={PET_SIZE} scale={scale} />
        </Animated.View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  scene: {
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
    left: 0,
    bottom: ROAD_BASE,
  },
  lively: {
    transformOrigin: 'bottom', // squash toward the ground, not the middle
  },
  shadow: {
    position: 'absolute',
    left: 0,
  },
  puff: {
    position: 'absolute',
    left: 0,
    backgroundColor: DUST,
  },
  emote: {
    position: 'absolute',
    left: 0,
  },
  pet: {
    position: 'absolute',
    left: 0,
  },
});
