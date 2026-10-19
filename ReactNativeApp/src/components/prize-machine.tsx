import { Canvas, createPicture, Group, LinearGradient, Picture, Rect, Skia, vec } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ItemIcon } from '@/avatar/ItemIcon';
import type { AvatarConfig } from '@/avatar/types';
import { ShopItemIcon } from '@/components/shop-item-icon';
import { boardItemName, findShopEntry } from '@/lib/shop-entries';
import {
  bulbOn,
  COIN_BOB,
  COIN_FRAMES,
  COIN_GROUPS,
  coinFrame,
  coinLift,
  framePixels,
  MACHINE,
  machineBody,
  machineBulbs,
  MINI,
  miniBody,
  miniBulbs,
  P,
  paylineArrows,
  type Px,
  RARITY_COLOR,
  type Tile,
} from '@/roll/roll';

// The daily roll's slot machine (step-tracker-daily-roll.txt, section 5),
// drawn from the pixel data in src/roll/roll.ts: the body in Skia, the reel
// as views so it can show the shop's own item icons. One art pixel is `k`
// points, a whole number, so the pixels stay sharp.

/** The lights: slow chase, fast chase while spinning, all blinking on a win. */
export const LIGHTS = { idle: 0, spin: 1, win: 2 } as const;
const LIGHT_MODES = ['idle', 'spin', 'win'] as const;
const CHASE_PER_SEC = [3, 18, 4];

/** Milliseconds since the screen opened, for the lights and the coins; stays 0 under Reduce Motion. */
export function useMachineClock(): SharedValue<number> {
  const clock = useSharedValue(0);
  const still = useReducedMotion();
  const frames = useFrameCallback(({ timeSinceFirstFrame }) => {
    clock.value = timeSinceFirstFrame;
  }, false);
  useEffect(() => {
    frames.setActive(!still);
  }, [frames, still]);
  return clock;
}

/** A list of rectangles as one Skia picture, `k` points per pixel; '' colours take `fill`. */
function pixelsPicture(px: Px[], k: number, fill = P.gold) {
  return createPicture((canvas) => {
    const paint = Skia.Paint();
    for (const [x, y, w, h, c] of px) {
      paint.setColor(Skia.Color(c || fill));
      canvas.drawRect(Skia.XYWHRect(x * k, y * k, w * k, h * k), paint);
    }
  });
}

// ---------------------------------------------------------------- coins

const framePictures = new Map<number, ReturnType<typeof createPicture>[]>();
/** The coin's five frames at k points per pixel, made once per size. */
function coinPictures(k: number) {
  let list = framePictures.get(k);
  if (!list) {
    list = COIN_FRAMES.map((f) => pixelsPicture(framePixels(f), k));
    framePictures.set(k, list);
  }
  return list;
}

function SpinningCoin({ x, y, k, phase, clock }: { x: number; y: number; k: number; phase: number; clock: SharedValue<number> }) {
  const pictures = coinPictures(k);
  const transform = useDerivedValue(() => [
    { translateX: x * k },
    { translateY: (y + COIN_BOB - (clock.value === 0 ? COIN_BOB / 2 : coinLift(clock.value, phase))) * k },
  ]);
  const frame = useDerivedValue(() => (clock.value === 0 ? 0 : coinFrame(clock.value, phase)));
  return (
    <Group transform={transform}>
      {pictures.map((p, i) => (
        <FrameLayer key={i} picture={p} index={i} frame={frame} />
      ))}
    </Group>
  );
}

function FrameLayer({ picture, index, frame }: { picture: ReturnType<typeof createPicture>; index: number; frame: SharedValue<number> }) {
  const opacity = useDerivedValue(() => (frame.value === index ? 1 : 0));
  return (
    <Group opacity={opacity}>
      <Picture picture={picture} />
    </Group>
  );
}

/**
 * 100, 250 or 500 coins, floating and spinning, each coin on its own
 * beat. `k` is points per pixel; the reel passes one size for every coin
 * tile so coins look the same on each.
 */
