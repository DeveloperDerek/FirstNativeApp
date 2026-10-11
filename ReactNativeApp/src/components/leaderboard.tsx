import { Pressable, StyleSheet, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import type { LeaderboardRow, Period } from '@/api/steps';
import { Avatar } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Section } from '@/components/ui/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
];

export function PeriodPicker({
  value,
  onChange,
}: {
  value: Period;
  onChange: (period: Period) => void;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.picker}>
      {PERIODS.map((p) => (
        <Pressable
          key={p.value}
          onPress={() => onChange(p.value)}
          style={styles.pickerItem}
          accessibilityRole="button"
          accessibilityState={{ selected: value === p.value }}>
          <ThemedView
            type={value === p.value ? 'backgroundSelected' : 'backgroundElement'}
            style={styles.pickerPill}>
            <ThemedText type="small" themeColor={value === p.value ? 'text' : 'textSecondary'}>
              {p.label}
            </ThemedText>
          </ThemedView>
        </Pressable>
      ))}
    </ThemedView>
  );
}

/**
 * Ranked list of step totals with a bar relative to the leader. With
 * onSelect, each row is a button (with an arrow) that opens that person.
 * With onRemove, everyone else's row swipes left to show a Remove button.
 */
export function Leaderboard({
  rows,
  myId,
  onSelect,
  onRemove,
}: {
  rows: LeaderboardRow[];
  myId?: string;
  onSelect?: (row: LeaderboardRow) => void;
  onRemove?: (row: LeaderboardRow) => void;
}) {
  const theme = useTheme();
  const max = Math.max(1, ...rows.map((r) => Number(r.total_steps)));

  return (
    <Section>
      {rows.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          No one here yet.
        </ThemedText>
      )}
      {rows.map((r, i) => {
        const steps = Number(r.total_steps); // bigint arrives as a number or string
        const isMe = r.user_id === myId;
        const name = r.display_name || 'Unnamed';
        const entry = (
          <View style={[styles.entry, onSelect && styles.tappable]}>
            <Avatar
              config={normalizeAvatar(r.avatar)}
              scale={1}
              accessibilityLabel={`${name}'s character`}
            />
            <View style={styles.row}>
              <View style={styles.rowText}>
                <ThemedText
                  type={isMe ? 'smallBold' : 'small'}
                  numberOfLines={1}
                  style={styles.name}>
                  {i + 1}. {name}
                  {isMe ? ' (you)' : ''}
                </ThemedText>
                <ThemedText type="smallBold" style={styles.num}>
                  {steps.toLocaleString()}
                </ThemedText>
              </View>
              <ThemedView type="backgroundSelected" style={styles.track}>
                <View
                  style={[
                    styles.bar,
                    { width: `${(steps / max) * 100}%`, backgroundColor: theme.accent },
                  ]}
                />
              </ThemedView>
            </View>
            {onSelect && (
              // The usual hint that a row opens something
              <ThemedText themeColor="textSecondary" style={styles.arrow}>
                ›
              </ThemedText>
            )}
          </View>
        );
        const item = onSelect ? (
          <Pressable
            key={r.user_id}
            onPress={() => onSelect(r)}
            accessibilityRole="button"
            accessibilityLabel={`${i + 1}. ${name}${isMe ? ' (you)' : ''}, ${steps.toLocaleString()} steps`}
            accessibilityHint="Opens their profile"
            style={({ pressed }) => pressed && styles.pressed}>
            {entry}
          </Pressable>
        ) : (
          <View key={r.user_id}>{entry}</View>
        );
        if (!onRemove || isMe) return item;
        return (
          <Swipeable
            key={r.user_id}
            friction={2}
            rightThreshold={40}
            overshootRight={false}
            renderRightActions={(progress, _translation, swipeable) => (
              <RemoveAction
                progress={progress}
                name={name}
                onPress={() => {
                  swipeable.close();
                  onRemove(r);
                }}
              />
            )}>
            {/* Swiping isn't reachable with a screen reader, so offer it as an action too */}
            <View
              accessible
              accessibilityLabel={`${i + 1}. ${name}, ${steps.toLocaleString()} steps`}
              accessibilityHint="Swipe left to remove from the group"
              accessibilityActions={[{ name: 'remove', label: 'Remove from group' }]}
              onAccessibilityAction={(e) => e.nativeEvent.actionName === 'remove' && onRemove(r)}
              style={styles.swipeRow}>
              {item}
            </View>
          </Swipeable>
        );
      })}
    </Section>
  );
}

/**
 * The red button a swipe uncovers. It sits behind the row, which has no
 * background of its own, so it stays invisible until the row moves.
 */
function RemoveAction({
  progress,
  name,
  onPress,
}: {
  progress: SharedValue<number>;
  name: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const fade = useAnimatedStyle(() => ({ opacity: Math.min(1, progress.value) }));
  return (
    <Animated.View style={fade}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${name} from the group`}
        style={[styles.remove, { backgroundColor: theme.danger }]}>
        <ThemedText type="smallBold" style={styles.removeText}>
          Remove
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  picker: {
    flexDirection: 'row',
    borderRadius: Spacing.four,
    padding: Spacing.one,
    marginTop: Spacing.two,
  },
  pickerItem: {
    flex: 1,
  },
  pickerPill: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  tappable: {
    minHeight: 56, // easy to hit; keep it above 44
  },
  arrow: {
    fontSize: 24,
    lineHeight: 28,
  },
  pressed: {
    opacity: 0.6,
  },
  swipeRow: {
    minHeight: 56, // room to grab the row
    justifyContent: 'center',
  },
  remove: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    marginLeft: Spacing.two,
    borderRadius: Spacing.two,
  },
  removeText: {
    color: '#fff',
  },
  row: {
    flex: 1,
    gap: Spacing.one,
  },
  rowText: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  name: {
    flex: 1,
  },
  num: {
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 4,
  },
});
