import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
} from 'react-native';

import { Avatar, PixelSprite } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';

import { assignLanes, centerFor, formatSteps, GOAL, roadWidth, scaleMax, ticksFor } from './scale';

export type Walker = {
  id: string;
  name: string;
  steps: number;
  /** Raw JSON from the database (or a profile avatar); normalized before drawing. */
  avatar: unknown;
  isMe: boolean;
};

// Characters
const SCALE = 2; // avatar pixel scale (whole number)
const SPRITE_W = 32 * SCALE;
const LABEL_H = 18;

// Village. Sizes match the exports in assets/village (drawn at 256 x 80,
// shown at 2 points per pixel, the same pixel size as the characters).
const TILE_W = 512;
const TILE_H = 160;
const ROAD_H = 48; // bottom 24 drawing rows are road
const ROAD_BASE = 6; // feet sit this far above the bottom
const LANE_OFFSET = 14; // each lane stands a bit further back
const MAX_LANES = 3; // 3 x 14 fits inside the 48-point road
// Characters further back also step a little to the side, so two people
// at the same count don't merge into one figure.
const LANE_SHIFT = [0, 22, -22];
const SKY = '#bfe6ff';
const MARKERS_BG = '#3a2a2a';

const TILES = [
  require('@/assets/village/village_tile_a.png'),
  require('@/assets/village/village_tile_b.png'),
];

const LANDMARK_W = 128;
const LANDMARK_H = 144;
const WINDMILL = require('@/assets/village/landmark_windmill.png');
const LANDMARKS: { steps: number; image: number; label: string }[] = [
  { steps: 0, label: 'Village gate', image: require('@/assets/village/landmark_gate.png') },
  { steps: 5_000, label: 'Bakery', image: require('@/assets/village/landmark_bakery.png') },
  {
    steps: 10_000,
    label: 'Town hall, the 10,000 step goal',
    image: require('@/assets/village/landmark_townhall.png'),
  },
];

const FLAG = require('@/assets/track/flag_goal.png');
const FLAG_W = 12;
const FLAG_H = 24;
const FLAG_POLE_X = 1.5; // pole center within the flag sprite, in sprite pixels

/** Landmarks up to the end of the road; a windmill every 5,000 past 10,000. */
function landmarksFor(max: number) {
  const extra = [];
  for (let s = 15_000; s <= max; s += 5_000) {
    extra.push({ steps: s, label: `Windmill at ${s.toLocaleString()} steps`, image: WINDMILL });
  }
  return [...LANDMARKS, ...extra];
}

function WalkerSprite({ walker, x, lane }: { walker: Walker; x: number; lane: number }) {
  // Walk to the new spot whenever the step count changes
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
        {
          bottom: ROAD_BASE + lane * LANE_OFFSET,
          zIndex: 100 - lane, // nearer lanes drawn on top
          transform: [{ translateX: anim }],
        },
      ]}>
      {/* Light backing keeps names readable over buildings */}
      <ThemedText
        numberOfLines={1}
        type={walker.isMe ? 'smallBold' : 'small'}
        style={styles.walkerLabel}>
        {name}
      </ThemedText>
      <Avatar config={normalizeAvatar(walker.avatar)} scale={SCALE} accessibilityLabel={name} />
    </Animated.View>
  );
}

/**
 * A village road wider than the screen, scrolling sideways. Every 1,000
 * steps is 100 points of road; the road ends at 10,000 until someone
 * passes it, then extends in 5,000s. Nobody moves when it grows.
 */
