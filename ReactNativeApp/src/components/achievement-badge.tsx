import { Canvas, Image } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';

import type { Achievement, AchievementKind } from '@/achievements/achievements';
import { CRISP, useSprite } from '@/avatar/Avatar';
import { ThemedText } from '@/components/themed-text';

// The badge art (scripts/generate-avatar-sprites.py): one medal frame and
// a symbol per kind, 22 x 22 each, drawn one on top of the other, with
// grey copies for achievements not earned yet. The number goes under it.
const SIZE = 22;

const FRAME = {
  earned: require('@/assets/badges/badge_frame.png'),
  locked: require('@/assets/badges/badge_frame_locked.png'),
};

const SYMBOLS: Record<AchievementKind, { earned: number; locked: number }> = {
  day_steps: {
    earned: require('@/assets/badges/badge_day_steps.png'),
    locked: require('@/assets/badges/badge_day_steps_locked.png'),
  },
  total_steps: {
    earned: require('@/assets/badges/badge_total_steps.png'),
    locked: require('@/assets/badges/badge_total_steps_locked.png'),
  },
  streak: {
    earned: require('@/assets/badges/badge_streak.png'),
    locked: require('@/assets/badges/badge_streak_locked.png'),
  },
  quests: {
    earned: require('@/assets/badges/badge_quests.png'),
    locked: require('@/assets/badges/badge_quests_locked.png'),
  },
};

function Piece({ source, scale }: { source: number; scale: number }) {
  const image = useSprite(source);
  if (!image) return null;
  return (
    <Image
      image={image}
      x={0}
      y={0}
      width={SIZE * scale}
      height={SIZE * scale}
      fit="fill"
      sampling={CRISP}
    />
  );
}

/** One achievement's badge, with its number ("1M") underneath. */
export function AchievementBadge({
  achievement,
  earned,
  scale = 2,
  color,
}: {
  achievement: Achievement;
  earned: boolean;
  /** Whole number, like Avatar. */
  scale?: number;
  /** The number's color, over the app theme's (the player card's map ink). */
  color?: string;
}) {
  const look = earned ? 'earned' : 'locked';
  return (
    <View
      style={styles.badge}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${achievement.name}${earned ? '' : ', locked'}`}>
      <Canvas style={{ width: SIZE * scale, height: SIZE * scale }}>
        <Piece source={FRAME[look]} scale={scale} />
        <Piece source={SYMBOLS[achievement.kind][look]} scale={scale} />
      </Canvas>
      <ThemedText
        type="code"
        themeColor={earned ? 'text' : 'textSecondary'}
        style={[styles.number, color ? { color } : null]}
        numberOfLines={1}>
        {achievement.short}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
  },
  number: {
    fontSize: 11,
    lineHeight: 14,
  },
});
