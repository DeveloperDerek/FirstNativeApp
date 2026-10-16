// Things that move on their own around the step road: clouds and birds
// by day, stars, shooting stars and fireflies at night, chimney smoke and
// flickering windows on the street. One clock drives all of it, ticking
// 12 times a second (chunky steps suit the pixel art, and it keeps the
// work small), and it stops while the page is out of view. Under the
// system's Reduce Motion setting nothing moves.
//
// Everything is placed in points; one art pixel is 2 points, and moving
// things stop on whole art pixels so they stay crisp.

import { useIsFocused } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  type SharedValue,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';

import { AMBIENT_SPRITES } from './lighting.generated';
import type { Scenery } from './lighting';

const P = 2; // points per art pixel
const FPS = 12;
const SKY_H = 72 * P; // the sky image; the road starts below it
const HILLS_H = 40 * P;
const HILLS_W = 256 * P;
const TILE_TOP = 32; // tiles sit at the bottom of the 192-point scene

const SMOKE: Record<Scenery['phase'], string> = {
  day: '#f4efe6',
  sunset: '#ffd9bf',
  night: '#8a8fb0',
};

/** Seconds since the page came into view, in whole ticks; 0 while still. */
export function useAmbientClock(): SharedValue<number> {
  const clock = useSharedValue(0);
  const focused = useIsFocused();
  const still = useReducedMotion();
  const frames = useFrameCallback(({ timeSinceFirstFrame }) => {
    const t = Math.floor((timeSinceFirstFrame / 1000) * FPS) / FPS;
    if (t !== clock.value) clock.value = t;
  }, false);

  useEffect(() => {
    frames.setActive(focused && !still);
  }, [frames, focused, still]);

  return clock;
}

// Worklet helpers
function snap(v: number) {
  'worklet';
  return Math.round(v / P) * P;
}

/** A repeatable random number in [0, 1) for each n. */
function hash(n: number) {
  'worklet';
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

const HIDDEN = { opacity: 0 };

// ---------------------------------------------------------------- the sky

/**
 * Fixed to the screen behind the road: the sky picture, two hill strips
 * that slide slower than the road as it scrolls (so they look far away),
 * and whatever moves in the sky at this time of day.
 */
export function SkyLayer({
  scenery,
  clock,
  scrollX,
  viewport,
}: {
  scenery: Scenery;
  clock: SharedValue<number>;
  scrollX: SharedValue<number>;
  viewport: number;
}) {
  const night = scenery.phase === 'night';
  return (
    <View style={[styles.sky, { height: SKY_H + P * 24 }]} pointerEvents="none">
      <Reanimated.Image
        source={scenery.skyImage}
        style={{ position: 'absolute', top: 0, left: 0, width: 256 * P, height: SKY_H }}
      />
      {night ? (
        <>
          <Twinkles stars={scenery.stars} clock={clock} viewport={viewport} />
          <ShootingStar clock={clock} viewport={viewport} />
        </>
      ) : (
        <>
          <Clouds phase={scenery.phase} clock={clock} viewport={viewport} />
          <Birds clock={clock} viewport={viewport} />
        </>
      )}
      <Hills source={scenery.hills[0]} rate={0.2} top={SKY_H - HILLS_H} scrollX={scrollX} viewport={viewport} />
      <Hills source={scenery.hills[1]} rate={0.45} top={SKY_H - HILLS_H + 4 * P} scrollX={scrollX} viewport={viewport} />
    </View>
  );
}

function Hills({
  source,
  rate,
  top,
  scrollX,
  viewport,
}: {
  source: number;
  rate: number;
  top: number;
  scrollX: SharedValue<number>;
  viewport: number;
}) {
  const copies = Math.ceil(viewport / HILLS_W) + 1;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -snap((scrollX.value * rate) % HILLS_W) }],
  }));
  return (
    <Reanimated.View style={[styles.row, { top }, style]}>
      {Array.from({ length: copies }, (_, i) => (
        <Reanimated.Image key={i} source={source} style={{ width: HILLS_W, height: HILLS_H }} />
      ))}
    </Reanimated.View>
  );
}

const CLOUDS = [
  { y: 6, speed: 5, offset: 40 },
  { y: 30, speed: 3, offset: 260 },
  { y: 16, speed: 4, offset: 480 },
];

function Clouds({
  phase,
  clock,
  viewport,
}: {
  phase: Scenery['phase'];
  clock: SharedValue<number>;
  viewport: number;
}) {
  const sprite = phase === 'sunset' ? AMBIENT_SPRITES.cloud_sunset : AMBIENT_SPRITES.cloud_day;
  return CLOUDS.map((c, i) => <Cloud key={i} {...c} sprite={sprite} clock={clock} viewport={viewport} />);
}

