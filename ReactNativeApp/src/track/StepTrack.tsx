import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Avatar, PixelSprite } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

import { assignLanes, formatSteps, GOAL, positionFor, scaleMax, ticksFor } from './scale';

export type Walker = {
  id: string;
  name: string;
  steps: number;
  /** Raw JSON from the database (or a profile avatar); normalized before drawing. */
  avatar: unknown;
  isMe: boolean;
};

const SCALE = 2; // avatar pixel scale (whole number)
const SPRITE_W = 32 * SCALE;
const SPRITE_H = 48 * SCALE;
const LANE_OFFSET = 72; // how far each extra lane is raised: enough that a name label sits below the face behind it
const LABEL_H = 18;

const FLAG = require('@/assets/track/flag_goal.png');
const FLAG_W = 12;
const FLAG_H = 24;
const FLAG_POLE_X = 1.5; // pole center within the flag sprite, in sprite pixels

const GRASS = '#5aa850';
const GRASS_EDGE = '#3a7a34';

function WalkerSprite({ walker, x, lane }: { walker: Walker; x: number; lane: number }) {
  const theme = useTheme();
  // Slide to the new position whenever steps or the scale change
  const [anim] = useState(() => new Animated.Value(x));
  useEffect(() => {
    Animated.timing(anim, { toValue: x, duration: 600, useNativeDriver: true }).start();
  }, [anim, x]);

  const name = walker.isMe ? 'You' : walker.name;
  return (
    <Animated.View
      accessible
      accessibilityLabel={`${name}: ${walker.steps.toLocaleString()} steps`}
      style={[
        styles.walker,
        { bottom: lane * LANE_OFFSET, zIndex: 100 - lane, transform: [{ translateX: anim }] },
      ]}>
      <ThemedText
        numberOfLines={1}
        type={walker.isMe ? 'smallBold' : 'small'}
        // A soft pill keeps the name readable when it overlaps someone behind
        style={[styles.walkerLabel, { backgroundColor: theme.background + 'D9' }]}>
        {name}
      </ThemedText>
      <Avatar config={normalizeAvatar(walker.avatar)} scale={SCALE} accessibilityLabel={name} />
    </Animated.View>
  );
}

/**
 * A 0-to-10,000 scale with each person's character standing at their
 * step count. The scale grows past 10,000 when anyone passes it; the
 * goal flag stays at 10,000 and slides left.
 */
export function StepTrack({ walkers }: { walkers: Walker[] }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  const highest = walkers.reduce((m, w) => Math.max(m, w.steps), 0);
  const max = scaleMax(highest);

  const xs = walkers.map((w) => positionFor(w.steps, max, width, SPRITE_W));
  const lanes = assignLanes(xs, SPRITE_W);
  const laneCount = Math.max(1, ...lanes.map((l) => l + 1));
  const stageHeight = SPRITE_H + LABEL_H + (laneCount - 1) * LANE_OFFSET;

  // Flag and ticks are placed at a character's CENTER line
  const centerX = (value: number) => positionFor(value, max, width, SPRITE_W) + SPRITE_W / 2;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {/* Characters, with the goal flag planted behind them */}
      <View style={{ height: stageHeight }}>
        {width > 0 && (
          <View
            style={[styles.flag, { left: centerX(GOAL) - FLAG_POLE_X * SCALE }]}
            pointerEvents="none">
            <PixelSprite
              source={FLAG}
              width={FLAG_W}
              height={FLAG_H}
              scale={SCALE}
              accessibilityLabel="Goal flag at 10,000 steps"
            />
          </View>
        )}
        {width > 0 &&
          walkers.map((w, i) => <WalkerSprite key={w.id} walker={w} x={xs[i]} lane={lanes[i]} />)}
      </View>

      {/* The ground */}
      <View style={styles.ground} />

      {/* Ticks and labels */}
      <View style={styles.ticks}>
        {width > 0 &&
          ticksFor(max).map((v) => {
            const isGoal = v === GOAL;
            const color = isGoal ? theme.danger : theme.textSecondary;
            return (
              <View key={v} style={[styles.tick, { left: centerX(v) - 20 }]}>
                <View style={[styles.tickMark, { height: isGoal ? 12 : 6, backgroundColor: color }]} />
                <ThemedText
                  type={isGoal ? 'smallBold' : 'small'}
                  style={[styles.tickLabel, { color }]}>
                  {isGoal ? 'GOAL' : formatSteps(v)}
                </ThemedText>
              </View>
            );
          })}
      </View>

      {max > GOAL && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.extended}>
          Scale extended to {max.toLocaleString()} steps
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  walker: {
    position: 'absolute',
    left: 0,
    width: SPRITE_W,
    alignItems: 'center',
  },
  walkerLabel: {
    height: LABEL_H,
    fontSize: 11,
    lineHeight: LABEL_H,
    paddingHorizontal: 4,
    borderRadius: LABEL_H / 2,
    overflow: 'hidden',
    maxWidth: SPRITE_W + 16,
  },
  flag: {
    position: 'absolute',
    bottom: 0,
    zIndex: 0,
  },
  ground: {
    height: 8,
    borderRadius: 4,
    backgroundColor: GRASS,
    borderBottomWidth: 3,
    borderBottomColor: GRASS_EDGE,
  },
  ticks: {
    height: 40,
  },
  tick: {
    position: 'absolute',
    width: 40,
    alignItems: 'center',
  },
  tickMark: {
    width: 2,
  },
  tickLabel: {
    fontSize: 11,
    lineHeight: 16,
  },
  extended: {
    textAlign: 'right',
    fontSize: 11,
  },
});