export const CoinTile = memo(function CoinTile({
  coins,
  k,
  clock,
}: {
  coins: 100 | 250 | 500;
  k: number;
  clock: SharedValue<number>;
}) {
  const group = COIN_GROUPS[coins];
  const [phase] = useState(() => Math.random() * 4);
  return (
    <Canvas
      style={{ width: group.w * k, height: (group.h + COIN_BOB) * k }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${coins} coins`}>
      {group.at.map(([x, y], i) => (
        <SpinningCoin key={i} x={x} y={y} k={k} phase={phase + i * 0.9} clock={clock} />
      ))}
    </Canvas>
  );
});

/** Points per pixel for coin tiles: the size that lets the 500 tile fit a `w` by `h` box. */
export function coinScale(w: number, h: number) {
  const g = COIN_GROUPS[500];
  return Math.max(1, Math.floor(Math.min(w / g.w, h / (g.h + COIN_BOB))));
}

/** One prize on its own: the coins or the shop item's icon. */
export function PrizeArt({
  tile,
  wearer,
  coinK,
  clock,
}: {
  tile: Tile;
  wearer: AvatarConfig;
  coinK: number;
  clock: SharedValue<number>;
}) {
  if (tile.kind === 'coins') return <CoinTile coins={tile.coins} k={coinK} clock={clock} />;
  return <ShopItemIcon id={tile.id} wearer={wearer} accessibilityLabel={boardItemName(tile.id) ?? 'Shop item'} />;
}

// ---------------------------------------------------------------- the big machine

function Bulb({
  x,
  y,
  i,
  k,
  chase,
  mode,
  winColor,
}: {
  x: number;
  y: number;
  i: number;
  k: number;
  chase: SharedValue<number>;
  mode: SharedValue<number>;
  winColor: string;
}) {
  const color = useDerivedValue(() => {
    const m = LIGHT_MODES[mode.value];
    if (!bulbOn(i, chase.value, m)) return P.bulbOff;
    if (m === 'win') return winColor;
    return i % 2 ? P.bulbOn : P.bulbRed;
  });
  return <Rect x={x * k} y={y * k} width={2 * k} height={2 * k} color={color} />;
}

/** The lever: the arm from its mount to the knob, which moves down as `pull` goes 0 to 1. */
function Lever({ k, pull }: { k: number; pull: SharedValue<number> }) {
  const { baseY, topY, downY } = MACHINE.lever;
  const knobY = useDerivedValue(() => Math.round(topY + (downY - topY) * pull.value));
  const armY = useDerivedValue(() => Math.min(baseY, knobY.value) * k);
  const armH = useDerivedValue(() => Math.abs(baseY - knobY.value) * k);
  const knob = useDerivedValue(() => [{ translateY: (knobY.value - 5) * k }]);
  return (
    <Group>
      <Rect x={112 * k} y={armY} width={3 * k} height={armH} color={P.out} />
      <Rect x={113 * k} y={armY} width={k} height={armH} color={P.chrome} />
      <Group transform={knob}>
        <Rect x={110 * k} y={0} width={7 * k} height={9 * k} color={P.out} />
        <Rect x={109 * k} y={k} width={9 * k} height={7 * k} color={P.out} />
        <Rect x={110 * k} y={k} width={7 * k} height={7 * k} color={P.knob} />
        <Rect x={111 * k} y={2 * k} width={2 * k} height={2 * k} color={P.knobHi} />
      </Group>
    </Group>
  );
}

const ReelTile = memo(function ReelTile({
  tile,
  k,
  coinK,
  wearer,
  clock,
  hidden,
}: {
  tile: Tile;
  k: number;
  coinK: number;
  wearer: AvatarConfig;
  clock: SharedValue<number>;
  hidden: boolean;
}) {
  const color = RARITY_COLOR[tile.kind === 'coins' ? 'coins' : tile.rarity];
  const gem = { width: 4 * k, height: 4 * k, backgroundColor: color, borderColor: 'rgba(0,0,0,0.35)', borderWidth: Math.max(1, k / 2) };
  return (
    <View style={[styles.tile, { height: MACHINE.tile * k, borderBottomWidth: k, paddingHorizontal: 3 * k }]}>
      <View style={gem} />
      <View style={hidden && styles.hidden}>
        <PrizeArt tile={tile} wearer={wearer} coinK={coinK} clock={clock} />
      </View>
      <View style={gem} />
    </View>
  );
});

export type MachineProps = {
  /** Points per art pixel, a whole number */
  k: number;
  tiles: Tile[];
  /** The tile on the line, fractional while spinning */
  position: SharedValue<number>;
  /** 0 = lever up, 1 = pulled down */
  pull: SharedValue<number>;
  /** LIGHTS.idle, .spin or .win */
  lights: SharedValue<number>;
  clock: SharedValue<number>;
  /** The rarity colour once the reel has stopped on a prize */
  flash: string | null;
  /** The tile whose prize is growing out of the window (drawn by PrizePop), or -1 */
  hiddenTile: number;
  wearer: AvatarConfig;
};

/** The big machine on the roll screen, 120 x 152 art pixels. */
export function PrizeMachine({ k, tiles, position, pull, lights, clock, flash, hiddenTile, wearer }: MachineProps) {
  const body = useMemo(() => pixelsPicture(machineBody(), k), [k]);
  const arrows = useMemo(() => pixelsPicture(paylineArrows(), k, flash ?? P.gold), [k, flash]);
  const bulbs = useMemo(() => machineBulbs(), []);
  const chase = useDerivedValue(() => (clock.value / 1000) * CHASE_PER_SEC[lights.value]);
  const reel = MACHINE.reel;
  const coinK = coinScale(44 * k, 20 * k);

  const strip = useAnimatedStyle(() => ({
    transform: [{ translateY: -(position.value - 1) * MACHINE.tile * k }],
  }));

  return (
    <View style={{ width: MACHINE.w * k, height: MACHINE.h * k }}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={body} />
        <Picture picture={arrows} />
        {bulbs.map(([x, y], i) => (
          <Bulb key={i} x={x} y={y} i={i} k={k} chase={chase} mode={lights} winColor={flash ?? P.bulbOn} />
        ))}
        <Lever k={k} pull={pull} />
      </Canvas>
      <View
        style={[
          styles.reel,
          { left: reel.x * k, top: reel.y * k, width: reel.w * k, height: reel.h * k },
        ]}>
        <Reanimated.View style={strip}>
          {tiles.map((t, i) => (
            <ReelTile
              key={i}
              tile={t}
              k={k}
              coinK={coinK}
              wearer={wearer}
              clock={clock}
              hidden={i === hiddenTile}
            />
          ))}
        </Reanimated.View>
        {/* The drum curves away at the top and bottom */}
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Rect x={0} y={0} width={reel.w * k} height={reel.h * k}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, reel.h * k)}
              positions={[0, 0.3, 0.7, 1]}
              colors={['#000000aa', '#00000000', '#00000000', '#000000aa']}
            />
          </Rect>
        </Canvas>
      </View>
      {flash && <Payline k={k} color={flash} />}
    </View>
  );
}

/** The line round the middle tile, flashing in the prize's colour. */
function Payline({ k, color }: { k: number; color: string }) {
  const still = useReducedMotion();
  const on = useSharedValue(1);
  useEffect(() => {
    if (!still) {
      on.set(
        withRepeat(
          withSequence(
            withTiming(1, { duration: 450 }),
            withTiming(0, { duration: 0 }),
            withTiming(0, { duration: 450 }),
            withTiming(1, { duration: 0 })
          ),
          3
        )
      );
    }
  }, [on, still]);
  const style = useAnimatedStyle(() => ({ opacity: on.value }));
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        styles.payline,
        { left: 20 * k, top: 63 * k, width: 68 * k, height: 26 * k, borderWidth: k, borderColor: color, shadowColor: color },
        style,
      ]}
    />
  );
}

/**
 * A won item growing out of the reel window to 2.4x, holding, then shrinking
 * back into its tile (about 0.76 s). Drawn over the machine, since the
 * window clips anything that leaves it.
 */
export function PrizePop({
  k,
  tile,
  color,
  wearer,
  onDone,
}: {
  k: number;
  tile: Tile;
  color: string;
  wearer: AvatarConfig;
  onDone: () => void;
}) {
  const scale = useSharedValue(1);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    scale.set(
      withSequence(
        withTiming(2.4, { duration: 300 }),
        withTiming(2.4, { duration: 115 }),
        withTiming(0.9, { duration: 230 }),
        withTiming(1, { duration: 115 })
      )
    );
    const t = setTimeout(() => done.current(), 780);
    return () => clearTimeout(t);
  }, [scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const still = useSharedValue(0);
  return (
    <View
      pointerEvents="none"
      style={[styles.pop, { left: 22 * k, top: 64 * k, width: 64 * k, height: 24 * k }]}>
      <Reanimated.View style={[style, { shadowColor: color, shadowOpacity: 1, shadowRadius: 2 * k, shadowOffset: { width: 0, height: 0 } }]}>
        <PrizeArt tile={tile} wearer={wearer} coinK={k} clock={still} />
      </Reanimated.View>
    </View>
  );
}

// ---------------------------------------------------------------- sparkles and coins

type Particle = { x: number; y: number; vx: number; vy: number; delay: number; life: number };

/** One spark or coin, moved by `t` (0 to 1 over the burst). Positions are art pixels. */
function Bit({ p, k, t, kind, color }: { p: Particle; k: number; t: SharedValue<number>; kind: 'spark' | 'coin'; color: string }) {
  const style = useAnimatedStyle(() => {
    const age = (t.value * 100 - p.delay) / p.life; // 0 to 1 over this bit's life
    if (age <= 0 || age >= 1) return { opacity: 0 };
    const f = age * p.life; // frames
    const x = p.x + p.vx * f;
    const y = p.y + p.vy * f + (kind === 'coin' ? 0.045 * f * f : 0);
    const twinkle = kind === 'spark' && Math.floor(f / 6) % 2 === 1 ? 0.5 : 1;
    return {
      opacity: 1,
      transform: [{ translateX: Math.round(x) * k }, { translateY: Math.round(y) * k }, { scale: twinkle }],
    };
  });
  if (kind === 'coin') {
    return <Reanimated.View style={[styles.bit, { width: 6 * k, height: 6 * k, backgroundColor: '#ffc12e', borderColor: '#1f1d36', borderWidth: k }, style]} />;
  }
  return (
    <Reanimated.View style={[styles.bit, { width: 3 * k, height: 3 * k }, style]}>
      <View style={{ position: 'absolute', left: k, top: 0, width: k, height: 3 * k, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: 0, top: k, width: 3 * k, height: k, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: k, top: k, width: k, height: k, backgroundColor: '#ffffff' }} />
    </Reanimated.View>
  );
}

/**
 * Sparkles in the reel window (Rare, Epic, Legendary), a spray of coins
 * out of the tray (coins won), or a puff at the tray (the prize card
 * coming out). Over the machine, on its art pixels.
 */
export function Burst({
  k,
  kind,
  count,
  color = '#ffffff',
}: {
  k: number;
  kind: 'sparkle' | 'coins' | 'puff';
  count: number;
  color?: string;
}) {
  const [bits] = useState<Particle[]>(() =>
    Array.from({ length: count }, (): Particle => {
      const r = Math.random;
      if (kind === 'coins') {
        return { x: 52 + r() * 4, y: 120, vx: (r() - 0.5) * 2.2, vy: -2.4 - r() * 2.2, delay: r() * 10, life: 70 + r() * 25 };
      }
      if (kind === 'puff') {
        return { x: 54 + (r() - 0.5) * 40, y: 126 + (r() - 0.5) * 6, vx: 0, vy: -0.35, delay: 0, life: 18 + r() * 18 };
      }
      return { x: 22 + r() * 64, y: 40 + r() * 72, vx: 0, vy: -0.15, delay: r() * 30, life: 30 + r() * 40 };
    })
  );
  const t = useSharedValue(0);
  useEffect(() => {
    // 100 "frames" of the preview at 60 a second
    t.set(withTiming(1, { duration: 1700 }));
  }, [t]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {bits.map((p, i) => (
        <Bit key={i} p={p} k={k} t={t} kind={kind === 'coins' ? 'coin' : 'spark'} color={color} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- the small machine

/**
 * The small machine on Today (32 x 40 art pixels at 2x): bulbs chasing and
 * its reel sliding to a new prize every 1.1 s while the roll is waiting.
 * Still under Reduce Motion.
 */
export function MiniMachine({ tiles: all, wearer }: { tiles: Tile[]; wearer: AvatarConfig }) {
  const k = 2;
  // Coins and clothing: their art can be drawn small at a whole-number scale
  const tiles = useMemo(
    () => all.filter((t) => t.kind === 'coins' || findShopEntry(t.id)?.kind === 'clothing'),
    [all]
  );
  const still = useReducedMotion();
  const clock = useMachineClock();
  const body = useMemo(() => pixelsPicture(miniBody(), k), []);
  const bulbs = useMemo(() => miniBulbs(), []);
  const chase = useDerivedValue(() => (clock.value / 1000) * CHASE_PER_SEC[0]);
  const idle = useSharedValue<number>(LIGHTS.idle);
  const [index, setIndex] = useState(0);
  const slide = useSharedValue(0);

  useEffect(() => {
    if (still || tiles.length < 2) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % tiles.length);
      slide.set(1);
      slide.set(withTiming(0, { duration: 220 }));
    }, 1100);
    return () => clearInterval(id);
  }, [still, tiles.length, slide]);

  const strip = useAnimatedStyle(() => ({ transform: [{ translateY: -(1 - slide.value) * MINI.reel.h * k }] }));
  const reel = MINI.reel;
  const shown = tiles.length ? [tiles[(index + tiles.length - 1) % tiles.length], tiles[index]] : [];

  return (
    <View style={{ width: MINI.w * k, height: MINI.h * k }}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={body} />
        {bulbs.map(([x, y], i) => (
          <MiniBulb key={i} x={x} y={y} i={i} k={k} chase={chase} mode={idle} still={still} />
        ))}
      </Canvas>
      <View style={[styles.reel, { left: reel.x * k, top: reel.y * k, width: reel.w * k, height: reel.h * k }]}>
        <Reanimated.View style={strip}>
          {shown.map((t, i) => (
            <View key={i} style={[styles.miniTile, { height: reel.h * k }]}>
              {t.kind === 'coins' ? (
                <CoinTile coins={100} k={k} clock={clock} />
              ) : (
                <MiniItem id={t.id} wearer={wearer} />
              )}
            </View>
          ))}
        </Reanimated.View>
      </View>
    </View>
  );
}

function MiniItem({ id, wearer }: { id: string; wearer: AvatarConfig }) {
  const entry = findShopEntry(id);
  if (entry?.kind !== 'clothing') return null;
  return (
    <ItemIcon
      slot={entry.slot}
      id={id}
      color={entry.slot === 'face' ? wearer.skin : wearer.hairColor}
      size={28}
      accessibilityLabel={boardItemName(id) ?? 'Shop item'}
    />
  );
}

function MiniBulb({
  x,
  y,
  i,
  k,
  chase,
  mode,
  still,
}: {
  x: number;
  y: number;
  i: number;
  k: number;
  chase: SharedValue<number>;
  mode: SharedValue<number>;
  still: boolean;
}) {
  const color = useDerivedValue(() => {
    const on = still ? i % 2 === 0 : bulbOn(i, chase.value, LIGHT_MODES[mode.value]);
    return on ? (i < 9 ? P.bulbOn : P.bulbRed) : P.bulbOff;
  });
  return <Rect x={x * k} y={y * k} width={k} height={k} color={color} />;
}

const styles = StyleSheet.create({
  reel: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: P.reel,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomColor: P.reelLine,
  },
  hidden: {
    opacity: 0,
  },
  payline: {
    position: 'absolute',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  pop: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bit: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  miniTile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
