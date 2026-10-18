import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
} from 'react-native';
import Reanimated, {
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';

import { Avatar, HEADROOM, PixelSprite } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import { ThemedText } from '@/components/themed-text';

import {
  ClockHands,
  Framed,
  FrontLayer,
  HorizonLayer,
  SkyLayer,
  StreetLayer,
  useAmbientClock,
} from './ambient';
import type { Scenery } from './lighting';
import { AMBIENT_SPRITES } from './lighting.generated';
import { Minimap, MINIMAP_H } from './Minimap';
import { scrollFor } from './minimap-math';
import { PixelGlyph, STAR } from './pixel-glyph';
import {
  assignLanes,
  centerFor,
  formatSteps,
  GOAL,
  LANDMARK_EVERY,
  PX_PER_STEP,
  ROAD_PAD,
  roadWidth,
  scaleMax,
  ticksFor,
} from './scale';
import { LANDMARK_H, LANDMARK_W, ROAD_BASE, ROAD_H, TILE_H, TILE_W } from './sizes';
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

// Map art (sizes in ./sizes)
const LANE_OFFSET = 14; // each lane stands a bit further back
const MAX_LANES = 3; // 3 x 14 fits inside the 48-point road
// Characters further back also step a little to the side, so two people
// at the same count don't merge into one figure.
const LANE_SHIFT = [0, 22, -22];

// Landmarks stand on the road and reach above the street art, so the
// scene is tall enough for them; the extra space at the top is sky.
const SCENE_H = Math.max(TILE_H, ROAD_H + LANDMARK_H);

const FLAG = require('@/assets/track/flag_goal.png');
const FLAG_W = 12;
const FLAG_H = 24;
const FLAG_POLE_X = 1.5; // pole center within the flag sprite, in sprite pixels
// The avatar's feet are on its second-to-last row
const FEET_FROM_BOTTOM = 2 * SCALE;

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

function WalkerSprite({
  walker,
  x,
  lane,
  scenery,
  onSelect,
}: {
  walker: Walker;
  x: number;
  lane: number;
  /** The map's light, when it has one: a shadow on the road and the light on the character */
  scenery?: Scenery;
  onSelect?: (walker: Walker) => void;
}) {
  const shadow = scenery?.walkerShadow;
  // Stop on whole points: 0.1 point per step would leave the pixel art
  // between screen pixels, where it is drawn blurry
  const snapped = Math.round(x);
  // Walk to the new spot whenever the step count changes
  const [anim] = useState(() => new Animated.Value(snapped));
  useEffect(() => {
    Animated.timing(anim, { toValue: snapped, duration: 600, useNativeDriver: true }).start();
  }, [anim, snapped]);

  const name = walker.isMe ? 'You' : walker.name;
  return (
    <Animated.View
      style={[
        styles.walker,
        {
          bottom: ROAD_BASE + lane * LANE_OFFSET,
          zIndex: 100 - lane, // nearer lanes drawn on top
          transform: [{ translateX: anim }],
        },
      ]}>
      {/* Their shadow on the road, starting at their feet */}
      {shadow && (
        <Image
          source={shadow.source}
          resizeMode="stretch"
          style={{
            position: 'absolute',
            left: shadow.left * SCALE,
            bottom: FEET_FROM_BOTTOM - shadow.height * SCALE,
            width: shadow.width * SCALE,
            height: shadow.height * SCALE,
          }}
          accessibilityElementsHidden
        />
      )}
      {/* Tapping a character opens their profile card */}
      <Pressable
        disabled={!onSelect}
        onPress={() => onSelect?.(walker)}
        accessibilityRole={onSelect ? 'button' : undefined}
        accessibilityLabel={`${name}: ${walker.steps.toLocaleString()} steps`}
        accessibilityHint={onSelect ? 'Opens their profile' : undefined}
        style={({ pressed }) => [styles.walkerInner, pressed && styles.walkerPressed]}>
        {/* Light backing keeps names readable over buildings */}
        <ThemedText
          numberOfLines={1}
          type={walker.isMe ? 'smallBold' : 'small'}
          style={styles.walkerLabel}>
          {name}
        </ThemedText>
        <Avatar
          config={normalizeAvatar(walker.avatar)}
          scale={SCALE}
          accessibilityLabel={name}
          light={scenery?.avatarMatrix}
        />
      </Pressable>
    </Animated.View>
  );
}

/** The goal flag; on lit maps it waves in two frames. */
function GoalFlag({ clock, waving }: { clock: SharedValue<number>; waving: boolean }) {
  const first = useAnimatedStyle(() => ({ opacity: Math.floor(clock.value * 2.5) % 2 ? 0 : 1 }));
  const second = useAnimatedStyle(() => ({ opacity: Math.floor(clock.value * 2.5) % 2 ? 1 : 0 }));
  const flag = (source: number) => (
    <PixelSprite
      source={source}
      width={FLAG_W}
      height={FLAG_H}
      scale={SCALE}
      accessibilityLabel="Flag at 10,000 steps"
    />
  );
  if (!waving) return flag(FLAG);
  return (
    <View>
      <Reanimated.View style={first}>{flag(FLAG)}</Reanimated.View>
      <Reanimated.View style={[StyleSheet.absoluteFill, second]} accessibilityElementsHidden>
        {flag(AMBIENT_SPRITES.flag_wave.source)}
      </Reanimated.View>
    </View>
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
 *
 * `header` sits on the map's sky above the scene: the sky picture and
 * what moves in it carry on behind it, up to the top of the screen.
 */
export function StepTrack({
  walkers,
  theme,
  onSelect,
  header,
  myGoal,
  link,
}: {
  walkers: Walker[];
  theme: MapTheme;
  /** Called when a character on the road is tapped */
  onSelect?: (walker: Walker) => void;
  header?: ReactNode;
  /** Your daily goal: a star on the road */
  myGoal?: number;
  /** Shares the road's scrolling with a RoadMinimap elsewhere on the page */
  link?: RoadLink;
}) {
  const own = useRoadLink();
  const { scrollRef, scrollX, userScrolledRef, viewport, setViewport } = link ?? own;
  // The header's height: the sky reaches that far above the scene
  const [above, setAbove] = useState(0);
  // Once someone scrolls by hand (userScrolledRef), stop re-centering on them.
  // Lit maps: the sky and hills behind the road, moving things, shadows
  const scenery = theme.scenery;
  const clock = useAmbientClock();

  const highest = walkers.reduce((m, w) => Math.max(m, w.steps), 0);
  const max = scaleMax(highest);
  const width = roadWidth(max);

  const baseXs = walkers.map((w) => centerFor(w.steps) - SPRITE_W / 2);
  const lanes = assignLanes(baseXs, SPRITE_W, MAX_LANES);
  const xs = baseXs.map((x, i) => x + LANE_SHIFT[lanes[i]]);

  const me = walkers.find((w) => w.isMe);

  // Open centered on me, and follow my count as it loads, until the
  // person scrolls themselves.
  const mySteps = me?.steps;
  useEffect(() => {
    if (userScrolledRef.current || viewport === 0 || mySteps === undefined) return;
    scrollRef.current?.scrollTo({
      x: Math.max(0, centerFor(mySteps) - viewport / 2),
      animated: false,
    });
  }, [mySteps, viewport, scrollRef, userScrolledRef]);

  // Lit maps keep open ground at both ends of every tile, so each tile
  // starts at a landmark and the landmark stands in that clearing (tiles
  // are 12 points longer than the gap between landmarks; the overlap is
  // open ground too). Other maps lay tiles end to end.
  const tiles = scenery
    ? Array.from({ length: Math.ceil((width - ROAD_PAD) / LANDMARK_EVERY) + 1 }, (_, i) => ({
        left: ROAD_PAD + (i - 1) * LANDMARK_EVERY,
        index: (i + 1) % theme.tiles.length,
      }))
    : Array.from({ length: Math.ceil(width / TILE_W) }, (_, i) => ({
        left: i * TILE_W,
        index: i % theme.tiles.length,
      }));
  const landmarks = landmarksFor(theme, max).map((l) => ({
    ...l,
    left: centerFor(l.steps) - LANDMARK_W / 2,
    // Its place in the theme's list (the far one repeats), for its shadow and anchors
    index: theme.landmarks.findIndex((t) => t.image === l.image),
  }));

  return (
    <View>
      {/* Sky color behind the scenery. No border, no rounding. */}
      <View
        onLayout={(e) => setViewport(e.nativeEvent.layout.width)}
        style={{ backgroundColor: theme.sky }}>
        {scenery && viewport > 0 && (
          <SkyLayer scenery={scenery} clock={clock} scrollX={scrollX} viewport={viewport} above={above} />
        )}
        {header && <View onLayout={(e) => setAbove(e.nativeEvent.layout.height)}>{header}</View>}
        <ScrollView
          ref={scrollRef}
          horizontal
          // No rubber-band past the ends, so the sky never shows under the road
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={() => {
            userScrolledRef.current = true;
          }}
          // The hills behind slide along at their own speed, and the
          // minimap's bracket follows
          onScroll={(e) => {
            scrollX.set(e.nativeEvent.contentOffset.x);
          }}
          scrollEventThrottle={16}
          accessibilityLabel="Step road. Swipe left or right to scroll.">
          <View style={{ width }}>
            {/* Village street + road + characters */}
            <View style={{ width, height: SCENE_H }}>
              <View style={styles.tiles} importantForAccessibility="no-hide-descendants">
                {tiles.map((t, i) => {
                  const style = { position: 'absolute', left: t.left, width: TILE_W, height: TILE_H } as const;
                  const frames = scenery?.tileFrames;
                  // Lit maps with a second frame (swaying, flickering) take turns between the two
                  return frames ? (
                    <Framed
                      key={t.left}
                      a={theme.tiles[t.index]}
                      b={frames.sources[t.index]}
                      mode={frames.mode}
                      rate={frames.rate}
                      seed={i}
                      clock={clock}
                      style={style}
                    />
                  ) : (
                    <Image
                      key={t.left}
                      source={theme.tiles[t.index]}
                      style={style}
                      resizeMode="stretch"
                      accessibilityElementsHidden
                    />
                  );
                })}
              </View>

              {scenery && <StreetLayer scenery={scenery} clock={clock} tiles={tiles} />}
              {scenery && viewport > 0 && (
                <HorizonLayer scenery={scenery} clock={clock} scrollX={scrollX} viewport={viewport} />
              )}

              {/* Each landmark's shadow on the road, under all the landmarks */}
              {scenery &&
                landmarks.map((l) => {
                  const box = scenery.shadowBoxes[l.index];
                  const source = scenery.landmarkShadows[l.index];
                  if (!box || !source) return null;
                  return (
                    <Image
                      key={`shadow-${l.steps}`}
                      source={source}
                      resizeMode="stretch"
                      accessibilityElementsHidden
                      style={[
                        styles.landmarkShadow,
                        { left: l.left + box.left * SCALE, width: box.width * SCALE },
                      ]}
                    />
                  );
                })}

              {landmarks.map((l, i) => {
                const place = { left: l.left, width: LANDMARK_W, height: LANDMARK_H };
                const frames = scenery?.landmarkFrames[l.index];
                return frames ? (
                  <View
                    key={l.steps}
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={l.label}
                    style={[styles.landmark, place]}>
                    <Framed
                      a={l.image}
                      b={frames.source}
                      mode={frames.mode}
                      rate={frames.rate}
                      seed={i + 0.5}
                      clock={clock}
                      style={{ position: 'absolute', left: 0, top: 0, width: LANDMARK_W, height: LANDMARK_H }}
                    />
                  </View>
                ) : (
                  <Image
                    key={l.steps}
                    source={l.image}
                    accessibilityLabel={l.label}
                    resizeMode="stretch"
                    style={[styles.landmark, place]}
                  />
                );
              })}

              {/* A clock landmark shows the real time */}
              {scenery?.clock &&
                landmarks
                  .filter((l) => l.index === 2)
                  .map((l) => <ClockHands key={`clock-${l.steps}`} left={l.left} clock={scenery.clock!} />)}

              {scenery && (
                <StreetLayer
                  scenery={scenery}
                  clock={clock}
                  landmarks={landmarks.filter((l) => l.index >= 0)}
                />
              )}

              {/* The flag stays at 10,000, at the back of the road: where the
                  road ends until someone passes it. Each player's own goal
                  is their daily target (7,000 to 10,000), shown on Today. */}
              <View
                pointerEvents="none"
                style={[styles.flag, { left: centerFor(GOAL) - FLAG_POLE_X * SCALE }]}>
                <GoalFlag clock={clock} waving={Boolean(scenery)} />
              </View>

              {walkers.map((w, i) => (
                <WalkerSprite
                  key={w.id}
                  walker={w}
                  x={xs[i]}
                  lane={lanes[i]}
                  scenery={scenery}
                  onSelect={onSelect}
                />
              ))}
            </View>

            {/* Distance markers, drawn straight onto the ground */}
            <View style={[styles.markers, { width, backgroundColor: theme.ground }]}>
              {ticksFor(max).map((v) => {
                const isFlag = v === GOAL;
                const color = theme.ink;
                // Your goal's star takes the place of a tick it lands on,
                // and the labels of ticks too close to it give way
                if (v === myGoal) return null;
                const crowded = myGoal !== undefined && Math.abs(v - myGoal) < 700;
                return (
                  <View key={v} style={[styles.tick, { left: centerFor(v) - 24 }]}>
                    <View style={[styles.tickMark, { backgroundColor: color }]} />
                    {!crowded && (
                      <ThemedText type={isFlag ? 'smallBold' : 'small'} style={[styles.tickLabel, { color }]}>
                        {formatSteps(v)}
                      </ThemedText>
                    )}
                  </View>
                );
              })}
              {myGoal !== undefined && myGoal <= max && (
                <View
                  style={[styles.goalMark, { left: centerFor(myGoal) - GOAL_MARK_W / 2 }]}
                  accessible
                  accessibilityLabel={`Your goal, ${myGoal.toLocaleString()} steps`}>
                  <PixelGlyph rows={STAR} outline={theme.ink} fill={(me?.steps ?? 0) >= myGoal ? '#f2c94c' : theme.ground} />
                  <ThemedText type="smallBold" style={[styles.tickLabel, { color: theme.ink }]}>
                    {formatSteps(myGoal)} goal
                  </ThemedText>
                </View>
              )}
            </View>
          </View>
        </ScrollView>
        {scenery && viewport > 0 && (
          <FrontLayer scenery={scenery} clock={clock} viewport={viewport} above={above} />
        )}
      </View>
    </View>
  );
}

const GOAL_MARK_W = 64;

/**
 * The road's scrolling, shared between StepTrack and a RoadMinimap
 * shown somewhere else (Today puts the minimap at the top of its list,
 * so it scrolls away with it).
 */
export function useRoadLink() {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollX = useSharedValue(0);
  // Once someone scrolls by hand, the road stops re-centering on them
  const userScrolledRef = useRef(false);
  const [viewport, setViewport] = useState(0);
  return { scrollRef, scrollX, userScrolledRef, viewport, setViewport };
}
export type RoadLink = ReturnType<typeof useRoadLink>;

/**
 * The minimap for a StepTrack sharing `link`: tap or drag it to move
 * the road. `fadeWith` is the page's vertical scroll: it fades out as
 * the page scrolls down past it, and comes back at the top.
 */
export function RoadMinimap({
  link,
  walkers,
  theme,
  myPlace,
  fadeWith,
}: {
  link: RoadLink;
  /** The same people the road shows */
  walkers: Walker[];
  theme: MapTheme;
  /** Your place in the whole ranking (the road may show only the top) */
  myPlace?: { place: number; of: number };
  fadeWith?: SharedValue<number>;
}) {
  const { scrollRef, scrollX, userScrolledRef, viewport } = link;
  const reducedMotion = useReducedMotion();
  const max = scaleMax(walkers.reduce((m, w) => Math.max(m, w.steps), 0));

  // Animated for a tap, at once for a drag. Either way the road stops
  // following your count.
  function scrollRoadTo(steps: number, animated: boolean) {
    userScrolledRef.current = true;
    scrollRef.current?.scrollTo({ x: scrollFor(steps, max, viewport), animated: animated && !reducedMotion });
  }

  // Gone by the time it has scrolled two thirds of the way off
  const fade = useAnimatedStyle(() => ({
    opacity: fadeWith ? 1 - Math.min(1, Math.max(0, fadeWith.get()) / (MINIMAP_H * 0.66)) : 1,
  }));

  if (viewport === 0) return null;
  return (
    <Reanimated.View style={[styles.minimap, fade]}>
      <Minimap
        walkers={walkers}
        max={max}
        theme={theme}
        place={myPlace}
        scrollX={scrollX}
        width={viewport}
        viewport={viewport}
        onJump={(steps) => scrollRoadTo(steps, true)}
        onScrub={(steps) => scrollRoadTo(steps, false)}
        viewCenter={() => (scrollX.get() + viewport / 2 - ROAD_PAD) / PX_PER_STEP}
      />
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  tiles: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0, // the road sits at the bottom of the scene
    height: TILE_H,
  },
  landmark: {
    position: 'absolute',
    bottom: ROAD_H, // sits on top of the road
  },
  landmarkShadow: {
    position: 'absolute',
    bottom: 0, // covers the road, from its top line down
    height: ROAD_H,
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
  walkerInner: {
    alignItems: 'center',
  },
  walkerPressed: {
    opacity: 0.7,
  },
  walkerLabel: {
    // Over the sprite's empty headroom, so the name sits just above the
    // head; drawn on top so a tall hat never hides it
    marginBottom: -HEADROOM * SCALE,
    zIndex: 1,
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
  goalMark: {
    position: 'absolute',
    width: GOAL_MARK_W,
    alignItems: 'center',
  },
  minimap: {
    paddingBottom: 4,
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
});
