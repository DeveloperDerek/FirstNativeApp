import { type ReactNode, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import Reanimated, { type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { HEAD_ROWS, HeadIcon } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import { ThemedText } from '@/components/themed-text';

import {
  barX,
  groupIcons,
  labelsFor,
  milestonesFor,
  nextStop,
  stepsAt,
  viewportOnBar,
} from './minimap-math';
import { DIAMOND, FLAG, glyphSize, PixelGlyph, STAR } from './pixel-glyph';
import { formatSteps, GOAL } from './scale';
import type { Walker } from './StepTrack';
import type { MapTheme } from './themes';

// Layout, top to bottom (see docs/step-tracker-minimap.txt): icons stand
// on the bar, yours a little higher with a pointer; the bar; labels.
const ICON_W = 32; // a HeadIcon at scale 1
const HEAD_W = 24; // the head itself, for deciding which icons overlap
const POINTER = ['OOOOO', '.OOO.', '..O..'];
const BAR_Y = HEAD_ROWS + glyphSize(POINTER).height + 2;
const BAR_H = 6; // 2-point outline, 2-point track
const LABEL_Y = BAR_Y + BAR_H + 4;
export const MINIMAP_H = LABEL_Y + 16;
const OTHERS_TOP = BAR_Y - 2 - HEAD_ROWS;
const GOLD = '#f2c94c';
const TRACK = 'rgba(0, 0, 0, 0.18)';
const LABEL_W = 40;

/**
 * Today's whole road on one bar under it: your progress, the landmarks,
 * the 10,000 flag, your goal, everyone's head, and a bracket over the
 * part of the road on screen. Tap to move the road there, drag to scrub
 * it; tapping a head centers the road on them.
 */
export function Minimap({
  walkers,
  max,
  theme,
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
  const ink = theme.ink;
  const me = walkers.find((w) => w.isMe);
  const mySteps = me?.steps ?? 0;
  const reached = myGoal !== undefined && mySteps >= myGoal;
  const groups = groupIcons(walkers, max, width, HEAD_W * 0.8);
  const fillTo = barX(mySteps, max, width);
  const x = (steps: number) => barX(steps, max, width);

  // A tap on a head goes to them; anywhere else on the bar, to that spot
  function tapAt(px: number, py: number) {
    const hit = (cx: number, top: number) => Math.abs(px - cx) <= HEAD_W / 2 && py >= top && py <= BAR_Y;
    if (me && hit(fillTo, 0)) return onJump(me.steps);
    const group = groups.find((g) => hit(g.x, OTHERS_TOP));
    onJump(group ? group.leader.steps : stepsAt(px, max, width));
  }
  function scrubTo(px: number) {
    onScrub(stepsAt(px, max, width));
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

  const bracket = useAnimatedStyle(() => {
    const v = viewportOnBar(scrollX.get(), viewport, max, width);
    return { left: v.left - 2, width: v.width + 4 };
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

  const star = glyphSize(STAR);
  const flag = glyphSize(FLAG);
  const diamond = glyphSize(DIAMOND);

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={{ width, height: MINIMAP_H }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={summary}
        accessibilityHint="Swipe up or down to move the road between milestones. Tap or drag to move it there."
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}>
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={StyleSheet.absoluteFill}>
          {/* The bar: an outline round the track, your part filled */}
          <View
            style={[
              styles.abs,
              { left: x(0) - 2, top: BAR_Y, width: x(max) - x(0) + 4, height: BAR_H, backgroundColor: ink },
            ]}>
            <View style={[styles.abs, { left: 2, top: 2, right: 2, height: 2, backgroundColor: theme.ground }]} />
            <View style={[styles.abs, { left: 2, top: 2, right: 2, height: 2, backgroundColor: TRACK }]} />
            <View
              style={[
                styles.abs,
                { left: 2, top: 2, width: fillTo - x(0), height: 2, backgroundColor: reached ? GOLD : theme.button },
              ]}
            />
          </View>

          {/* A landmark every 5,000: filled once you've passed it */}
          {milestonesFor(max).map((s) => (
            <View
              key={s}
              style={[styles.abs, { left: x(s) - diamond.width / 2, top: BAR_Y + (BAR_H - diamond.height) / 2 }]}>
              <PixelGlyph rows={DIAMOND} outline={ink} fill={mySteps >= s ? (reached ? GOLD : theme.button) : theme.ground} />
            </View>
          ))}

          {GOAL <= max && (
            <View style={[styles.abs, { left: x(GOAL) - 1, top: BAR_Y - flag.height }]}>
              <PixelGlyph rows={FLAG} outline={ink} fill="#e2483d" />
            </View>
          )}
          {myGoal !== undefined && (
            <View style={[styles.abs, { left: x(myGoal) - star.width / 2, top: BAR_Y - star.height }]}>
              <PixelGlyph rows={STAR} outline={ink} fill={reached ? GOLD : theme.ground} />
            </View>
          )}

          {labelsFor(max).map((v) => (
            <ThemedText
              key={v}
              style={[
                styles.label,
                {
                  left: Math.min(width - LABEL_W, Math.max(0, x(v) - LABEL_W / 2)),
                  top: LABEL_Y,
                  color: ink,
                },
              ]}>
              {formatSteps(v)}
            </ThemedText>
          ))}

          {/* What's on screen */}
          <Reanimated.View
            style={[styles.abs, styles.bracket, { top: BAR_Y - 4, height: BAR_H + 8, borderColor: ink }, bracket]}
          />

          {groups.map((g) => (
            <Icon key={g.leader.id} walker={g.leader} x={g.x} top={OTHERS_TOP} others={g.others} theme={theme} />
          ))}
          {me && (
            <Icon walker={me} x={fillTo} top={0} others={0} theme={theme}>
              <View style={{ alignItems: 'center' }}>
                <PixelGlyph rows={POINTER} outline={ink} fill={ink} />
              </View>
            </Icon>
          )}
        </View>
      </View>
    </GestureDetector>
  );
}

/** A head on the bar, walking to its new spot when the count changes. */
function Icon({
  walker,
  x,
  top,
  others,
  theme,
  children,
}: {
  walker: Walker;
  x: number;
  top: number;
  others: number;
  theme: MapTheme;
  children?: ReactNode;
}) {
  const at = useSharedValue(x);
  useEffect(() => {
    at.set(withTiming(x, { duration: 600 }));
  }, [at, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: Math.round(at.get()) - ICON_W / 2 }] }));
  return (
    <Reanimated.View style={[styles.abs, { left: 0, top, width: ICON_W }, style]}>
      <HeadIcon config={normalizeAvatar(walker.avatar)} />
      {children}
      {others > 0 && (
        <View style={[styles.badge, { backgroundColor: theme.ink }]}>
          <ThemedText style={[styles.badgeText, { color: theme.ground }]}>+{others}</ThemedText>
        </View>
      )}
    </Reanimated.View>
  );
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

const styles = StyleSheet.create({
  abs: {
    position: 'absolute',
  },
  bracket: {
    borderWidth: 2,
  },
  label: {
    position: 'absolute',
    width: LABEL_W,
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 14,
  },
  badge: {
    position: 'absolute',
    right: 0,
    top: 6,
    minWidth: 16,
    height: 14,
    paddingHorizontal: 3,
    borderRadius: 7,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 9,
    lineHeight: 14,
    fontWeight: '700',
  },
});

