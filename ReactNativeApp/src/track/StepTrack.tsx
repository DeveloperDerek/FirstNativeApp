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
import { ThemedButton } from '@/components/themed-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

import { assignLanes, centerFor, formatSteps, GOAL, roadWidth, scaleMax, ticksFor } from './scale';
import type { MapTheme } from './themes';

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

// Map art. Sizes match the exports in assets/maps (drawn at 256 x 80,
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

const LANDMARK_W = 128;
const LANDMARK_H = 144;
// Landmarks stand on the road and reach above the street art, so the
// scene is tall enough for them; the extra space at the top is sky.
const SCENE_H = Math.max(TILE_H, ROAD_H + LANDMARK_H);

const FLAG = require('@/assets/track/flag_goal.png');
const FLAG_W = 12;
const FLAG_H = 24;
const FLAG_POLE_X = 1.5; // pole center within the flag sprite, in sprite pixels

/**
 * Landmarks up to the end of the road. The theme's last landmark (the
 * "far" one at 15,000) repeats every 5,000 after that, so far walkers
 * always have something to reach.
 */
function landmarksFor(theme: MapTheme, max: number) {
  const base = theme.landmarks.filter((l) => l.steps <= Math.min(max, 15_000));
  const far = theme.landmarks.find((l) => l.steps === 15_000);
  const extra = [];
  for (let s = 20_000; far && s <= max; s += 5_000) {
    extra.push({ ...far, steps: s, label: `${far.label} at ${s.toLocaleString()} steps` });
  }
  return [...base, ...extra];
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
 * A themed road wider than the screen, scrolling sideways. Every 1,000
 * steps is 100 points of road; the road ends at 10,000 until someone
 * passes it, then extends in 5,000s. Nobody moves when it grows.
 *
 * It runs edge to edge with no box: the sky color fills behind the
 * scenery and everything below the road is the theme's ground color, so
 * it blends into a screen painted in the same two colors.
 */
export function StepTrack({ walkers, theme }: { walkers: Walker[]; theme: MapTheme }) {
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
      {/* Sky color behind the scenery. No border, no rounding. */}
      <View
        onLayout={(e) => setViewport(e.nativeEvent.layout.width)}
        style={{ backgroundColor: theme.sky }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          // No rubber-band past the ends, so the sky never shows under the road
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={() => {
            userScrolled.current = true;
          }}
          accessibilityLabel="Step road. Swipe left or right to scroll.">
          <View style={{ width }}>
            {/* Village street + road + characters */}
            <View style={{ width, height: SCENE_H }}>
              <View style={styles.tiles} importantForAccessibility="no-hide-descendants">
                {Array.from({ length: tileCount }, (_, i) => (
                  <Image
                    key={i}
                    source={theme.tiles[i % theme.tiles.length]}
                    style={{ width: TILE_W, height: TILE_H }}
                    resizeMode="stretch"
                    accessibilityElementsHidden
                  />
                ))}
              </View>

              {landmarksFor(theme, max).map((l) => (
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

            {/* Distance markers, drawn straight onto the ground */}
            <View style={[styles.markers, { width, backgroundColor: theme.ground }]}>
              {ticksFor(max).map((v) => {
                const isGoal = v === GOAL;
                const color = theme.ink;
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

      {/* Jump buttons sit on the ground color */}
      <View style={[styles.buttons, { backgroundColor: theme.ground }]}>
        {me && (
          <ThemedButton theme={theme} title="Find me" onPress={() => scrollToSteps(me.steps)} />
        )}
        {leader && leader.id !== me?.id && (
          <ThemedButton theme={theme} title="Leader" onPress={() => scrollToSteps(leader.steps)} />
        )}
        <ThemedButton theme={theme} title="Start" onPress={() => scrollToSteps(0)} />
      </View>

      {max > GOAL && (
        <ThemedText
          type="small"
          style={[styles.extended, { color: theme.ink, backgroundColor: theme.ground }]}>
          Road extended to {max.toLocaleString()} steps
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: {
    position: 'absolute',
    bottom: 0, // the road sits at the bottom of the scene
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
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  extended: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
});
