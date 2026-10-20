import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  type AnimatedRef,
  Easing,
  measure,
  scrollTo,
  type SharedValue,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import * as haptics from '@/lib/haptics';

// A sideways-scrolling row of tiles the user can rearrange:
// hold a tile for a moment, then drag it sideways; the others slide out of
// its way. Holding it near either edge scrolls the row, so a tile can go
// to a slot that was off screen. The tiles stay in normal layout and are
// only shifted with translateX, so the row sizes itself as usual. A drop
// never changes that layout (tiles keep the order they were first laid
// out in; only tiles coming or going change it): re-laying out the row
// as the dropped tile lands made it flicker. Tiles can differ in width (each one is
// measured), e.g. buttons named after groups.

export const HOLD_MS = 250; // also Tile's delayLongPress, so a drag never counts as a tap

const EDGE = 56; // how close to an edge the finger must be to scroll, in points
const MAX_SPEED = 600; // scroll speed right at the edge, in points per second
const SETTLE_MS = 180; // tiles sliding out of the way, and the dropped one into its slot
const SETTLE = { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) };

type Positions = Record<string, number>; // item id -> slot it shows in
type Widths = Record<string, number>; // item id -> its measured width

/** The tile being dragged, everything measured when the hold began. */
type Drag = {
  id: string;
  startLeft: number; // where the held tile was when the hold began, in row coordinates
  translationX: number;
  fingerX: number; // on screen
  startScroll: number;
  viewLeft: number; // the row's visible part, on screen
  viewWidth: number;
};

const slots = (ids: string[]): Positions => Object.fromEntries(ids.map((id, i) => [id, i]));

/** The row's drag state, shared by every tile and the edge scrolling. */
type Shared = {
  positions: SharedValue<Positions>;
  widths: SharedValue<Widths>;
  drag: SharedValue<Drag | null>;
  heldLeft: SharedValue<number>; // left edge of the held tile, in row coordinates
  scrollX: SharedValue<number>;
};

/** The ids in the slots they show in, first to last. */
function orderOf(positions: Positions): string[] {
  'worklet';
  return Object.keys(positions).sort((a, b) => positions[a] - positions[b]);
}

/** Where `id` starts when the tiles are laid out in `order`. */
function leftOf(order: string[], widths: Widths, gap: number, id: string): number {
  'worklet';
  let x = 0;
  for (const key of order) {
    if (key === id) return x;
    x += (widths[key] ?? 0) + gap;
  }
  return x;
}

/** Puts the held tile under the finger and slides the others out of its way. */
function place({ positions, widths, drag, heldLeft, scrollX }: Shared, gap: number) {
  'worklet';
  const d = drag.get();
  if (!d) return;
  const w = widths.get();
  const order = orderOf(positions.get());
  const total = order.reduce((sum, key) => sum + (w[key] ?? 0), 0) + gap * (order.length - 1);
  const left = Math.min(
    Math.max(d.startLeft + d.translationX + scrollX.get() - d.startScroll, 0),
    Math.max(total - (w[d.id] ?? 0), 0),
  );
  heldLeft.set(left);
  // The held tile goes to the slot whose start is closest to it
  const others = order.filter((key) => key !== d.id);
  let to = 0;
  let best = Infinity;
  let x = 0;
  for (let j = 0; j <= others.length; j++) {
    if (Math.abs(left - x) < best) {
      best = Math.abs(left - x);
      to = j;
    }
    if (j < others.length) x += (w[others[j]] ?? 0) + gap;
  }
  if (to === positions.get()[d.id]) return;
  others.splice(to, 0, d.id);
  const next: Positions = {};
  others.forEach((key, i) => {
    next[key] = i;
  });
  positions.set(next);
}

