import { useRouter } from 'expo-router';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { listRollPool } from '@/api/roll';
import { ItemIcon } from '@/avatar/ItemIcon';
import type { AvatarConfig } from '@/avatar/types';
import { CoinTile, MiniMachine, useMachineClock } from '@/components/prize-machine';
import { ThemedText } from '@/components/themed-text';
import { GameFont, Spacing } from '@/constants/theme';
import * as haptics from '@/lib/haptics';
import { boardItemName, findShopEntry } from '@/lib/shop-entries';
import { buildReel, type Prize, prizeName, type RollState, type Tile } from '@/roll/roll';

/** Tapped, the small machine grows this much and shuffles before the roll screen expands out of it. */
const WINDUP_SCALE = 1.3;
const GROW_MS = 160;
/** The shuffle: a wobble side to side, in degrees, each step this long. */
const SHUFFLE = [-9, 9, -7, 7, -4, 0];
const SHUFFLE_MS = 55;

// The goal line under Today's step count (step-tracker-daily-roll.txt,
// section 5). Reaching the goal gives the daily roll, not 150 coins: the
// line says the roll is coming, and then shows the prize. While the roll
// waits, RollReady offers the small machine just above the groups
// (tapping it opens the roll screen, it doesn't roll).

export function RollLine({
  roll,
  progress,
  goal,
  sharing,
  reached,
  wearer,
  color,
}: {
  roll: RollState;
  /** 0 to 1 of today's goal */
  progress: number;
  goal: number;
  sharing: boolean;
  reached: boolean;
  wearer: AvatarConfig;
  /** Text on the map's sky */
  color: string;
}) {
  const ink = { color };
  const percent = `${Math.round(progress * 100)}% of ${goal.toLocaleString()} goal`;

  if (roll?.state === 'rolled' && roll.seen) {
    return <TodaysPrize prize={roll} wearer={wearer} color={color} />;
  }
  // No prize yet: not reached, not loaded yet, not sharing (no roll without
  // it), or waiting (the pill above the groups offers it)
  return (
    <ThemedText type="small" style={ink}>
      {percent}
      {sharing && (reached ? ' · Goal reached!' : ' · Daily roll at goal')}
    </ThemedText>
  );
}

/** "Goal reached! Tap to roll" with the small machine, while the roll waits
 *  (or was rolled but closed before the prize showed); nothing otherwise. */
export function RollReady({ roll, wearer }: { roll: RollState; wearer: AvatarConfig }) {
  const router = useRouter();
  const machine = useRef<ComponentRef<typeof View>>(null);
  const still = useReducedMotion();
  const busy = useRef(false);
  const scale = useSharedValue(1);
  const tilt = useSharedValue(0);
  const windup = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${tilt.value}deg` }],
  }));
  if (roll === null || roll.state === 'locked' || (roll.state === 'rolled' && roll.seen)) return null;
  const unseen = roll.state === 'rolled';

  // The machine grows a bit and shuffles, then the roll screen grows out of
  // it, so the screen is told where the grown machine is
  function openRoll() {
    const node = machine.current;
    if (!node) return router.push('/roll');
    if (busy.current) return;
    busy.current = true;
    node.measureInWindow((x: number, y: number, w: number, h: number) => {
      const s = still ? 1 : WINDUP_SCALE;
      const from = [x - (w * (s - 1)) / 2, y - (h * (s - 1)) / 2, w * s, h * s].join(',');
      const go = () => {
        haptics.lift();
        router.push({ pathname: '/roll', params: { from } });
        // Back to normal under the roll screen, for when it closes
        setTimeout(() => {
          scale.set(1);
          tilt.set(0);
          busy.current = false;
        }, 600);
      };
      if (still) return go();
      haptics.tap();
      scale.set(withTiming(WINDUP_SCALE, { duration: GROW_MS, easing: Easing.out(Easing.back(2)) }));
      tilt.set(
        withSequence(
          withTiming(0, { duration: GROW_MS }),
          ...SHUFFLE.map((deg, i) =>
            withTiming(deg, { duration: SHUFFLE_MS }, (done) => {
              if (done && i === SHUFFLE.length - 1) scheduleOnRN(go);
            })
          )
        )
      );
    });
  }
  return (
    <Pressable
      onPress={openRoll}
      accessibilityRole="button"
      accessibilityLabel={unseen ? 'Your daily roll prize, opens the prize machine' : 'Daily roll ready, opens the prize machine'}
      style={({ pressed }) => [styles.ready, pressed && styles.pressed]}>
      <ThemedText style={styles.readyText}>
        Goal reached! <ThemedText style={styles.cta}>{unseen ? 'Tap to see your prize' : 'Tap to roll'}</ThemedText>
      </ThemedText>
      <View ref={machine} collapsable={false}>
        <Reanimated.View style={windup}>
          <WaitingMachine wearer={wearer} />
        </Reanimated.View>
      </View>
    </Pressable>
  );
}

/** The small machine, its reel showing what this player could win. */
function WaitingMachine({ wearer }: { wearer: AvatarConfig }) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  useEffect(() => {
    listRollPool()
      .then((pool) => setTiles(buildReel(pool).slice(0, 8)))
      .catch(() => setTiles(buildReel([]).slice(0, 8)));
  }, []);
  return <MiniMachine tiles={tiles} wearer={wearer} />;
}

/** "Today's prize:" with the item or the coins. */
function TodaysPrize({ prize, wearer, color }: { prize: Prize; wearer: AvatarConfig; color: string }) {
  const clock = useMachineClock();
  const entry = prize.item_id ? findShopEntry(prize.item_id) : undefined;
  return (
    <View
      style={styles.prize}
      accessible
      accessibilityLabel={`Today's prize: ${prizeName(prize, boardItemName)}`}>
      <ThemedText type="small" style={{ color }}>
        Today’s prize:
      </ThemedText>
      {prize.item_id === null ? (
        <CoinTile coins={100} k={1} clock={clock} />
      ) : (
        entry?.kind === 'clothing' && (
          <ItemIcon
            slot={entry.slot}
            id={entry.id}
            color={entry.slot === 'face' ? wearer.skin : wearer.hairColor}
            size={24}
            accessibilityLabel=""
          />
        )
      )}
      <ThemedText type="smallBold" style={{ color }}>
        {prizeName(prize, boardItemName)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  ready: {
    alignSelf: 'center',
    zIndex: 1, // the machine grows past the pill when tapped
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 14,
    backgroundColor: '#5b2a86',
    borderWidth: 2,
    borderColor: '#ff5fa2',
  },
  readyText: {
    color: '#ffffff',
    fontSize: 15,
  },
  cta: {
    color: '#ffd23f',
    fontFamily: GameFont.bold,
    fontSize: 15,
  },
  prize: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  pressed: {
    opacity: 0.8,
  },
});
