import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { listRollPool } from '@/api/roll';
import { ItemIcon } from '@/avatar/ItemIcon';
import type { AvatarConfig } from '@/avatar/types';
import { CoinTile, MiniMachine, useMachineClock } from '@/components/prize-machine';
import { ThemedText } from '@/components/themed-text';
import { GameFont, Spacing } from '@/constants/theme';
import { boardItemName, findShopEntry } from '@/lib/shop-entries';
import { buildReel, type Prize, prizeName, type RollState, type Tile } from '@/roll/roll';

// The goal line under Today's step count (step-tracker-daily-roll.txt,
// section 5). Reaching the goal gives the daily roll, not 150 coins: the
// line says the roll is coming, offers the small machine when it's
// waiting (tapping it opens the roll screen, it doesn't roll), and then
// shows the prize.

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
  const router = useRouter();
  const ink = { color };
  const percent = `${Math.round(progress * 100)}% of ${goal.toLocaleString()} goal`;

  if (roll === null || roll.state === 'locked') {
    // No roll to show (not reached, not loaded yet, or not sharing: no roll without it)
    return (
      <ThemedText type="small" style={ink}>
        {percent}
        {sharing && (reached && roll === null ? ' · Goal reached!' : ' · Daily roll at goal')}
      </ThemedText>
    );
  }
  if (roll.state === 'rolled' && roll.seen) {
    return <TodaysPrize prize={roll} wearer={wearer} color={color} />;
  }
  // Waiting, or rolled but closed before the prize showed
  const unseen = roll.state === 'rolled';
  return (
    <Pressable
      onPress={() => router.push('/roll')}
      accessibilityRole="button"
      accessibilityLabel={unseen ? 'Your daily roll prize, opens the prize machine' : 'Daily roll ready, opens the prize machine'}
      style={({ pressed }) => [styles.ready, pressed && styles.pressed]}>
      <ThemedText style={styles.readyText}>
        Goal reached! <ThemedText style={styles.cta}>{unseen ? 'Tap to see your prize' : 'Tap to roll'}</ThemedText>
      </ThemedText>
      <WaitingMachine wearer={wearer} />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 14,
    backgroundColor: '#ffd23f',
    borderWidth: 2,
    borderColor: '#c98f00',
  },
  readyText: {
    color: '#3b2600',
    fontSize: 15,
  },
  cta: {
    color: '#ffffff',
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