function Cloud({
  sprite,
  y,
  speed,
  offset,
  clock,
  viewport,
}: {
  sprite: { source: number; width: number; height: number };
  y: number;
  speed: number;
  offset: number;
  clock: SharedValue<number>;
  viewport: number;
}) {
  const w = sprite.width * P;
  // Drift right, and come back in on the left after leaving the screen
  const style = useAnimatedStyle(() => {
    const span = viewport + w;
    return { transform: [{ translateX: snap(((clock.value * speed + offset) % span) - w) }] };
  });
  return (
    <Reanimated.Image
      source={sprite.source}
      style={[styles.abs, { top: y, width: w, height: sprite.height * P }, style]}
    />
  );
}

const BIRD_CYCLE = 26; // seconds between flocks
const BIRD_FLIGHT = 12; // seconds a flock takes to cross

function Birds({ clock, viewport }: { clock: SharedValue<number>; viewport: number }) {
  return [0, 1, 2].map((i) => <Bird key={i} index={i} clock={clock} viewport={viewport} />);
}

/** One of a small flock that crosses now and then, flapping. */
function Bird({ index, clock, viewport }: { index: number; clock: SharedValue<number>; viewport: number }) {
  const { bird_up: up, bird_down: down } = AMBIENT_SPRITES;
  const place = (wingsUp: boolean) => {
    'worklet';
    const t = clock.value;
    const cycle = Math.floor(t / BIRD_CYCLE);
    const u = (t % BIRD_CYCLE) / BIRD_FLIGHT;
    // Every other flock or so skips its turn
    if (u > 1 || hash(cycle) < 0.3 || t === 0) return HIDDEN;
    const right = hash(cycle + 0.5) < 0.6;
    const span = viewport + 80;
    const lead = right ? -40 + u * span : viewport + 40 - u * span;
    const x = lead - (right ? 1 : -1) * index * 16;
    const flap = (Math.floor(t * 4) + index) % 2 === 0;
    const y = 12 + hash(cycle + 0.25) * 50 + (index % 2) * 8 + (flap ? 0 : P);
    return {
      opacity: flap === wingsUp ? 1 : 0,
      transform: [{ translateX: snap(x) }, { translateY: snap(y) }],
    };
  };
  const upStyle = useAnimatedStyle(() => place(true));
  const downStyle = useAnimatedStyle(() => place(false));
  const size = { width: up.width * P, height: up.height * P };
  return (
    <>
      <Reanimated.Image source={up.source} style={[styles.abs, size, upStyle]} />
      <Reanimated.Image source={down.source} style={[styles.abs, size, downStyle]} />
    </>
  );
}

/** A few of the stars in the sky picture flare into a little cross now and then. */
function Twinkles({
  stars,
  clock,
  viewport,
}: {
  stars: number[][];
  clock: SharedValue<number>;
  viewport: number;
}) {
  const shown = stars.filter(([x]) => (x + 2) * P < viewport).filter((_, i) => i % 4 === 0);
  return shown.map(([x, y], i) => <Twinkle key={i} x={x} y={y} seed={i} clock={clock} />);
}

function Twinkle({ x, y, seed, clock }: { x: number; y: number; seed: number; clock: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const beat = Math.floor(clock.value * 2 + seed * 0.37);
    return { opacity: hash(beat * 7 + seed * 13) < 0.18 ? 1 : 0 };
  });
  return (
    <Reanimated.View style={[styles.abs, { left: (x - 1) * P, top: (y - 1) * P }, style]}>
      <View style={[styles.twinkleBar, { top: P, width: 3 * P, height: P }]} />
      <View style={[styles.twinkleBar, { left: P, width: P, height: 3 * P }]} />
    </Reanimated.View>
  );
}

const STAR_CYCLE = 9;
const STAR_FLIGHT = 0.9;

function ShootingStar({ clock, viewport }: { clock: SharedValue<number>; viewport: number }) {
  const sprite = AMBIENT_SPRITES.shooting_star;
  const style = useAnimatedStyle(() => {
    const t = clock.value;
    const cycle = Math.floor(t / STAR_CYCLE);
    const u = (t % STAR_CYCLE) / STAR_FLIGHT;
    if (u > 1 || hash(cycle * 3.1) < 0.35 || t === 0) return HIDDEN;
    const x0 = viewport * (0.35 + 0.55 * hash(cycle + 0.7));
    const y0 = 4 + hash(cycle + 0.3) * 30;
    return {
      opacity: 1,
      transform: [{ translateX: snap(x0 - u * 120) }, { translateY: snap(y0 + u * 60) }],
    };
  });
  return (
    <Reanimated.Image
      source={sprite.source}
      style={[styles.abs, { width: sprite.width * P, height: sprite.height * P }, style]}
    />
  );
}

// ---------------------------------------------------------------- the street

type Placed = { left: number; top: number };

/**
 * Smoke from chimneys and window flicker at night, drawn into the
 * scrolling scene over the art they belong to. `tiles` and `landmarks`
 * say where each image sits; pass one or the other so tile effects can go
 * under the landmarks and landmark effects over them.
 */
