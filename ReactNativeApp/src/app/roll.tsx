import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { listRollPool, markRollSeen, rollDailyPrize } from '@/api/roll';
import { useAuth } from '@/auth/AuthProvider';
import { addOwnedItem } from '@/avatar/my-items';
import { DEFAULT_AVATAR } from '@/avatar/types';
import { CoinBalance } from '@/components/coin-balance';
import {
  Burst,
  LIGHTS,
  PrizeArt,
  PrizeMachine,
  PrizePop,
  useMachineClock,
} from '@/components/prize-machine';
import { ThemedText } from '@/components/themed-text';
import { GameFont, Spacing } from '@/constants/theme';
import { useMapTheme } from '@/hooks/use-map-theme';
import { useSteps } from '@/hooks/use-steps';
import { useWallet } from '@/hooks/use-wallet';
import { errorMessage } from '@/lib/error-message';
import * as haptics from '@/lib/haptics';
import { boardItemName, findShopEntry } from '@/lib/shop-entries';
import {
  buildReel,
  isBigWin,
  MACHINE,
  placePrize,
  type PoolItem,
  type Prize,
  prizeName,
  RARITY_COLOR,
  RARITY_LABEL,
  REEL_START,
  reelPosition,
  rollErrorText,
  type SpinPlan,
  spinPlan,
  spinTotalMs,
  type Tile,
  tileFor,
} from '@/roll/roll';
import { useRollSounds } from '@/roll/sounds';

// The daily roll screen (step-tracker-daily-roll.txt, section 5): pull
// the lever down, the reel spins and stops on the prize the server already
// picked, and the prize card pops out of the tray. Opened from the small
// machine on Today.

const BG = '#18181a'; // flat charcoal behind the machine
const INK = '#f4f1ff';
const MUTED = '#b9b6d6';
const CARD = '#25263d';
const YELLOW = '#ffc928';

/** While it waits the machine bounces: up this many art pixels, easing off
 *  at the top and falling back faster, then a short rest on the floor. */
const BOUNCE_PX = 4;
const BOUNCE_UP_MS = 360;
const BOUNCE_DOWN_MS = 300;
const BOUNCE_REST_MS = 160;

/** How far down (0 to 1) the lever must be when let go for the reel to spin. */
const PULL_ENOUGH = 0.6;

/** Coins won: how long they spray out of the tray before the card follows. */
const COINS_OUT_MS = 600;

/** The shortest gap between reel ticks: at full speed they'd blur into one buzz. */
const TICK_MS = 50;

/** The screen grows out of Today's small machine, and shrinks back into it on close. */
const OPEN_MS = 420;
const CLOSE_MS = 280;