function DraggableItem({
  id,
  ids,
  gap,
  shared,
  scrollRef,
  onDrop,
  onDragChange,
  children,
}: {
  id: string;
  ids: string[]; // every tile in the row, in layout order
  gap: number;
  shared: Shared;
  scrollRef: AnimatedRef<Animated.ScrollView>;
  onDrop: (ids: string[]) => void;
  onDragChange: (dragging: boolean) => void;
  children: ReactNode;
}) {
  const { positions, widths, drag, heldLeft, scrollX } = shared;

  const pan = usePanGesture({
    activateAfterLongPress: HOLD_MS,
    onActivate: (e) => {
      'worklet';
      const view = measure(scrollRef);
      const startLeft = leftOf(orderOf(positions.get()), widths.get(), gap, id);
      drag.set({
        id,
        startLeft,
        translationX: 0,
        fingerX: e.absoluteX,
        startScroll: scrollX.get(),
        viewLeft: view?.pageX ?? 0,
        viewWidth: view?.width ?? 0,
      });
      heldLeft.set(startLeft);
      scheduleOnRN(onDragChange, true);
    },
    onUpdate: (e) => {
      'worklet';
      const d = drag.get();
      if (!d || d.id !== id) return;
      drag.set({ ...d, translationX: e.translationX, fingerX: e.absoluteX });
      place(shared, gap);
    },
    onFinalize: () => {
      'worklet';
      if (drag.get()?.id !== id) return;
      drag.set(null);
      scheduleOnRN(onDrop, orderOf(positions.get()));
      scheduleOnRN(onDragChange, false);
    },
  });

  // Where the tile shows in the row, animated; the style turns it into
  // an offset from the tile's layout spot. And whether it is drawn above
  // the others: from the hold until it has landed, not just while held.
  const shownLeft = useSharedValue(0);
  const lifted = useSharedValue(false);
  useAnimatedReaction(
    () => {
      const held = drag.get()?.id === id;
      return {
        held,
        dragging: drag.get() !== null,
        target: held ? heldLeft.get() : leftOf(orderOf(positions.get()), widths.get(), gap, id),
      };
    },
    (now, before) => {
      // Nothing moved (e.g. the row re-rendered): leave any slide running
      if (before && now.target === before.target && now.held === before.held) return;
      // Slide while making room and when the held tile settles into its
      // slot, including tiles still sliding as it's dropped; otherwise
      // (first layout, a new order) jump straight there
      if (now.held) {
        lifted.set(true);
        shownLeft.set(now.target);
      } else if (before?.held) {
        // Dropped: glide into the slot, then back to the others' level
        shownLeft.set(
          withTiming(now.target, SETTLE, (finished) => {
            if (finished) lifted.set(false);
          })
        );
      } else {
        const slide = before !== null && (now.dragging || before.dragging);
        shownLeft.set(slide ? withTiming(now.target, SETTLE) : now.target);
      }
    },
    [id, gap]
  );

  const style = useAnimatedStyle(() => {
    const held = drag.get()?.id === id;
    return {
      zIndex: lifted.get() ? 1 : 0,
      transform: [
        { translateX: shownLeft.get() - leftOf(ids, widths.get(), gap, id) },
        { scale: withTiming(held ? 1.08 : 1, held ? { duration: 120 } : SETTLE) },
      ],
    };
  }, [id, ids, gap]);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={style}
        onLayout={(e) => {
          const width = e.nativeEvent.layout.width;
          widths.modify((all) => {
            'worklet';
            return { ...all, [id]: width };
          });
        }}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

export function DraggableRow<T extends { id: string }>({
  items,
  gap,
  leading,
  renderItem,
  onReorder,
  onDragChange,
}: {
  items: T[];
  gap: number;
  /** Shown first and never moves, e.g. a "None" tile. */
  leading?: ReactNode;
  renderItem: (item: T) => ReactNode;
  onReorder: (ids: string[]) => void;
  /** Lets the screen stop scrolling while a tile is held. */
  onDragChange: (dragging: boolean) => void;
}) {
  const ids = items.map((x) => x.id);
  const key = ids.join(',');
  // The order the tiles are laid out in: kept through drops (their order
  // only moves the tiles with translateX); new tiles go at the end
  const [layoutIds, setLayoutIds] = useState(ids);
  const sameTiles = layoutIds.length === ids.length && ids.every((id) => layoutIds.includes(id));
  const laidOut = sameTiles
    ? layoutIds
    : [...layoutIds.filter((id) => ids.includes(id)), ...ids.filter((id) => !layoutIds.includes(id))];
  if (!sameTiles) setLayoutIds(laidOut);
  const byId = new Map(items.map((x) => [x.id, x]));
  const shared: Shared = {
    positions: useSharedValue<Positions>(slots(ids)),
    widths: useSharedValue<Widths>({}),
    drag: useSharedValue<Drag | null>(null),
    heldLeft: useSharedValue(0),
    scrollX: useSharedValue(0),
  };
  const { positions, drag, scrollX } = shared;
  const contentWidth = useSharedValue(0);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [dragging, setDragging] = useState(false);

  // New items or a saved order: every tile back to its own slot
  useEffect(() => {
    positions.set(slots(key ? key.split(',') : []));
  }, [key, positions]);

  // A tick each time the held tile takes another tile's slot
  useAnimatedReaction(
    () => (drag.get() ? orderOf(positions.get()).join(',') : null),
    (now, before) => {
      if (now !== null && before !== null && now !== before) scheduleOnRN(haptics.select);
    }
  );

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.set(e.contentOffset.x);
  });

  // While a tile is held near an edge, scroll that way, faster the closer it is
  const edgeScroll = useFrameCallback(({ timeSincePreviousFrame }) => {
    const d = drag.get();
    if (!d || !timeSincePreviousFrame) return;
    const fromLeft = d.fingerX - d.viewLeft;
    const fromRight = d.viewLeft + d.viewWidth - d.fingerX;
    const push =
      fromLeft < EDGE ? -(EDGE - fromLeft) / EDGE : fromRight < EDGE ? (EDGE - fromRight) / EDGE : 0;
    if (push === 0) return;
    const max = Math.max(contentWidth.get() - d.viewWidth, 0);
    const step = push * MAX_SPEED * (timeSincePreviousFrame / 1000);
    const to = Math.min(Math.max(scrollX.get() + step, 0), max);
    if (to === scrollX.get()) return;
    scrollTo(scrollRef, to, 0, false);
    scrollX.set(to); // don't wait for the scroll event, so the tile keeps up
    place(shared, gap);
  }, false);

  const handleDragChange = useCallback(
    (now: boolean) => {
      if (now) haptics.lift(); // the tile comes off the row
      setDragging(now);
      edgeScroll.setActive(now);
      onDragChange(now);
    },
    [edgeScroll, onDragChange],
  );

  return (
    <Animated.ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEnabled={!dragging}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onContentSizeChange={(w) => contentWidth.set(w)}
      contentContainerStyle={[styles.row, { gap }]}>
      {leading}
      {laidOut.map((id) => byId.get(id)!).map((item) => (
        <DraggableItem
          key={item.id}
          id={item.id}
          ids={laidOut}
          gap={gap}
          shared={shared}
          scrollRef={scrollRef}
          onDrop={onReorder}
          onDragChange={handleDragChange}>
          {renderItem(item)}
        </DraggableItem>
      ))}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
});
