import { type ReactNode, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// A row of same-width tiles the user can rearrange: hold a tile for a
// moment, then drag it sideways; the others slide out of its way. The
// tiles stay in normal layout in their given order and are only shifted
// with translateX while dragging, so the row sizes itself as usual.

export const HOLD_MS = 250; // also Tile's delayLongPress, so a drag never counts as a tap

type Positions = Record<string, number>; // item id -> slot it shows in

const slots = (ids: string[]): Positions => Object.fromEntries(ids.map((id, i) => [id, i]));

function DraggableItem({
  id,
  index,
  count,
  stride,
  positions,
  onDrop,
  onDragChange,
  children,
}: {
  id: string;
  index: number;
  count: number;
  stride: number;
  positions: SharedValue<Positions>;
  onDrop: (ids: string[]) => void;
  onDragChange: (dragging: boolean) => void;
  children: ReactNode;
}) {
  const active = useSharedValue(false);
  const x = useSharedValue(0); // left edge of the held tile, in row coordinates

  const pan = usePanGesture({
    activateAfterLongPress: HOLD_MS,
    onActivate: () => {
      'worklet';
      active.set(true);
      x.set(positions.get()[id] * stride);
      scheduleOnRN(onDragChange, true);
    },
    onUpdate: (e) => {
      'worklet';
      const left = Math.min(Math.max(index * stride + e.translationX, 0), (count - 1) * stride);
      x.set(left);
      const from = positions.get()[id];
      const to = Math.round(left / stride);
      if (to === from) return;
      // Slide every tile between the old and new slot over by one
      const next = { ...positions.get() };
      for (const key of Object.keys(next)) {
        const p = next[key];
        if (from < to && p > from && p <= to) next[key] = p - 1;
        if (from > to && p >= to && p < from) next[key] = p + 1;
      }
      next[id] = to;
      positions.set(next);
    },
    onFinalize: () => {
      'worklet';
      if (!active.get()) return;
      active.set(false);
      const p = positions.get();
      scheduleOnRN(onDrop, Object.keys(p).sort((a, b) => p[a] - p[b]));
      scheduleOnRN(onDragChange, false);
    },
  });

  const style = useAnimatedStyle(() => {
    const held = active.get();
    const slot = positions.get()[id] ?? index;
    return {
      zIndex: held ? 1 : 0,
      transform: [
        {
          translateX: held ? x.get() - index * stride : withTiming((slot - index) * stride),
        },
        { scale: withTiming(held ? 1.08 : 1, { duration: 120 }) },
      ],
    };
  }, [index, stride]);

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
  const positions = useSharedValue<Positions>(slots(ids));

  // New items or a saved order: every tile back to its own slot
  useEffect(() => {
    positions.set(slots(key ? key.split(',') : []));
  }, [key, positions]);

  return (
    <View style={[styles.row, { gap }]}>
      {leading}
      {items.map((item, i) => (
        <DraggableItem
          key={item.id}
          id={item.id}
          index={i}
          count={items.length}
          stride={itemWidth + gap}
          positions={positions}
          onDrop={onReorder}
          onDragChange={onDragChange}>
          {renderItem(item)}
        </DraggableItem>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
});
