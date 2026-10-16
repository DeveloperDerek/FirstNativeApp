import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import Reanimated, { type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { HeadIcon, PixelSprite } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import { ThemedText } from '@/components/themed-text';

import { barX, milestonesFor, nextStop, stepsAt, viewportOnBar } from './minimap-math';
import { PixelGlyph, STAR } from './pixel-glyph';
import { assignLanes, formatSteps, GOAL } from './scale';
import type { Walker } from './StepTrack';
import type { MapTheme } from './themes';

// A white pill holding a soft grey track with a dashed line along it;
// round heads on the line, overlapping heads stacked upward; ringed
// milestones with a tag under them. See docs/step-tracker-minimap.txt.
const SIDE = 12; // space either side of the pill
const PILL_H = 64;
const PAD = 6; // pill to track
const TRACK_H = PILL_H - 2 * PAD;
const MID = TRACK_H / 2; // the dashed line, in track coordinates
const INSET = TRACK_H / 2 + 4; // ends of the line: where the track is full height
const BUBBLE = 36;
const LANE_UP = 15; // each stacked head sits this much higher
const MAX_LANES = 3;
const RING = 38;
const ABOVE = 2 * LANE_UP + 4; // room over the pill for stacked heads
export const MINIMAP_H = ABOVE + PILL_H + 12;

const COLORS = {
  pill: '#ffffff',
  track: '#e8eaf0',
  dash: '#cdd0da',
  walked: '#9ea3b5',
  window: 'rgba(40, 50, 90, 0.07)',
  bubbleEdge: '#eef0f5',
  me: '#f08a2c',
  goal: '#5bd65b',
  goalDone: '#e6f9e6',
  flag: '#4fd0f0',
  tagText: '#6b6f80',
  gold: '#f2c94c',
  ink: '#3a2a2a',
};
const FLAG = require('@/assets/track/flag_goal.png');

/**
 * Today's whole road on one bar under it: everyone's head at their
 * steps, your goal and the 10,000 flag as ringed milestones, and a soft
 * window over the part of the road on screen. Tap to move the road
 * there, drag to scrub it; tapping a head centers the road on them.
 */
export function Minimap({
  walkers,
  max,
  myGoal,
  place,
  scrollX,
  width,
  viewport,
  onJump,
  onScrub,
  viewCenter,
}: {
  walkers: Walker[];
  /** Where the road ends (scaleMax) */
  max: number;
  theme: MapTheme;
  myGoal?: number;
  /** Your place in the whole ranking, for the screen reader */
  place?: { place: number; of: number };
  /** The road's scroll position */
  scrollX: SharedValue<number>;
  width: number;
  /** The road's visible width */
  viewport: number;
  /** Scroll the road to these steps, animated */
  onJump: (steps: number) => void;
  /** Scroll the road to these steps at once, following a finger */
  onScrub: (steps: number) => void;
  /** The steps at the middle of the screen right now */
  viewCenter: () => number;
}) {
  const trackW = width - 2 * SIDE - 2 * PAD;
  const x = (steps: number) => barX(steps, max, trackW, INSET);
  const me = walkers.find((w) => w.isMe);
  const mySteps = me?.steps ?? 0;
  const reached = myGoal !== undefined && mySteps >= myGoal;

  // Everyone else stacks upward where they'd overlap; you stay on the line
  const others = walkers.filter((w) => !w.isMe);
  const otherXs = others.map((w) => x(w.steps));
  const lanes = assignLanes(otherXs, BUBBLE, MAX_LANES);
  const heads = others
    .map((w, i) => ({ walker: w, x: otherXs[i], lane: lanes[i] }))
    .sort((a, b) => b.lane - a.lane); // higher ones drawn first, behind

  // Milestones: your goal, and the 10,000 flag unless your goal is there
  const marks = [
    ...(myGoal !== undefined && myGoal <= max ? [{ steps: myGoal, kind: 'goal' as const }] : []),
    ...(GOAL <= max && myGoal !== GOAL ? [{ steps: GOAL, kind: 'flag' as const }] : []),
  ];

  // Touch, in track coordinates. A tap on a head goes to them (front
  // ones first); anywhere else, to that spot.
  function tapAt(px: number, py: number) {
    const hit = (cx: number, lane: number) => Math.hypot(px - cx, py - (MID - lane * LANE_UP)) <= BUBBLE / 2;
    if (me && hit(x(mySteps), 0)) return onJump(mySteps);
    const head = [...heads].reverse().find((h) => hit(h.x, h.lane));
    onJump(head ? head.walker.steps : stepsAt(px, max, trackW, INSET));
  }
  function scrubTo(px: number) {
    onScrub(stepsAt(px, max, trackW, INSET));
  }
  const pan = usePanGesture({
    activeOffsetX: [-6, 6],
    failOffsetY: [-14, 14],
    onUpdate: (e) => {
      'worklet';
      scheduleOnRN(scrubTo, e.x);
    },
  });
  const tap = useTapGesture({
    onActivate: (e) => {
      'worklet';
      scheduleOnRN(tapAt, e.x, e.y);
    },
  });
  const gesture = useExclusiveGestures(pan, tap);

  const window = useAnimatedStyle(() => {
    const v = viewportOnBar(scrollX.get(), viewport, max, trackW, INSET);
    return { left: v.left - MID, width: v.width + 2 * MID };
  });

  // Read as one summary; swiping up and down moves the road between stops
  const toGoal = myGoal !== undefined ? myGoal - mySteps : 0;
  const summary = [
    `Today's road. You're at ${mySteps.toLocaleString()} steps`,
    myGoal === undefined ? '' : toGoal > 0 ? `${toGoal.toLocaleString()} to your goal` : 'goal reached',
    mySteps < GOAL ? `${(GOAL - mySteps).toLocaleString()} to the 10,000 flag` : '',
    place && place.of > 1 ? `${ordinal(place.place)} of ${place.of}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const stops = [...milestonesFor(max), mySteps, ...(myGoal !== undefined ? [myGoal] : [])];
  function step(direction: 1 | -1) {
    const to = nextStop(stops, viewCenter(), direction);
    if (to !== undefined) onJump(to);
  }

  // The dashed line, darker behind you
  const dashes = [];
  for (let d = x(0); d + 12 <= x(max); d += 22) dashes.push(d);

  return (
    <View
      style={{ width, height: MINIMAP_H }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={summary}
      accessibilityHint="Swipe up or down to move the road between milestones. Tap or drag to move it there."
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}>
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[styles.pill, { top: ABOVE, left: SIDE, right: SIDE }]}>
        <GestureDetector gesture={gesture}>
          <View style={styles.track}>
            <Reanimated.View style={[styles.window, window]} />
            {dashes.map((d) => (
              <View
                key={d}
                style={[styles.dash, { left: d, backgroundColor: d + 6 <= x(mySteps) ? COLORS.walked : COLORS.dash }]}
              />
            ))}

            {heads.map((h) => (
              <Head key={h.walker.id} walker={h.walker} x={h.x} lane={h.lane} />
            ))}

            {marks.map((m) => (
              <Milestone key={m.kind} x={x(m.steps)} kind={m.kind} done={m.kind === 'goal' && reached} label={formatSteps(m.steps)} />
            ))}

            {me && <Head walker={me} x={x(mySteps)} lane={0} isMe />}
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

/** A round head on the line, gliding to its new spot when the count changes. */
function Head({ walker, x, lane, isMe = false }: { walker: Walker; x: number; lane: number; isMe?: boolean }) {
  const at = useSharedValue(x);
  useEffect(() => {
    at.set(withTiming(x, { duration: 600 }));
  }, [at, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: Math.round(at.get()) }] }));
  const top = MID - lane * LANE_UP;
  return (
    <Reanimated.View style={[styles.anchor, { top }, style]}>
      {isMe && <View style={styles.meRing} />}
      <View style={styles.bubble}>
        {/* The head's middle (sprite row 22 with the headroom) at the circle's */}
        <View style={styles.face}>
          <HeadIcon config={normalizeAvatar(walker.avatar)} />
        </View>
      </View>
    </Reanimated.View>
  );
}

/** A ringed milestone with a line through the track and a tag under it. */
function Milestone({ x, kind, done, label }: { x: number; kind: 'goal' | 'flag'; done: boolean; label: string }) {
  const color = kind === 'goal' ? COLORS.goal : COLORS.flag;
  return (
    <View style={[styles.anchor, { top: MID, left: x }]} pointerEvents="none">
      <View style={[styles.markLine, { backgroundColor: color }]} />
      <View style={[styles.ring, { borderColor: color, backgroundColor: done ? COLORS.goalDone : COLORS.pill }]}>
        {kind === 'goal' ? (
          <PixelGlyph rows={STAR} outline={COLORS.ink} fill={done ? COLORS.gold : COLORS.pill} />
        ) : (
          <PixelSprite source={FLAG} width={12} height={24} scale={1} />
        )}
      </View>
      <View style={styles.tag}>
        <ThemedText style={styles.tagText}>{label}</ThemedText>
      </View>
    </View>
  );
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    height: PILL_H,
    padding: PAD,
    borderRadius: PILL_H / 2,
    backgroundColor: COLORS.pill,
    shadowColor: '#1a2040',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  track: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: COLORS.track,
  },
  window: {
    position: 'absolute',
    top: 4,
    height: TRACK_H - 8,
    borderRadius: (TRACK_H - 8) / 2,
    backgroundColor: COLORS.window,
  },
  dash: {
    position: 'absolute',
    top: MID - 2,
    width: 12,
    height: 4,
    borderRadius: 2,
  },
  // Children are centered on this zero-size point
  anchor: {
    position: 'absolute',
    left: 0,
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    position: 'absolute',
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    borderWidth: 2,
    borderColor: COLORS.bubbleEdge,
    backgroundColor: COLORS.pill,
    overflow: 'hidden',
  },
  face: {
    position: 'absolute',
    left: (BUBBLE - 4 - 32) / 2,
    top: (BUBBLE - 4) / 2 - 22,
  },
  meRing: {
    position: 'absolute',
    width: BUBBLE + 10,
    height: BUBBLE + 16,
    borderRadius: (BUBBLE + 10) / 2,
    borderWidth: 3,
    borderColor: COLORS.me,
  },
  markLine: {
    position: 'absolute',
    width: 3,
    height: TRACK_H + 2 * PAD,
    borderRadius: 1.5,
  },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tag: {
    position: 'absolute',
    top: TRACK_H / 2 + PAD - 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    backgroundColor: COLORS.pill,
  },
  tagText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: COLORS.tagText,
  },
});
