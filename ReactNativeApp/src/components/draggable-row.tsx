import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  type AnimatedRef,
  measure,
  scrollTo,
  type SharedValue,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// A sideways-scrolling row of same-width tiles the user can rearrange:
// hold a tile for a moment, then drag it sideways; the others slide out of
// its way. Holding it near either edge scrolls the row, so a tile can go
// to a slot that was off screen. The tiles stay in normal layout in their
// given order and are only shifted with translateX while dragging, so the
// row sizes itself as usual.

export const HOLD_MS = 250; // also Tile's delayLongPress, so a drag never counts as a tap

const EDGE = 56; // how close to an edge the finger must be to scroll, in points
const MAX_SPEED = 600; // scroll speed right at the edge, in points per second

type Positions = Record<string, number>; // item id -> slot it shows in

/** The tile being dragged, everything measured when the hold began. */
type Drag = {
  id: string;
  index: number;
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
  drag: SharedValue<Drag | null>;
  heldLeft: SharedValue<number>; // left edge of the held tile, in row coordinates
  scrollX: SharedValue<number>;
};

/** Puts the held tile under the finger and slides the others out of its way. */
function place({ positions, drag, heldLeft, scrollX }: Shared, stride: number, count: number) {
  'worklet';
  const d = drag.get();
  if (!d) return;
  const left = Math.min(
    Math.max(d.index * stride + d.translationX + scrollX.get() - d.startScroll, 0),
    (count - 1) * stride,
  );
  heldLeft.set(left);
  const from = positions.get()[d.id];
  const to = Math.round(left / stride);
  if (to === from) return;
  // Slide every tile between the old and new slot over by one
  const next = { ...positions.get() };
  for (const key of Object.keys(next)) {
    const p = next[key];
    if (from < to && p > from && p <= to) next[key] = p - 1;
    if (from > to && p >= to && p < from) next[key] = p + 1;
  }
  next[d.id] = to;
  positions.set(next);
}

function DraggableItem({
  id,
  index,
  count,
  stride,
  shared,
  scrollRef,
  onDrop,
  onDragChange,
  children,
}: {
  id: string;
  index: number;
  count: number;
  stride: number;
  shared: Shared;
  scrollRef: AnimatedRef<Animated.ScrollView>;
  onDrop: (ids: string[]) => void;
  onDragChange: (dragging: boolean) => void;
  children: ReactNode;
}) {
  const { positions, drag, heldLeft, scrollX } = shared;

  const pan = usePanGesture({
    activateAfterLongPress: HOLD_MS,
    onActivate: (e) => {
      'worklet';
      const view = measure(scrollRef);
      drag.set({
        id,
        index,
        translationX: 0,
        fingerX: e.absoluteX,
        startScroll: scrollX.get(),
        viewLeft: view?.pageX ?? 0,
        viewWidth: view?.width ?? 0,
      });
      heldLeft.set(positions.get()[id] * stride);
      scheduleOnRN(onDragChange, true);
    },
    onUpdate: (e) => {
      'worklet';
      const d = drag.get();
      if (!d || d.id !== id) return;
      drag.set({ ...d, translationX: e.translationX, fingerX: e.absoluteX });
      place(shared, stride, count);
    },
    onFinalize: () => {
      'worklet';
      if (drag.get()?.id !== id) return;
      drag.set(null);
      const p = positions.get();
      scheduleOnRN(onDrop, Object.keys(p).sort((a, b) => p[a] - p[b]));
      scheduleOnRN(onDragChange, false);
    },
  });

  const style = useAnimatedStyle(() => {
    const held = drag.get()?.id === id;
    const slot = positions.get()[id] ?? index;
    return {
      zIndex: held ? 1 : 0,
      transform: [
        {
          translateX: held ? heldLeft.get() - index * stride : withTiming((slot - index) * stride),
        },
        { scale: withTiming(held ? 1.08 : 1, { duration: 120 }) },
      ],
    };
  }, [id, index, stride]);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  );
}

export function DraggableRow<T extends { id: string }>({
  items,
  itemWidth,
  gap,
  leading,
  renderItem,
  onReorder,
  onDragChange,
}: {
  items: T[];
  itemWidth: number;
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
  const stride = itemWidth + gap;
  const shared: Shared = {
    positions: useSharedValue<Positions>(slots(ids)),
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
    place(shared, stride, items.length);
  }, false);

  const handleDragChange = useCallback(
    (now: boolean) => {
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
      {items.map((item, i) => (
        <DraggableItem
          key={item.id}
          id={item.id}
          index={i}
          count={items.length}
          stride={stride}
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