/** Where Today's small machine was on screen, from its "x,y,w,h" param. */
function parseOrigin(from: string | undefined) {
  const [x, y, w, h] = (from ?? '').split(',').map(Number);
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** idle: waiting for the lever; asking: the server is picking; spinning; then the reveal. */
type Phase = 'idle' | 'asking' | 'spinning' | 'landed' | 'revealed';

export default function RollScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const still = useReducedMotion();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const { roll, setRoll, today, goal } = useSteps();
  const { balance, refreshBalance } = useWallet();
  const { refreshOwned } = useMapTheme();
  const wearer = profile?.avatar ?? DEFAULT_AVATAR;

  // Whole points per art pixel: 3 on most phones
  const k = Math.max(2, Math.min(3, Math.floor((Math.min(width, 480) - 2 * Spacing.four) / MACHINE.w)));
  const clock = useMachineClock();
  const play = useRollSounds();

  // ---------------------------------------------------------------- opening
  // The page is clipped to a box that grows from the small machine's spot
  // to the whole screen, while the big machine inside grows from the small
  // machine's size: the machine expands out and fills the screen.
  // Closing runs it backwards. No spot (opened some other way): from the middle.
  const origin = parseOrigin(from) ?? {
    x: width / 2 - (MACHINE.w * k) / 8,
    y: height / 2 - (MACHINE.h * k) / 8,
    w: (MACHINE.w * k) / 4,
    h: (MACHINE.h * k) / 4,
  };
  const startScale = Math.min(1, origin.w / (MACHINE.w * k));
  const open = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (!still) open.set(withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.back(1.1)) }));
  }, [still, open]);
  const closing = useRef(false);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (still) return router.back();
    open.set(
      withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) scheduleOnRN(router.back);
      })
    );
  }, [still, open, router]);
  // Android's back button closes it the same way
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: interpolate(open.value, [0, 1], [0, 1], 'clamp') }));
  const clipStyle = useAnimatedStyle(() => {
    const t = open.value;
    return {
      left: interpolate(t, [0, 1], [origin.x, 0]),
      top: interpolate(t, [0, 1], [origin.y, 0]),
      width: interpolate(t, [0, 1], [origin.w, width]),
      height: interpolate(t, [0, 1], [origin.h, height]),
      borderRadius: interpolate(t, [0, 1], [14, 0], 'clamp'),
    };
  });
  // The full-size page, kept centered in the box while it grows
  const pageStyle = useAnimatedStyle(() => {
    const t = open.value;
    const w = interpolate(t, [0, 1], [origin.w, width]);
    const h = interpolate(t, [0, 1], [origin.h, height]);
    return {
      left: (w - width) / 2,
      top: (h - height) / 2,
      opacity: interpolate(t, [0, 0.15], [0, 1], 'clamp'),
      transform: [{ scale: interpolate(t, [0, 1], [startScale, 1]) }],
    };
  });

  const [pool, setPool] = useState<PoolItem[]>([]);
  const [tiles, setTiles] = useState<Tile[]>(() => buildReel([]));
  const [phase, setPhase] = useState<Phase>('idle');
  const [prize, setPrize] = useState<Prize | null>(null);
  const [stop, setStop] = useState(REEL_START);
  const [popping, setPopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownBalance, setShownBalance] = useState<number | null>(null);

  const position = useSharedValue(REEL_START);
  const pull = useSharedValue(0);
  const lights = useSharedValue<number>(LIGHTS.idle);
  const plan = useSharedValue<SpinPlan | null>(null);
  const startedAt = useSharedValue(-1);
  // The machine bounces while it waits, and shakes when it stops
  const bob = useSharedValue(0);
  const shake = useSharedValue(0);

  // The reel shows what this player could still win
  useEffect(() => {
    listRollPool()
      .then((p) => {
        setPool(p);
        setTiles(buildReel(p));
      })
      .catch(() => {});
  }, []);

  // ---------------------------------------------------------------- the reveal
  const reveal = useCallback(
    (p: Prize) => {
      setPhase('revealed');
      const name = prizeName(p, (id) => boardItemName(id));
      AccessibilityInfo.announceForAccessibility(
        p.item_id === null ? `You won ${p.coins} coins` : `You won ${name}, ${RARITY_LABEL[p.rarity]}`
      );
      if (p.item_id !== null) {
        if (userId) addOwnedItem(userId, p.item_id); // in the character editor straight away
        refreshOwned(); // a won map unlocks on Profile straight away
      } else if (balance !== null && !still) {
        countUp(balance, balance + p.coins, setShownBalance);
      }
      refreshBalance().catch(() => {});
      markRollSeen().catch(() => {});
      setRoll({ state: 'rolled', seen: true, ...p });
    },
    [userId, balance, still, refreshOwned, refreshBalance, setRoll]
  );

  const landed = useCallback(
    (p: Prize) => {
      setPhase('landed');
      // The win buzz; a big win gets a heavy thump after it too
      haptics.success();
      if (isBigWin(p)) {
        setTimeout(haptics.thump, 180);
      }
      // The reel's thunk, then coins clinking out of the tray or the win's jingle
      play('stop');
      setTimeout(() => play(isBigWin(p) ? 'winBig' : p.item_id === null ? 'coins' : 'win'), 120);
      if (still) return reveal(p);
      lights.set(LIGHTS.win);
      shake.set(
        withSequence(
          withTiming(-k, { duration: 80 }),
          withTiming(k, { duration: 80 }),
          withTiming(-k, { duration: 80 }),
          withTiming(0, { duration: 80 })
        )
      );
      // An item grows out of the window first; coins leave their row
      // empty and spray out of the tray, then the card comes
      if (p.item_id !== null) setPopping(true);
      else setTimeout(() => reveal(p), COINS_OUT_MS);
    },
    [still, k, reveal, lights, shake, play]
  );

  // ---------------------------------------------------------------- the spin
  // The frame callback keeps the first onSpinEnd it saw, so it reads the
  // latest prize and landed() through refs
  const prizeRef = useRef<Prize | null>(null);
  const landedRef = useRef(landed);
  useEffect(() => {
    landedRef.current = landed;
  }, [landed]);
  const onSpinEnd = useCallback(() => {
    if (prizeRef.current) landedRef.current(prizeRef.current);
  }, []);

  // A tick each time a tile crosses the line: quick at full speed,
  // spreading out as the reel slows onto the prize
  const lastTick = useRef(0);
  const tick = useCallback(() => {
    const now = Date.now();
    if (now - lastTick.current < TICK_MS) return;
    lastTick.current = now;
    haptics.select();
    play('tick');
  }, [play]);
  useAnimatedReaction(
    () => Math.round(position.get()),
    (tile, before) => {
      // Only forward, while spinning (not the wind-up, nor the reel reset for another go)
      if (before !== null && tile > before && plan.get() !== null) scheduleOnRN(tick);
    }
  );

  const spinFrames = useFrameCallback(({ timestamp }) => {
    const p = plan.get();
    if (!p) return;
    if (startedAt.get() < 0) startedAt.set(timestamp);
    const t = timestamp - startedAt.get();
    position.set(reelPosition(t, p));
    if (t >= spinTotalMs(p)) {
      plan.set(null);
      scheduleOnRN(onSpinEnd);
    }
  }, false);

  // Frames run only while the reel spins
  useEffect(() => {
    if (phase !== 'spinning') spinFrames.setActive(false);
  }, [phase, spinFrames]);

  /** The lever was pulled: ask the server, then spin. */
  async function start() {
    if (phase !== 'idle') return;
    setPhase('asking');
    setError(null);
    haptics.tap();
    play('pull');

    let p: Prize;
    try {
      p = await rollDailyPrize();
    } catch (e) {
      setError(rollErrorText(errorMessage(e)));
      setPhase('idle');
      return;
    }
    prizeRef.current = p;
    setPrize(p);
    const sp = spinPlan(p.rarity);
    const at = REEL_START + sp.tiles;
    setStop(at);
    setTiles((t) => placePrize(t, at, tileFor(p), pool));

    if (still) {
      position.set(at);
      landed(p);
      return;
    }
    setPhase('spinning');
    lights.set(LIGHTS.spin);
    startedAt.set(-1);
    plan.set(sp);
    spinFrames.setActive(true);
  }

  // ---------------------------------------------------------------- motion
  useEffect(() => {
    bob.set(
      phase === 'idle' && !still
        ? withRepeat(
            withSequence(
              withTiming(-BOUNCE_PX * k, { duration: BOUNCE_UP_MS, easing: Easing.out(Easing.quad) }),
              withTiming(0, { duration: BOUNCE_DOWN_MS, easing: Easing.in(Easing.quad) }),
              withTiming(0, { duration: BOUNCE_REST_MS })
            ),
            -1
          )
        : withTiming(0)
    );
  }, [bob, phase, still, k]);
  const machineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bob.value }, { translateX: shake.value }],
  }));

  // The hint blinks
  const hint = useSharedValue(1);
  useEffect(() => {
    if (!still) {
      hint.set(
        withRepeat(
          withSequence(
            withTiming(1, { duration: 600 }),
            withTiming(0.45, { duration: 0 }),
            withTiming(0.45, { duration: 600 }),
            withTiming(1, { duration: 0 })
          ),
          -1
        )
      );
    }
  }, [hint, still]);
  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.value }));

  // The prize card shoots out of the tray: a speck there, flying down and
  // growing past full size, then settling
  const machineTop = useSharedValue(0);
  const cardMid = useSharedValue(0);
  const cardIn = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (phase !== 'revealed' || still) return;
    cardIn.set(0);
    cardIn.set(withTiming(1, { duration: 560 }));
    haptics.thump();
  }, [phase, still, cardIn]);
  const cardStyle = useAnimatedStyle(() => {
    const dy = machineTop.value + MACHINE.tray.y * k - cardMid.value;
    const p = cardIn.value;
    return {
      opacity: interpolate(p, [0, 0.1, 1], [0, 1, 1]),
      transform: [
        { translateY: interpolate(p, [0, 0.1, 0.7, 1], [dy, dy, -16, 0]) },
        { scale: interpolate(p, [0, 0.1, 0.7, 1], [0.06, 0.1, 1.06, 1]) },
      ],
    };
  });

  const popDone = useCallback(() => {
    setPopping(false);
    if (prizeRef.current) reveal(prizeRef.current);
  }, [reveal]);

  // ---------------------------------------------------------------- what shows
  const waiting = roll?.state === 'ready' || (roll?.state === 'rolled' && !roll.seen);
  const flash = prize && (phase === 'landed' || phase === 'revealed') ? RARITY_COLOR[prize.rarity] : null;
  const won = prize && phase === 'revealed' ? prize : null;
  // Coins won: out of their row and out of the tray from the moment the reel stops
  const coinsOut = prize?.item_id === null && (phase === 'landed' || phase === 'revealed') ? prize : null;
  const entry = won?.item_id ? findShopEntry(won.item_id) : undefined;
  const canPull = phase === 'idle' && waiting;

  // The gesture keeps the first callback it saw, so it starts the latest start() through a ref
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });
  const onPulled = useCallback(() => {
    startRef.current();
  }, []);

  // The knob follows the finger down; let go far enough down and it
  // springs back up as the reel goes, otherwise it just springs back
  const travel = (MACHINE.lever.downY - MACHINE.lever.topY) * k;
  const lever = usePanGesture({
    enabled: canPull,
    activeOffsetY: 4,
    onUpdate: (e) => {
      'worklet';
      pull.set(Math.min(1, Math.max(0, e.translationY / travel)));
    },
    onFinalize: () => {
      'worklet';
      const far = pull.get() >= PULL_ENOUGH;
      pull.set(withTiming(0, { duration: 380 }));
      if (far) scheduleOnRN(onPulled);
    },
  });
  // Screen readers can't drag: their double tap pulls it all the way
  function pullForMe() {
    if (!canPull) return;
    if (!still) pull.set(withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 380 })));
    start();
  }

  const canWear = entry?.kind === 'clothing' || entry?.kind === 'pet';

  return (
    <View style={StyleSheet.absoluteFill}>
      <Reanimated.View style={[styles.backdrop, backdropStyle]} />
      <Reanimated.View style={[styles.clip, clipStyle]}>
        <Reanimated.View
          style={[
            styles.screen,
            { width, height, paddingTop: insets.top + Spacing.two, paddingBottom: insets.bottom + Spacing.three },
            pageStyle,
          ]}>
          <View style={styles.head}>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
              <ThemedText style={styles.closeText}>✕</ThemedText>
            </Pressable>
            <ThemedText style={styles.title}>Daily Roll</ThemedText>
            <CoinBalance balance={shownBalance ?? balance} color={INK} />
          </View>
          {today !== null && goal && (
            <ThemedText type="small" style={styles.muted}>
              Goal reached! {today.toLocaleString()} / {goal.today.toLocaleString()} steps
            </ThemedText>
          )}

          <View onLayout={(e) => machineTop.set(e.nativeEvent.layout.y)}>
            <MachineShadow k={k} bob={bob} shake={shake} />
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel="Pull the prize machine's lever"
              accessibilityState={{ disabled: !canPull }}
              accessibilityActions={[{ name: 'activate' }]}
              onAccessibilityAction={pullForMe}>
              <Reanimated.View style={machineStyle}>
                <PrizeMachine
                  k={k}
                  tiles={tiles}
                  position={position}
                  pull={pull}
                  lights={lights}
                  clock={clock}
                  flash={flash}
                  hiddenTile={popping || coinsOut ? stop : -1}
                  wearer={wearer}
                />
                {popping && prize && (
                  <PrizePop
                    k={k}
                    tile={tileFor(prize)}
                    color={RARITY_COLOR[prize.rarity]}
                    wearer={wearer}
                    clock={clock}
                    onDone={popDone}
                  />
                )}
                {coinsOut && !still && (
                  <Burst k={k} kind="coins" count={coinsOut.coins === 500 ? 26 : coinsOut.coins === 250 ? 14 : 7} />
                )}
                {won && !still && <Bursts prize={won} k={k} />}
                {/* Where a finger grabs the lever: the arm and knob, generously */}
                <GestureDetector gesture={lever}>
                  <View
                    style={[
                      styles.lever,
                      {
                        left: (MACHINE.w - 22) * k,
                        top: (MACHINE.lever.topY - 12) * k,
                        width: 22 * k,
                        height: (MACHINE.lever.baseY - MACHINE.lever.topY + 24) * k,
                      },
                    ]}
                  />
                </GestureDetector>
              </Reanimated.View>
            </View>
          </View>

          {phase === 'idle' && waiting && (
            <Reanimated.View style={hintStyle}>
              <ThemedText style={styles.hint}>Pull the lever to roll!</ThemedText>
            </Reanimated.View>
          )}
          {!waiting && phase === 'idle' && (
            <ThemedText type="small" style={styles.muted}>
              {roll?.state === 'rolled' ? 'You’ve rolled today. Come back tomorrow.' : 'Reach today’s goal to roll.'}
            </ThemedText>
          )}
          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          {won && (
            <Reanimated.View
              onLayout={(e) => cardMid.set(e.nativeEvent.layout.y + e.nativeEvent.layout.height / 2)}
              style={[styles.card, { borderColor: RARITY_COLOR[won.rarity] }, cardStyle]}>
              <View style={styles.cardRow}>
                <View style={[styles.cardIcon, { backgroundColor: RARITY_COLOR[won.rarity] + '38' }]}>
                  <PrizeArt tile={tileFor(won)} wearer={wearer} coinK={2} clock={clock} />
                </View>
                <View style={styles.cardText}>
                  <ThemedText style={[styles.tag, { color: RARITY_COLOR[won.rarity] }]}>
                    {RARITY_LABEL[won.rarity]}
                  </ThemedText>
                  <ThemedText style={styles.name}>{prizeName(won, boardItemName)}</ThemedText>
                </View>
              </View>
              <View style={styles.buttons}>
                {canWear && won.item_id && (
                  <CardButton
                    title="Wear it"
                    primary
                    onPress={() => router.replace({ pathname: '/avatar', params: { wear: won.item_id! } })}
                  />
                )}
                <CardButton title="Done" primary={!canWear} onPress={close} />
              </View>
            </Reanimated.View>
          )}
        </Reanimated.View>
      </Reanimated.View>
    </View>
  );
}

