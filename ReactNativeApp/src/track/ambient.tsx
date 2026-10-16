// Things that move on their own around the step road, map by map (the
// plan is docs/step-tracker-map-restyle.txt, section 3). One clock drives
// all of it, ticking 12 times a second (chunky steps suit the pixel art,
// and it keeps the work small), and it stops while the page is out of
// view. Under the system's Reduce Motion setting nothing moves.
//
// Movement that is part of the art (swaying pines and kelp, waves,
// torches, neon signs, a waterfall, blinking lights) is a second frame of
// a tile or landmark, drawn by StepTrack with <Framed>. Everything else is
// here, in four layers:
//   SkyLayer      fixed to the screen, behind the road: the sky, depth
//                 strips, and what flies or swims far away
//   HorizonLayer  fixed to the screen, over the tiles: on the sea's horizon
//   StreetLayer   in the scrolling scene: smoke and windows on the art
//   FrontLayer    fixed to the screen, in front: snow, rain, fireflies...
//
// Everything is placed in points; one art pixel is 2 points, and moving
// things stop on whole art pixels so they stay crisp.

import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { type ImageStyle, StyleSheet, View } from 'react-native';
import Reanimated, {
  type SharedValue,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';

import type { Frames, Scenery } from './lighting';
import { AMBIENT_SPRITES } from './lighting.generated';
import type { DayPhase } from './time-of-day';

const P = 2; // points per art pixel
const FPS = 12;
const SCENE_H = 192;
const SKY_H = 72 * P; // the sky image; the road starts below it
const DEPTH_H = 40 * P;
const DEPTH_W = 256 * P;
const TILE_TOP = 32; // tiles sit at the bottom of the 192-point scene

type Kind =
  | 'clouds'
  | 'birds'
  | 'gulls'
  | 'pigeons'
  | 'bats'
  | 'eagle'
  | 'plane'
  | 'satellite'
  | 'twinkles'
  | 'shootingStars'
  | 'aurora'
  | 'sunbeams'
  | 'fish'
  | 'jellyfish'
  | 'sailboat'
  | 'moonGlint'
  | 'smoke'
  | 'windows'
  | 'fireflies'
  | 'leaves'
  | 'snow'
  | 'dust'
  | 'drips'
  | 'bubbles'
  | 'rain';

const ALL: DayPhase[] = ['day', 'sunset', 'night'];
const LIGHT: DayPhase[] = ['day', 'sunset'];

/** What moves on each map, and when. */
const MOVEMENTS: Record<string, [Kind, DayPhase[]][]> = {
  village: [
    ['clouds', LIGHT],
    ['birds', LIGHT],
    ['smoke', ALL],
    ['twinkles', ['night']],
    ['shootingStars', ['night']],
    ['windows', ['night']],
    ['fireflies', ['night']],
  ],
  forest: [
    ['leaves', LIGHT],
    ['birds', LIGHT],
    ['fireflies', ['night']],
  ],
  city: [
    ['clouds', LIGHT],
    ['pigeons', ['day']],
    ['windows', ['sunset', 'night']],
    ['plane', ['night']],
  ],
  beach: [
    ['gulls', LIGHT],
    ['sailboat', ['day']],
    ['moonGlint', ['night']],
  ],
  mountain: [
    ['snow', ALL],
    ['eagle', ['day']],
    ['clouds', LIGHT],
    ['aurora', ['night']],
  ],
  dungeon: [
    ['dust', ['day']],
    ['drips', ALL],
    ['bats', ['night']],
  ],
  space: [
    ['twinkles', ALL],
    ['shootingStars', ALL],
    ['satellite', ALL],
    ['smoke', ALL],
  ],
  ocean: [
    ['bubbles', ALL],
    ['fish', LIGHT],
    ['jellyfish', ['night']],
    ['sunbeams', ['day']],
  ],
  neon: [
    ['bats', ['night']],
    ['smoke', ALL],
    ['rain', ['night']],
  ],
};

function useKinds(scenery: Scenery) {
  const list = MOVEMENTS[scenery.map] ?? [];
  const on = new Set(list.filter(([, when]) => when.includes(scenery.phase)).map(([k]) => k));
  return (kind: Kind) => on.has(kind);
}

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

/** Whether a second frame is showing at time t (seed: so copies don't all flicker together). */
export function frameB(t: number, mode: Frames['mode'], rate: number, seed: number) {
  'worklet';
  if (t === 0) return false;
  if (mode === 'flicker') return hash(Math.floor(t * 6) + seed * 3.7) < 0.08 * rate;
  return Math.floor(t * rate + seed * 0.5) % 2 === 1;
}

const HIDDEN = { opacity: 0 };

type Sprite = { source: number; width: number; height: number };
const size = (s: Sprite) => ({ width: s.width * P, height: s.height * P });

/**
 * Two frames of the same picture taking turns (a swaying tile, a
 * flickering sign). Only one is ever visible, so a frame that moves a
 * shape never shows both.
 */
export function Framed({
  a,
  b,
  mode,
  rate,
  seed,
  clock,
  style,
}: {
  a: number;
  b: number;
  mode: Frames['mode'];
  rate: number;
  seed: number;
  clock: SharedValue<number>;
  style: ImageStyle;
}) {
  const aStyle = useAnimatedStyle(() => ({ opacity: frameB(clock.value, mode, rate, seed) ? 0 : 1 }));
  const bStyle = useAnimatedStyle(() => ({ opacity: frameB(clock.value, mode, rate, seed) ? 1 : 0 }));
  return (
    <>
      <Reanimated.Image source={a} resizeMode="stretch" style={[style, aStyle]} />
      <Reanimated.Image source={b} resizeMode="stretch" style={[style, bStyle]} />
    </>
  );
}

/** Two sprites taking turns every `period` seconds (flapping, shimmering). */
function TwoFrame({
  up,
  down,
  clock,
  period,
  seed = 0,
  place,
}: {
  up: Sprite;
  down: Sprite;
  clock: SharedValue<number>;
  period: number;
  seed?: number;
  /** Where the pair is at time t, or null when it's away */
  place: (t: number) => { x: number; y: number; flip?: boolean } | null;
}) {
  const style = (first: boolean) => {
    'worklet';
    const t = clock.value;
    const at = place(t);
    if (!at) return HIDDEN;
    const second = Math.floor(t / period + seed) % 2 === 1;
    return {
      opacity: second === first ? 0 : 1,
      transform: [{ translateX: snap(at.x) }, { translateY: snap(at.y) }, { scaleX: at.flip ? -1 : 1 }],
    };
  };
  const upStyle = useAnimatedStyle(() => style(true));
  const downStyle = useAnimatedStyle(() => style(false));
  return (
    <>
      <Reanimated.Image source={up.source} style={[styles.abs, size(up), upStyle]} />
      <Reanimated.Image source={down.source} style={[styles.abs, size(down), downStyle]} />
    </>
  );
}

/** A plain square (snow, rain, dust...) moving by `place`. */
function Speck({
  clock,
  color,
  w = 1,
  h = 1,
  place,
}: {
  clock: SharedValue<number>;
  color: string;
  w?: number;
  h?: number;
  place: (t: number) => { x: number; y: number } | null;
}) {
  const style = useAnimatedStyle(() => {
    const at = place(clock.value);
    if (!at || clock.value === 0) return HIDDEN;
    return { opacity: 1, transform: [{ translateX: snap(at.x) }, { translateY: snap(at.y) }] };
  });
  return <Reanimated.View style={[styles.abs, { width: w * P, height: h * P, backgroundColor: color }, style]} />;
}

// ---------------------------------------------------------------- the sky

/**
 * Fixed to the screen behind the road: the sky picture, two depth strips
 * that slide slower than the road as it scrolls (so they look far away),
 * and whatever moves far off at this time of day.
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
  const has = useKinds(scenery);
  const depthTop = scenery.depthTop * P;
  return (
    <View style={[styles.layer, { height: SCENE_H }]} pointerEvents="none">
      <Reanimated.Image
        source={scenery.skyImage}
        style={{ position: 'absolute', top: 0, left: 0, width: 256 * P, height: SKY_H }}
      />
      {has('sunbeams') && <Sunbeams clock={clock} />}
      {has('aurora') && <Aurora clock={clock} viewport={viewport} />}
      {has('twinkles') && <Twinkles stars={scenery.stars} clock={clock} viewport={viewport} />}
      {has('shootingStars') && <ShootingStar clock={clock} viewport={viewport} />}
      {has('satellite') && <Satellite clock={clock} viewport={viewport} />}
      {has('clouds') && <Clouds phase={scenery.phase} clock={clock} viewport={viewport} />}
      <Depth source={scenery.depth[0]} rate={0.2} top={depthTop} scrollX={scrollX} viewport={viewport} />
      <Depth source={scenery.depth[1]} rate={0.45} top={depthTop + 4 * P} scrollX={scrollX} viewport={viewport} />
      {has('birds') && <Flock kind="bird" clock={clock} viewport={viewport} />}
      {has('gulls') && <Flock kind="gull" clock={clock} viewport={viewport} />}
      {has('pigeons') && <Flock kind="pigeon" clock={clock} viewport={viewport} />}
      {has('bats') && <Flock kind="bat" clock={clock} viewport={viewport} />}
      {has('eagle') && <Eagle clock={clock} viewport={viewport} />}
      {has('plane') && <Plane clock={clock} viewport={viewport} />}
      {has('fish') && <FishSchool clock={clock} viewport={viewport} />}
      {has('jellyfish') && <Jellyfish clock={clock} viewport={viewport} />}
    </View>
  );
}

function Depth({
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
  const copies = Math.ceil(viewport / DEPTH_W) + 1;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -snap((scrollX.value * rate) % DEPTH_W) }],
  }));
  return (
    <Reanimated.View style={[styles.row, { top }, style]}>
      {Array.from({ length: copies }, (_, i) => (
        <Reanimated.Image key={i} source={source} style={{ width: DEPTH_W, height: DEPTH_H }} />
      ))}
    </Reanimated.View>
  );
}

const CLOUDS = [
  { y: 6, speed: 5, offset: 40 },
  { y: 30, speed: 3, offset: 260 },
  { y: 16, speed: 4, offset: 480 },
];

function Clouds({ phase, clock, viewport }: { phase: DayPhase; clock: SharedValue<number>; viewport: number }) {
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
  sprite: Sprite;
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
  return <Reanimated.Image source={sprite.source} style={[styles.abs, { top: y }, size(sprite), style]} />;
}

const FLOCKS = {
  // cycle: seconds between flocks; flight: seconds to cross; flap: seconds per wing beat
  bird: { count: 3, cycle: 26, flight: 12, flap: 0.25, top: 12, spread: 50 },
  gull: { count: 2, cycle: 20, flight: 14, flap: 0.6, top: 10, spread: 50 },
  pigeon: { count: 3, cycle: 18, flight: 8, flap: 0.15, top: 30, spread: 40 },
  bat: { count: 3, cycle: 14, flight: 6, flap: 0.12, top: 20, spread: 50 },
};

/** A few birds (or gulls, pigeons, bats) that cross now and then. */
function Flock({ kind, clock, viewport }: { kind: keyof typeof FLOCKS; clock: SharedValue<number>; viewport: number }) {
  const f = FLOCKS[kind];
  const up = AMBIENT_SPRITES[`${kind}_up`];
  const down = AMBIENT_SPRITES[`${kind}_down`];
  return Array.from({ length: f.count }, (_, i) => (
    <TwoFrame
      key={i}
      up={up}
      down={down}
      clock={clock}
      period={f.flap}
      seed={i * 0.5}
      place={(t) => {
        'worklet';
        const cycle = Math.floor(t / f.cycle);
        const u = (t % f.cycle) / f.flight;
        // Every other flock or so skips its turn
        if (u > 1 || hash(cycle + f.cycle) < 0.3) return null;
        const right = hash(cycle + 0.5) < 0.6;
        const span = viewport + 80;
        const lead = right ? -40 + u * span : viewport + 40 - u * span;
        const flutter = kind === 'bat' ? Math.sin(t * 7 + i * 2) * 8 : 0;
        return {
          x: lead - (right ? 1 : -1) * i * 16,
          y: f.top + hash(cycle + 0.25) * f.spread + (i % 2) * 8 + flutter,
        };
      }}
    />
  ));
}

/** One eagle circling high over the peaks. */
function Eagle({ clock, viewport }: { clock: SharedValue<number>; viewport: number }) {
  return (
    <TwoFrame
      up={AMBIENT_SPRITES.eagle_up}
      down={AMBIENT_SPRITES.eagle_down}
      clock={clock}
      period={0.8}
      place={(t) => {
        'worklet';
        const a = t * 0.35;
        return { x: viewport * 0.6 + Math.cos(a) * 70, y: 30 + Math.sin(a) * 16 };
      }}
    />
  );
}

/** A plane crossing high at night, its light blinking. */
function Plane({ clock, viewport }: { clock: SharedValue<number>; viewport: number }) {
  return (
    <TwoFrame
      up={AMBIENT_SPRITES.plane_on}
      down={AMBIENT_SPRITES.plane_off}
      clock={clock}
      period={0.5}
      place={(t) => {
        'worklet';
        const u = (t % 40) / 28;
        if (u > 1) return null;
        return { x: viewport + 30 - u * (viewport + 60), y: 14 + u * 6 };
      }}
    />
  );
}

function Satellite({ clock, viewport }: { clock: SharedValue<number>; viewport: number }) {
  const sprite = AMBIENT_SPRITES.satellite;
  const style = useAnimatedStyle(() => {
    const t = clock.value;
    const u = (t % 45) / 32;
    if (u > 1 || t === 0) return HIDDEN;
    const y = 18 + hash(Math.floor(t / 45)) * 30;
    return { opacity: 1, transform: [{ translateX: snap(-30 + u * (viewport + 60)) }, { translateY: snap(y) }] };
  });
  return <Reanimated.Image source={sprite.source} style={[styles.abs, size(sprite), style]} />;
}

/** A few of the stars in the sky picture flare into a little cross now and then. */
function Twinkles({ stars, clock, viewport }: { stars: number[][]; clock: SharedValue<number>; viewport: number }) {
  const shown = stars.filter(([x]) => (x + 2) * P < viewport).filter((_, i) => i % 4 === 0);
  return shown.map(([x, y], i) => <Twinkle key={i} x={x} y={y} seed={i} clock={clock} />);
}

function Twinkle({ x, y, seed, clock }: { x: number; y: number; seed: number; clock: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const beat = Math.floor(clock.value * 2 + seed * 0.37);
    return { opacity: clock.value > 0 && hash(beat * 7 + seed * 13) < 0.18 ? 1 : 0 };
  });
  return (
    <Reanimated.View style={[styles.abs, { left: (x - 1) * P, top: (y - 1) * P }, style]}>
      <View style={[styles.bar, styles.white, { top: P, width: 3 * P, height: P }]} />
      <View style={[styles.bar, styles.white, { left: P, width: P, height: 3 * P }]} />
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
  return <Reanimated.Image source={sprite.source} style={[styles.abs, size(sprite), style]} />;
}

/** Two frames of a soft curtain of light taking turns across the sky. */
function Aurora({ clock, viewport }: { clock: SharedValue<number>; viewport: number }) {
  const a = AMBIENT_SPRITES.aurora_0;
  const copies = Math.ceil(viewport / (a.width * P));
  return Array.from({ length: copies }, (_, i) => (
    <TwoFrame
      key={i}
      up={a}
      down={AMBIENT_SPRITES.aurora_1}
      clock={clock}
      period={1.2}
      place={() => {
        'worklet';
        return { x: i * a.width * P, y: 6 };
      }}
    />
  ));
}

function Sunbeams({ clock }: { clock: SharedValue<number> }) {
  return (
    <TwoFrame
      up={AMBIENT_SPRITES.sunbeams_0}
      down={AMBIENT_SPRITES.sunbeams_1}
      clock={clock}
      period={1}
      place={() => {
        'worklet';
        return { x: 0, y: 0 };
      }}
    />
  );
}

/** A small school that swims across now and then. */
function FishSchool({ clock, viewport }: { clock: SharedValue<number>; viewport: number }) {
  return [0, 1, 2, 3, 4].map((i) => (
    <Fish key={i} index={i} clock={clock} viewport={viewport} />
  ));
}

function Fish({ index, clock, viewport }: { index: number; clock: SharedValue<number>; viewport: number }) {
  const sprite = index % 2 ? AMBIENT_SPRITES.fish_orange : AMBIENT_SPRITES.fish_yellow;
  const style = useAnimatedStyle(() => {
    const t = clock.value;
    const cycle = Math.floor(t / 20);
    const u = (t % 20) / 14;
    if (u > 1 || t === 0) return HIDDEN;
    const right = hash(cycle + 0.9) < 0.5;
    const span = viewport + 100;
    const lead = right ? -50 + u * span : viewport + 50 - u * span;
    const x = lead - (right ? 1 : -1) * ((index % 3) * 14 + (index > 2 ? 6 : 0));
    const y = 50 + hash(cycle + 0.1) * 40 + (index % 3) * 8 - (index > 2 ? 6 : 0) + Math.sin(t * 3 + index) * 2;
    return { opacity: 1, transform: [{ translateX: snap(x) }, { translateY: snap(y) }, { scaleX: right ? 1 : -1 }] };
  });
  return <Reanimated.Image source={sprite.source} style={[styles.abs, size(sprite), style]} />;
}

/** Glowing jellyfish drifting slowly up through the dark water. */
function Jellyfish({ clock, viewport }: { clock: SharedValue<number>; viewport: number }) {
  return [0, 1, 2].map((i) => (
    <TwoFrame
      key={i}
      up={AMBIENT_SPRITES.jelly_0}
      down={AMBIENT_SPRITES.jelly_1}
      clock={clock}
      period={0.7}
      seed={i * 0.5}
      place={(t) => {
        'worklet';
        const u = ((t + i * 9) % 27) / 27;
        return { x: viewport * (0.2 + i * 0.3) + Math.sin(t * 0.5 + i) * 12, y: 150 - u * 170 };
      }}
    />
  ));
}

// ---------------------------------------------------------------- the horizon

/**
 * On maps with a sea, things on its horizon: fixed to the screen like the
 * sky, but drawn over the tiles (the sea is part of them).
 */
export function HorizonLayer({
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
  const has = useKinds(scenery);
  const follow = useAnimatedStyle(() => ({ transform: [{ translateX: scrollX.value }] }));
  if (scenery.horizon === null) return null;
  const horizon = TILE_TOP + scenery.horizon * P;
  return (
    <Reanimated.View style={[styles.layer, { height: SCENE_H, width: viewport }, follow]} pointerEvents="none">
      {has('sailboat') && <Sailboat clock={clock} viewport={viewport} horizon={horizon} />}
      {has('moonGlint') && (
        <TwoFrame
          up={AMBIENT_SPRITES.moon_glint_0}
          down={AMBIENT_SPRITES.moon_glint_1}
          clock={clock}
          period={0.8}
          place={() => {
            'worklet';
            // Under the moon in the sky picture
            return { x: 170 * P - 6 * P, y: horizon + P };
          }}
        />
      )}
    </Reanimated.View>
  );
}

function Sailboat({ clock, viewport, horizon }: { clock: SharedValue<number>; viewport: number; horizon: number }) {
  const sprite = AMBIENT_SPRITES.sailboat;
  const style = useAnimatedStyle(() => {
    const u = ((clock.value + 20) % 90) / 80;
    if (u > 1 || clock.value === 0) return HIDDEN;
    return { opacity: 1, transform: [{ translateX: snap(-30 + u * (viewport + 60)) }] };
  });
  return (
    <Reanimated.Image
      source={sprite.source}
      style={[styles.abs, { top: horizon - sprite.height * P + 3 * P }, size(sprite), style]}
    />
  );
}

// ---------------------------------------------------------------- the street

type Placed = { left: number; top: number };

/**
 * Smoke from chimneys and vents, and window flicker, drawn into the
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
  const has = useKinds(scenery);
  const chimneys: Placed[] = [];
  const windows: (Placed & { w: number; h: number })[] = [];
  tiles.forEach(({ left, index }, i) => {
    for (const [x, y] of scenery.chimneys[index] ?? []) {
      chimneys.push({ left: left + x * P, top: TILE_TOP + y * P });
    }
    // A few windows per tile is plenty
    (scenery.windows[index] ?? []).forEach(([x, y, w, h], k) => {
      if (k % 5 === i % 5) windows.push({ left: left + x * P, top: TILE_TOP + y * P, w, h });
    });
  });
  for (const { left, index } of landmarks) {
    for (const [x, y] of scenery.landmarkChimneys[index] ?? []) {
      chimneys.push({ left: left + x * P, top: y * P });
    }
    (scenery.landmarkWindows[index] ?? []).forEach(([x, y, w, h], k) => {
      if (k % 3 === 0) windows.push({ left: left + x * P, top: y * P, w, h });
    });
  }
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {has('smoke') &&
        chimneys.map((c, i) =>
          [0, 1, 2].map((k) => (
            <Puff key={`${i}-${k}`} at={c} puff={k} seed={i} color={scenery.smokeColor} clock={clock} />
          ))
        )}
      {has('windows') &&
        windows.map((w, i) => <WindowFlicker key={i} at={w} seed={i} color={scenery.windowAlt} clock={clock} />)}
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
      opacity: u < 0.85 && clock.value > 0 ? 1 : 0,
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

/** A window that changes for a moment now and then (dims, or switches off). */
function WindowFlicker({
  at,
  seed,
  color,
  clock,
}: {
  at: Placed & { w: number; h: number };
  seed: number;
  color: string;
  clock: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const beat = Math.floor(clock.value * 3);
    return { opacity: clock.value > 0 && hash(beat + seed * 17.3) < 0.07 ? 1 : 0 };
  });
  return (
    <Reanimated.View
      style={[
        styles.abs,
        { left: at.left, top: at.top, width: at.w * P, height: at.h * P, backgroundColor: color },
        style,
      ]}
    />
  );
}

/**
 * The real time on a clock face (city). Hands are drawn a pixel at a
 * time so they match the art; they move once a minute, so this uses the
 * phone's clock rather than the animation clock.
 */
export function ClockHands({ left, clock }: { left: number; clock: { cx: number; cy: number; r: number } }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = now.getMinutes();
  const hours = (now.getHours() % 12) + minutes / 60;
  const hand = (angle: number, length: number) => {
    const pts = new Set<string>();
    for (let i = 0; i <= length * 2; i++) {
      const r = i / 2;
      pts.add(`${Math.round(clock.cx + Math.sin(angle) * r)},${Math.round(clock.cy - Math.cos(angle) * r)}`);
    }
    return [...pts].map((p) => p.split(',').map(Number));
  };
  const pixels = [
    ...hand((minutes / 60) * 2 * Math.PI, clock.r - 1),
    ...hand((hours / 12) * 2 * Math.PI, Math.max(2, clock.r - 3)),
  ];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden>
      {pixels.map(([x, y]) => (
        <View
          key={`${x},${y}`}
          style={[styles.abs, styles.hand, { left: left + x * P, top: y * P, width: P, height: P }]}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- in front

/** In front of everything: snow, rain, leaves, fireflies, bubbles, dust and drips. */
export function FrontLayer({
  scenery,
  clock,
  viewport,
}: {
  scenery: Scenery;
  clock: SharedValue<number>;
  viewport: number;
}) {
  const has = useKinds(scenery);
  // Rain only on some nights, the same for everyone on a given date
  const [rainy] = useState(() => {
    const d = new Date();
    const n = d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate();
    return hash(n) < 0.4;
  });
  return (
    <View style={[styles.layer, { height: SCENE_H }]} pointerEvents="none">
      {has('fireflies') && [0, 1, 2, 3, 4, 5].map((i) => <Firefly key={i} seed={i} clock={clock} viewport={viewport} />)}
      {has('leaves') &&
        Array.from({ length: 7 }, (_, i) => (
          <Speck
            key={i}
            clock={clock}
            color={LEAF_COLORS[i % LEAF_COLORS.length]}
            w={2}
            place={(t) => {
              'worklet';
              const u = ((t * 0.07 + i * 0.37) % 1);
              return { x: viewport * ((i * 0.29) % 1) + Math.sin(t * 1.3 + i * 2) * 14 + u * 30, y: -6 + u * 160 };
            }}
          />
        ))}
      {has('snow') &&
        Array.from({ length: 24 }, (_, i) => (
          <Speck
            key={i}
            clock={clock}
            color="#f6f8ff"
            place={(t) => {
              'worklet';
              const speed = 14 + (i % 4) * 5;
              const y = ((t * speed + i * 37) % (SCENE_H + 10)) - 6;
              return { x: ((i * 53) % Math.max(1, viewport)) + Math.sin(t * 0.8 + i) * 8, y };
            }}
          />
        ))}
      {has('dust') &&
        Array.from({ length: 10 }, (_, i) => (
          <Speck
            key={i}
            clock={clock}
            color="#cfc4e0"
            place={(t) => {
              'worklet';
              if (Math.sin(t * 0.9 + i * 1.7) < -0.3) return null;
              return {
                x: viewport * ((i * 0.37 + 0.05) % 1) + Math.sin(t * 0.3 + i) * 12,
                y: 20 + ((i * 29) % 110) + Math.sin(t * 0.25 + i * 2) * 10,
              };
            }}
          />
        ))}
      {has('drips') &&
        [0, 1, 2, 3].map((i) => (
          <Speck
            key={i}
            clock={clock}
            color="#8fa8d8"
            h={2}
            place={(t) => {
              'worklet';
              const period = 3 + i;
              const u = ((t + i * 1.3) % period) / 1.1;
              if (u > 1) return null;
              return { x: viewport * (0.15 + i * 0.23), y: 10 + u * u * 130 };
            }}
          />
        ))}
      {has('bubbles') &&
        Array.from({ length: 12 }, (_, i) => (
          <Speck
            key={i}
            clock={clock}
            color="#cfeaf7"
            w={i % 3 === 0 ? 2 : 1}
            h={i % 3 === 0 ? 2 : 1}
            place={(t) => {
              'worklet';
              const speed = 12 + (i % 3) * 6;
              const y = 160 - ((t * speed + i * 41) % 180);
              return { x: viewport * ((i * 0.41 + 0.03) % 1) + Math.sin(t * 2 + i) * 3, y };
            }}
          />
        ))}
      {has('rain') && rainy && <Rain clock={clock} viewport={viewport} />}
    </View>
  );
}

const LEAF_COLORS = ['#e8894f', '#f2c14e', '#c9653a', '#9cbf5a'];

function Rain({ clock, viewport }: { clock: SharedValue<number>; viewport: number }) {
  return (
    <>
      {Array.from({ length: 36 }, (_, i) => (
        <Speck
          key={i}
          clock={clock}
          color="#9fb0d8"
          h={3}
          place={(t) => {
            'worklet';
            const y = ((t * 360 + i * 53) % (SCENE_H + 20)) - 10;
            return { x: ((i * 37 + y * 0.15) % Math.max(1, viewport)), y };
          }}
        />
      ))}
      {/* Ripples in the puddles on the road */}
      {Array.from({ length: 6 }, (_, i) => (
        <Speck
          key={`r${i}`}
          clock={clock}
          color="#b8c4e8"
          w={3}
          place={(t) => {
            'worklet';
            const beat = Math.floor(t * 2 + i * 0.4);
            if ((t * 2 + i * 0.4) % 1 > 0.5) return null;
            return { x: viewport * hash(beat + i * 7.7), y: 150 + hash(beat * 3 + i) * 34 };
          }}
        />
      ))}
    </>
  );
}

function Firefly({ seed, clock, viewport }: { seed: number; clock: SharedValue<number>; viewport: number }) {
  const style = useAnimatedStyle(() => {
    const t = clock.value;
    const x = viewport * ((seed + 0.5) / 6) + Math.sin(t * 0.4 + seed * 2.1) * 24;
    const y = 104 + (seed % 3) * 12 + Math.sin(t * 0.7 + seed * 1.3) * 10;
    const lit = t > 0 && Math.sin(t * 1.3 + seed * 1.7) > -0.2;
    return { opacity: lit ? 1 : 0, transform: [{ translateX: snap(x) }, { translateY: snap(y) }] };
  });
  return (
    <Reanimated.View style={[styles.abs, style]}>
      <View style={[styles.bar, styles.fireflyGlow, { top: P, width: 3 * P, height: P }]} />
      <View style={[styles.bar, styles.fireflyGlow, { left: P, width: P, height: 3 * P }]} />
      <View style={[styles.bar, styles.fireflyCore, { left: P, top: P, width: P, height: P }]} />
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  white: {
    backgroundColor: '#ffffff',
  },
  hand: {
    backgroundColor: '#2a2f3a',
  },
  fireflyGlow: {
    backgroundColor: '#8fae5a',
  },
  fireflyCore: {
    backgroundColor: '#f2ffb0',
  },
});