export function StreetLayer({
  scenery,
  clock,
  tiles = [],
  landmarks = [],
}: {
  scenery: Scenery;
  clock: SharedValue<number>;
  /** Left edge of each tile and which tile it is (0: tile_a, 1: tile_b) */
  tiles?: { left: number; index: number }[];
  /** Left edge and table index (start, mid, goal, far) of each landmark */
  landmarks?: { left: number; index: number }[];
}) {
  const chimneys: Placed[] = [];
  const windows: (Placed & { w: number; h: number })[] = [];
  tiles.forEach(({ left, index }, i) => {
    for (const [x, y] of scenery.chimneys[index] ?? []) {
      chimneys.push({ left: left + x * P, top: TILE_TOP + y * P });
    }
    // A couple of windows per tile is plenty
    (scenery.windows[index] ?? []).forEach(([x, y, w, h], k) => {
      if (k % 5 === i % 5) windows.push({ left: left + x * P, top: TILE_TOP + y * P, w, h });
    });
  });
  for (const { left, index } of landmarks) {
    for (const [x, y] of scenery.landmarkChimneys[index] ?? []) {
      chimneys.push({ left: left + x * P, top: y * P });
    }
    for (const [x, y, w, h] of scenery.landmarkWindows[index] ?? []) {
      windows.push({ left: left + x * P, top: y * P, w, h });
    }
  }
  const color = SMOKE[scenery.phase];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {chimneys.map((c, i) =>
        [0, 1, 2].map((k) => <Puff key={`${i}-${k}`} at={c} puff={k} seed={i} color={color} clock={clock} />)
      )}
      {scenery.phase === 'night' &&
        windows.map((w, i) => <WindowFlicker key={i} at={w} seed={i} clock={clock} />)}
    </View>
  );
}

const PUFF_LIFE = 3; // seconds from chimney to gone

function Puff({
  at,
  puff,
  seed,
  color,
  clock,
}: {
  at: Placed;
  puff: number;
  seed: number;
  color: string;
  clock: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    // Three puffs a third of a life apart, each rising, drifting with the
    // wind and growing, then gone
    const u = (clock.value / PUFF_LIFE + puff / 3 + hash(seed) * 0.3) % 1;
    const x = Math.sin(u * 4 + seed * 6) * 2 + u * 8;
    const y = -u * 22;
    return {
      opacity: u < 0.85 ? 1 : 0,
      transform: [{ translateX: snap(x) }, { translateY: snap(y) }, { scale: u < 0.35 ? 0.5 : 1 }],
    };
  });
  return (
    <Reanimated.View
      style={[
        styles.abs,
        { left: at.left - P, top: at.top - P, width: 2 * P, height: 2 * P, backgroundColor: color },
        style,
      ]}
    />
  );
}

/** A lit window that dims for a moment now and then, like a flame or a TV. */
function WindowFlicker({
  at,
  seed,
  clock,
}: {
  at: Placed & { w: number; h: number };
  seed: number;
  clock: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const beat = Math.floor(clock.value * 3);
    return { opacity: hash(beat + seed * 17.3) < 0.07 ? 1 : 0 };
  });
  return (
    <Reanimated.View
      style={[
        styles.abs,
        { left: at.left, top: at.top, width: at.w * P, height: at.h * P },
        styles.dimWindow,
        style,
      ]}
    />
  );
}

// ---------------------------------------------------------------- in front

/** Fireflies drifting over the road at night, in front of everything. */
export function FrontLayer({
  scenery,
  clock,
  viewport,
}: {
  scenery: Scenery;
  clock: SharedValue<number>;
  viewport: number;
}) {
  if (scenery.phase !== 'night') return null;
  return (
    <View style={styles.front} pointerEvents="none">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Firefly key={i} seed={i} clock={clock} viewport={viewport} />
      ))}
    </View>
  );
}

function Firefly({ seed, clock, viewport }: { seed: number; clock: SharedValue<number>; viewport: number }) {
  const style = useAnimatedStyle(() => {
    const t = clock.value;
    const x = viewport * ((seed + 0.5) / 6) + Math.sin(t * 0.4 + seed * 2.1) * 24;
    const y = 104 + (seed % 3) * 12 + Math.sin(t * 0.7 + seed * 1.3) * 10;
    const lit = Math.sin(t * 1.3 + seed * 1.7) > -0.2;
    return { opacity: lit ? 1 : 0, transform: [{ translateX: snap(x) }, { translateY: snap(y) }] };
  });
  return (
    <Reanimated.View style={[styles.abs, style]}>
      <View style={[styles.fireflyGlow, { top: P, width: 3 * P, height: P }]} />
      <View style={[styles.fireflyGlow, { left: P, width: P, height: 3 * P }]} />
      <View style={[styles.fireflyCore, { left: P, top: P, width: P, height: P }]} />
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  sky: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  front: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 192,
    overflow: 'hidden',
  },
  row: {
    position: 'absolute',
    left: 0,
    flexDirection: 'row',
  },
  abs: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  twinkleBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: '#ffffff',
  },
  dimWindow: {
    backgroundColor: '#c99a45',
  },
  fireflyGlow: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: '#8fae5a',
  },
  fireflyCore: {
    position: 'absolute',
    backgroundColor: '#f2ffb0',
  },
});