export function StepTrack({ walkers }: { walkers: Walker[] }) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [viewport, setViewport] = useState(0);
  // Once someone scrolls by hand, stop re-centering on them.
  const userScrolled = useRef(false);

  const highest = walkers.reduce((m, w) => Math.max(m, w.steps), 0);
  const max = scaleMax(highest);
  const width = roadWidth(max);

  const baseXs = walkers.map((w) => centerFor(w.steps) - SPRITE_W / 2);
  const lanes = assignLanes(baseXs, SPRITE_W, MAX_LANES);
  const xs = baseXs.map((x, i) => x + LANE_SHIFT[lanes[i]]);

  const me = walkers.find((w) => w.isMe);
  const leader = walkers.reduce<Walker | undefined>(
    (best, w) => (!best || w.steps > best.steps ? w : best),
    undefined
  );

  const scrollToSteps = (steps: number, animated = true) =>
    scrollRef.current?.scrollTo({ x: Math.max(0, centerFor(steps) - viewport / 2), animated });

  // Open centered on me, and follow my count as it loads, until the
  // person scrolls themselves.
  const mySteps = me?.steps;
  useEffect(() => {
    if (userScrolled.current || viewport === 0 || mySteps === undefined) return;
    scrollRef.current?.scrollTo({
      x: Math.max(0, centerFor(mySteps) - viewport / 2),
      animated: false,
    });
  }, [mySteps, viewport]);

  const tileCount = Math.ceil(width / TILE_W);

  return (
    <View>
      {/* The sky does not scroll, which gives a cheap depth effect */}
      <View onLayout={(e) => setViewport(e.nativeEvent.layout.width)} style={styles.frame}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator
          onScrollBeginDrag={() => {
            userScrolled.current = true;
          }}
          accessibilityLabel="Step road. Swipe left or right to scroll.">
          <View style={{ width }}>
            {/* Village street + road + characters */}
            <View style={{ width, height: TILE_H }}>
              <View style={styles.tiles} importantForAccessibility="no-hide-descendants">
                {Array.from({ length: tileCount }, (_, i) => (
                  <Image
                    key={i}
                    source={TILES[i % TILES.length]}
                    style={{ width: TILE_W, height: TILE_H }}
                    resizeMode="stretch"
                    accessibilityElementsHidden
                  />
                ))}
              </View>

              {landmarksFor(max).map((l) => (
                <Image
                  key={l.steps}
                  source={l.image}
                  accessibilityLabel={l.label}
                  resizeMode="stretch"
                  style={[
                    styles.landmark,
                    {
                      left: centerFor(l.steps) - LANDMARK_W / 2,
                      width: LANDMARK_W,
                      height: LANDMARK_H,
                    },
                  ]}
                />
              ))}

              {/* The goal flag stays at 10,000, at the back of the road */}
              <View
                pointerEvents="none"
                style={[styles.flag, { left: centerFor(GOAL) - FLAG_POLE_X * SCALE }]}>
                <PixelSprite
                  source={FLAG}
                  width={FLAG_W}
                  height={FLAG_H}
                  scale={SCALE}
                  accessibilityLabel="Goal flag at 10,000 steps"
                />
              </View>

              {walkers.map((w, i) => (
                <WalkerSprite key={w.id} walker={w} x={xs[i]} lane={lanes[i]} />
              ))}
            </View>

            {/* Distance markers under the road */}
            <View style={[styles.markers, { width }]}>
              {ticksFor(max).map((v) => {
                const isGoal = v === GOAL;
                const color = isGoal ? '#f7c948' : '#ffffff';
                return (
                  <View key={v} style={[styles.tick, { left: centerFor(v) - 24 }]}>
                    <View style={[styles.tickMark, { backgroundColor: color }]} />
                    <ThemedText
                      type={isGoal ? 'smallBold' : 'small'}
                      style={[styles.tickLabel, { color }]}>
                      {isGoal ? 'GOAL' : formatSteps(v)}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </View>

      <View style={styles.buttons}>
        {me && (
          <Button
            title="Find me"
            size="small"
            variant="secondary"
            onPress={() => scrollToSteps(me.steps)}
          />
        )}
        {leader && leader.id !== me?.id && (
          <Button
            title="Leader"
            size="small"
            variant="secondary"
            onPress={() => scrollToSteps(leader.steps)}
          />
        )}
        <Button title="Start" size="small" variant="secondary" onPress={() => scrollToSteps(0)} />
      </View>

      {max > GOAL && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.extended}>
          Road extended to {max.toLocaleString()} steps
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: SKY,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  tiles: {
    position: 'absolute',
    flexDirection: 'row',
  },
  landmark: {
    position: 'absolute',
    bottom: ROAD_H, // sits on top of the road
  },
  flag: {
    position: 'absolute',
    bottom: ROAD_BASE + MAX_LANES * LANE_OFFSET,
  },
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
    color: '#3a2a2a',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 4,
    overflow: 'hidden',
    maxWidth: SPRITE_W + 16,
  },
  markers: {
    height: 34,
    backgroundColor: MARKERS_BG,
  },
  tick: {
    position: 'absolute',
    width: 48,
    alignItems: 'center',
  },
  tickMark: {
    width: 2,
    height: 8,
  },
  tickLabel: {
    fontSize: 11,
    lineHeight: 16,
  },
  buttons: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  extended: {
    marginTop: Spacing.one,
  },
});
