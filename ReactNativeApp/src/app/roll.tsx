import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Reanimated, {
  interpolate,
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

// The daily roll screen (step-tracker-daily-roll.txt, section 5): tap the
// machine, the reel spins and stops on the prize the server already
// picked, and the prize card pops out of the tray. Opened from the small
// machine on Today.

const BG = '#1b1d2b';
const INK = '#f4f1ff';
const MUTED = '#b9b6d6';
const CARD = '#262a3d';
const YELLOW = '#ffd23f';

/** idle: waiting for the tap; asking: the server is picking; spinning; then the reveal. */
type Phase = 'idle' | 'asking' | 'spinning' | 'landed' | 'revealed';

export default function RollScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const still = useReducedMotion();
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const { roll, setRoll, today, goal } = useSteps();
  const { balance, refreshBalance } = useWallet();
  const { refreshOwned } = useMapTheme();
  const wearer = profile?.avatar ?? DEFAULT_AVATAR;

  // Whole points per art pixel: 3 on most phones
  const k = Math.max(2, Math.min(3, Math.floor((Math.min(width, 480) - 2 * Spacing.four) / MACHINE.w)));
  const clock = useMachineClock();

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
  // The machine bobs while it waits, and shakes when it stops
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
      Haptics.impactAsync(
        isBigWin(p) ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium
      ).catch(() => {});
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
      // An item grows out of the window first; coins go straight to the reveal
      if (p.item_id !== null) setPopping(true);
      else setTimeout(() => reveal(p), 420);
    },
    [still, k, reveal, lights, shake]
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

  const spinFrames = useFrameCallback(({ timestamp }) => {
    const p = plan.value;
    if (!p) return;
    if (startedAt.value < 0) startedAt.value = timestamp;
    const t = timestamp - startedAt.value;
    position.value = reelPosition(t, p);
    if (t >= spinTotalMs(p)) {
      plan.value = null;
      scheduleOnRN(onSpinEnd);
    }
  }, false);

  // Frames run only while the reel spins
  useEffect(() => {
    if (phase !== 'spinning') spinFrames.setActive(false);
  }, [phase, spinFrames]);

  async function tap() {
    if (phase !== 'idle') return;
    setPhase('asking');
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!still) pull.set(withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 380 })));

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
    bob.set(phase === 'idle' && !still ? withRepeat(withTiming(-k, { duration: 800 }), -1, true) : withTiming(0));
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
  const entry = won?.item_id ? findShopEntry(won.item_id) : undefined;
  const canWear = entry?.kind === 'clothing' || entry?.kind === 'pet';

  return (
    <View style={[styles.screen, { paddingTop: insets.top + Spacing.two, paddingBottom: insets.bottom + Spacing.three }]}>
      <View style={styles.head}>
        <Pressable
          onPress={() => router.back()}
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
        <Pressable
          onPress={tap}
          disabled={phase !== 'idle' || !waiting}
          accessibilityRole="button"
          accessibilityLabel="Roll the prize machine"
          accessibilityState={{ disabled: phase !== 'idle' || !waiting }}>
          <Reanimated.View style={machineStyle}>
            <PrizeMachine
              k={k}
              tiles={tiles}
              position={position}
              pull={pull}
              lights={lights}
              clock={clock}
              flash={flash}
              hiddenTile={popping ? stop : -1}
              wearer={wearer}
            />
            {popping && prize && (
              <PrizePop
                k={k}
                tile={tileFor(prize)}
                color={RARITY_COLOR[prize.rarity]}
                wearer={wearer}
                onDone={popDone}
              />
            )}
            {won && !still && <Bursts prize={won} k={k} />}
          </Reanimated.View>
        </Pressable>
      </View>

      {phase === 'idle' && waiting && (
        <Reanimated.View style={hintStyle}>
          <ThemedText style={styles.hint}>Tap the machine to roll!</ThemedText>
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
            <CardButton title="Done" primary={!canWear} onPress={() => router.back()} />
          </View>
        </Reanimated.View>
      )}
    </View>
  );
}

/** Sparkles for Rare and up, a spray of coins for coins, and the puff as the card comes out. */
function Bursts({ prize, k }: { prize: Prize; k: number }) {
  const r = prize.rarity;
  return (
    <>
      <Burst k={k} kind="puff" count={12} />
      {r === 'coins' && <Burst k={k} kind="coins" count={prize.coins === 500 ? 26 : prize.coins === 250 ? 14 : 7} />}
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
  screen: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
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
