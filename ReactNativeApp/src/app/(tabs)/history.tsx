import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, DailyStepGoal, MaxContentWidth, Spacing } from '@/constants/theme';
import { dayRange } from '@/health';
import { HISTORY_DAYS, useSteps } from '@/hooks/use-steps';
import { useTheme } from '@/hooks/use-theme';
import { dayKey } from '@/storage/stepStore';

function dayLabel(daysAgo: number, date: Date) {
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function HistoryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { log } = useSteps();

  const days = Array.from({ length: HISTORY_DAYS }, (_, daysAgo) => {
    const { start } = dayRange(daysAgo);
    return { daysAgo, label: dayLabel(daysAgo, start), steps: log[dayKey(start)] };
  });
  const recorded = days.filter((d) => d.steps !== undefined);
  const max = Math.max(DailyStepGoal, ...recorded.map((d) => d.steps ?? 0));
  const average = recorded.length
    ? Math.round(recorded.reduce((sum, d) => sum + (d.steps ?? 0), 0) / recorded.length)
    : null;
  const plural = recorded.length === 1 ? 'day' : 'days';

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + Spacing.four,
          paddingBottom: insets.bottom + BottomTabInset + Spacing.three,
        },
      ]}>
      <View style={styles.inner}>
        <ThemedText type="subtitle">History</ThemedText>
        <ThemedText themeColor="textSecondary">
          {average === null
            ? 'No steps saved yet.'
            : `${average.toLocaleString()} steps/day average over ${recorded.length} ${plural}`}
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.card}>
          {days.map((d) => (
            <View key={d.daysAgo} style={styles.row}>
              <View style={styles.rowText}>
                <ThemedText type="small">{d.label}</ThemedText>
                <ThemedText type="smallBold" style={styles.num}>
                  {d.steps?.toLocaleString() ?? '--'}
                </ThemedText>
              </View>
              <ThemedView type="backgroundSelected" style={styles.track}>
                <View
                  style={[
                    styles.bar,
                    {
                      width: `${((d.steps ?? 0) / max) * 100}%`,
                      backgroundColor: theme.accent,
                      opacity: (d.steps ?? 0) >= DailyStepGoal ? 1 : 0.55,
                    },
                  ]}
                />
              </ThemedView>
            </View>
          ))}
        </ThemedView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  inner: {
    flex: 1,
    maxWidth: MaxContentWidth,
    gap: Spacing.two,
  },
  card: {
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.three,
  },
  row: {
    gap: Spacing.one,
  },
  rowText: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
