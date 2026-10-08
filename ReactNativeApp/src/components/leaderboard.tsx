import { Pressable, StyleSheet, View } from 'react-native';

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

/** Ranked list of step totals with a bar relative to the leader. */
export function Leaderboard({ rows, myId }: { rows: LeaderboardRow[]; myId?: string }) {
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
        return (
          <View key={r.user_id} style={styles.entry}>
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
          </View>
        );
      })}
    </Section>
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