/** Sparkles for Rare and up, and the puff as the card comes out (coins spray out before). */
function Bursts({ prize, k }: { prize: Prize; k: number }) {
  const r = prize.rarity;
  return (
    <>
      <Burst k={k} kind="puff" count={12} />
      {r === 'rare' && <Burst k={k} kind="sparkle" count={8} color="#a9d0ff" />}
      {r === 'epic' && <Burst k={k} kind="sparkle" count={18} color="#d7b6ff" />}
      {r === 'legendary' && (
        <>
          <Burst k={k} kind="sparkle" count={30} color="#ffe27a" />
          <Burst k={k} kind="sparkle" count={16} color="#ffffff" />
        </>
      )}
    </>
  );
}

function CardButton({ title, primary, onPress }: { title: string; primary: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, primary ? styles.primary : styles.secondary, pressed && styles.pressed]}>
      <ThemedText style={[styles.buttonText, { color: primary ? '#3a2400' : INK }]}>{title}</ThemedText>
    </Pressable>
  );
}

/** The shadow's rows, in machine pixels: [left, width], 2 pixels tall each. */
const SHADOW_ROWS = [
  [14, 84],
  [6, 100],
  [14, 84],
] as const;

/**
 * The machine's shadow on the floor, under its feet. It stays on the floor
 * while the machine bobs, a little narrower and fainter as it rises, and
 * follows it side to side when it shakes.
 */
function MachineShadow({ k, bob, shake }: { k: number; bob: SharedValue<number>; shake: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const up = Math.min(1, Math.max(0, -bob.value / (BOUNCE_PX * k))); // 0 on the floor, 1 at the top of a bounce
    // Higher up, the shadow shrinks and fades
    return {
      opacity: 0.7 - 0.4 * up,
      transform: [{ translateX: shake.value }, { scaleX: 1 - 0.3 * up }, { scaleY: 1 - 0.2 * up }],
    };
  });
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[styles.shadow, { top: 144 * k, width: MACHINE.w * k, height: 6 * k }, style]}>
      {SHADOW_ROWS.map(([x, w], i) => (
        <View key={i} style={[styles.shadowRow, { left: x * k, top: i * 2 * k, width: w * k, height: 2 * k }]} />
      ))}
    </Reanimated.View>
  );
}

/** The wallet counting up to its new balance over 0.9 s. */
function countUp(from: number, to: number, set: (n: number | null) => void) {
  const start = Date.now();
  const id = setInterval(() => {
    const u = Math.min(1, (Date.now() - start) / 900);
    set(Math.round(from + (to - from) * (1 - Math.pow(1 - u, 3))));
    if (u === 1) {
      clearInterval(id);
      set(null);
    }
  }, 30);
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  clip: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: BG,
  },
  screen: {
    position: 'absolute',
    backgroundColor: BG,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  shadow: {
    position: 'absolute',
    left: 0,
  },
  shadowRow: {
    position: 'absolute',
    backgroundColor: '#05020a',
  },
  head: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  closeText: {
    color: INK,
    fontSize: 15,
  },
  title: {
    flex: 1,
    color: INK,
    fontFamily: GameFont.bold,
    fontSize: 20,
  },
  muted: {
    color: MUTED,
  },
  hint: {
    color: YELLOW,
    fontFamily: GameFont.bold,
    fontSize: 18,
  },
  error: {
    color: '#ff8a80',
    textAlign: 'center',
  },
  lever: {
    position: 'absolute',
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 2,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  cardIcon: {
    width: 72,
    height: 72,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
    gap: Spacing.half,
  },
  tag: {
    fontFamily: GameFont.bold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  name: {
    color: INK,
    fontFamily: GameFont.bold,
    fontSize: 22,
    lineHeight: 26,
  },
  buttons: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  button: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primary: {
    backgroundColor: YELLOW,
  },
  secondary: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  buttonText: {
    fontFamily: GameFont.bold,
    fontSize: 16,
  },
  pressed: {
    opacity: 0.7,
  },
});
