import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { PillPicker } from '@/components/leaderboard';
import { StreakLine } from '@/components/streak-line';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/AuthProvider';
import {
  addDays,
  daysBetween,
  daysFrom,
  type HistoryDay,
  type HistoryView,
  monthAverage,
  monthOf,
  type MonthRow,
  parseDay,
} from '@/history/history';
import { useHistory } from '@/hooks/use-history';
import { useMapTheme } from '@/hooks/use-map-theme';
import { useSteps } from '@/hooks/use-steps';
import { useTheme } from '@/hooks/use-theme';

const VIEWS: { value: HistoryView; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];
const UNIT: Record<HistoryView, string> = { week: 'week', month: 'month', year: 'year' };
/** The server's earliest year (my_history_by_month) */
const FIRST_YEAR = 2000;

const NOT_SYNCED_NOTE =
  'Your steps are sent when you open the app, for the last 7 days only. Days that were ' +
  "older than that weren't sent, so they don't count toward your streak or coins and " +
  "can't be shown here.";

const monthName = (month: string) =>
  parseDay(month).toLocaleDateString(undefined, { month: 'long' });

const short = (day: string) =>
  parseDay(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function periodLabel(view: HistoryView, offset: number, range: { from: string; to: string }) {
  if (view === 'week') {
    return offset === 0 ? 'Last 7 days' : `${short(range.from)} – ${short(range.to)}`;
  }
  if (view === 'month') {
    return parseDay(range.from).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  return range.from.slice(0, 4);
}

function dayLabel(day: string, today: string) {
  const daysAgo = daysBetween(day, today);
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return parseDay(day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export default function HistoryScreen() {
  const { theme: mapTheme } = useMapTheme();
  const { profile } = useAuth();
  const sharing = Boolean(profile?.sharing_consent_at);
  const { today: todaySteps, streak, refresh } = useSteps();
  const [view, setView] = useState<HistoryView>('week');
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const h = useHistory(view, offset);

  const missing = h.stats ? h.stats.dayCount - h.stats.daysWithData : 0;
  const canGoBack =
    h.stats !== null &&
    (offset === 0 || h.stats.daysWithData > 0) &&
    Number(h.range.from.slice(0, 4)) > FIRST_YEAR;
  const unit = UNIT[view];

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    h.reload();
    setRefreshing(false);
  };

  return (
    <Screen title="History" onRefresh={onRefresh} refreshing={refreshing}>
      {/* All-time, so once here rather than with each view (decision 9: sharers only) */}
      <StreakLine streak={streak} steps={todaySteps ?? 0} color={mapTheme.ink} />

      <PillPicker
        options={VIEWS}
        value={view}
        onChange={(v) => {
          setView(v);
          setOffset(0);
        }}
      />

      <View style={styles.nav}>
        <Pressable
          onPress={() => setOffset((o) => o + 1)}
          disabled={!canGoBack}
          hitSlop={Spacing.three}
          accessibilityRole="button"
          accessibilityLabel={`Previous ${unit}`}
          accessibilityState={{ disabled: !canGoBack }}
          style={!canGoBack && styles.disabled}>
          <ThemedText type="subtitle">‹</ThemedText>
        </Pressable>
        <ThemedText type="smallBold" accessibilityRole="header">
          {periodLabel(view, offset, h.range)}
        </ThemedText>
        <Pressable
          onPress={() => setOffset((o) => Math.max(0, o - 1))}
          disabled={offset === 0}
          hitSlop={Spacing.three}
          accessibilityRole="button"
          accessibilityLabel={`Next ${unit}`}
          accessibilityState={{ disabled: offset === 0 }}
          style={offset === 0 && styles.disabled}>
          <ThemedText type="subtitle">›</ThemedText>
        </Pressable>
      </View>

      {h.error && (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="danger">
            Couldn&apos;t load your history. {h.error}
          </ThemedText>
          <Pressable onPress={h.reload} accessibilityRole="button">
            <ThemedText type="linkPrimary">Retry</ThemedText>
          </Pressable>
        </ThemedView>
      )}

      {h.loading && <ActivityIndicator style={styles.loading} />}

      {h.stats && (
        <ThemedView type="backgroundElement" style={styles.card}>
          <View style={styles.stats}>
            <Stat label="Total" value={h.stats.total.toLocaleString()} />
            <Stat
              label="Average a day"
              value={h.stats.average === null ? '--' : h.stats.average.toLocaleString()}
            />
            <Stat
              label={h.stats.best ? `Best day · ${short(h.stats.best.day)}` : 'Best day'}
              value={h.stats.best ? h.stats.best.steps.toLocaleString() : '--'}
            />
            <Stat
              label="Days at goal"
              value={`${h.stats.daysAtGoal} of ${h.stats.daysWithData}`}
            />
          </View>
          {missing > 0 &&
            (sharing ? (
              <Pressable
                onPress={() => Alert.alert('Days not synced', NOT_SYNCED_NOTE)}
                accessibilityRole="button">
                <ThemedText type="small" themeColor="textSecondary">
                  {missing} {missing === 1 ? 'day' : 'days'} not synced.{' '}
                  <ThemedText type="linkPrimary">What&apos;s this?</ThemedText>
                </ThemedText>
              </Pressable>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {missing} {missing === 1 ? 'day' : 'days'} without step data.
              </ThemedText>
            ))}
          {Platform.OS === 'ios' && h.stats.daysWithData > 0 && h.stats.total === 0 && (
            <ThemedText type="small">
              Seeing 0? Check Settings › Health › Data Access & Devices › StepTracker and allow
              Steps.
            </ThemedText>
          )}
        </ThemedView>
      )}

      {h.days && view === 'week' && <WeekRows days={h.days} today={h.today} />}
      {h.days && view === 'month' && <MonthChart days={h.days} from={h.range.from} />}
      {h.months && view === 'year' && (
        <YearChart months={h.months} year={h.range.from.slice(0, 4)} />
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={styles.num}>
        {value}
      </ThemedText>
    </View>
  );
}

/** The 7 days as rows (as before), newest first, each judged by its own goal. */
function WeekRows({ days, today }: { days: HistoryDay[]; today: string }) {
  const theme = useTheme();
  const max = Math.max(1, ...days.map((d) => Math.max(d.goal, d.steps ?? 0)));
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {[...days].reverse().map((d) => (
        <View key={d.day} style={styles.row}>
          <View style={styles.rowText}>
            <ThemedText type="small">{dayLabel(d.day, today)}</ThemedText>
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
                  opacity: d.steps !== null && d.steps >= d.goal ? 1 : 0.55,
                },
              ]}
            />
          </ThemedView>
        </View>
      ))}
    </ThemedView>
  );
}

type Column = {
  key: string;
  /** null = no data that day (a faint stub) */
  value: number | null;
  /** Full color: a day at its goal */
  strong: boolean;
  /** A day still to come: keeps its place, draws nothing */
  future?: boolean;
  label?: string;
};

/**
 * Bars from the bottom: full color at goal, lighter below it, a faint
 * stub for a day with no data, nothing for a day still to come.
 */
function Columns({
  columns,
  max,
  accessibilityLabel,
}: {
  columns: Column[];
  max: number;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <ThemedView
      type="backgroundElement"
      style={styles.card}
      accessible
      accessibilityLabel={accessibilityLabel}>
      <View style={styles.columns}>
        {columns.map((c) => (
          <View key={c.key} style={styles.column}>
            {!c.future && c.value === null && (
              <View style={[styles.stub, { backgroundColor: theme.textSecondary }]} />
            )}
            {!c.future && c.value !== null && (
              <View
                style={[
                  styles.columnBar,
                  {
                    height: `${Math.max((c.value / max) * 100, 1)}%`,
                    backgroundColor: theme.accent,
                    opacity: c.strong ? 1 : 0.55,
                  },
                ]}
              />
            )}
          </View>
        ))}
      </View>
      <View style={styles.columnLabels}>
        {columns.map((c) => (
          <ThemedText
            key={c.key}
            type="small"
            themeColor="textSecondary"
            style={styles.columnLabel}
            numberOfLines={1}>
            {c.label ?? ''}
          </ThemedText>
        ))}
      </View>
    </ThemedView>
  );
}

/** Every day of the calendar month, the ones still to come left empty. */
function MonthChart({ days, from }: { days: HistoryDay[]; from: string }) {
  const lastDay = addDays(monthOf(addDays(from, 31)), -1);
  const byDay = new Map(days.map((d) => [d.day, d]));
  const columns = daysFrom(from, lastDay).map((day): Column => {
    const d = byDay.get(day);
    const n = Number(day.slice(8));
    const label = n % 7 === 1 ? String(n) : undefined; // 1, 8, 15, 22, 29
    if (!d) return { key: day, value: null, strong: false, future: true, label };
    return { key: day, value: d.steps, strong: d.steps !== null && d.steps >= d.goal, label };
  });
  const max = Math.max(1, ...days.map((d) => Math.max(d.goal, d.steps ?? 0)));
  const known = days.filter((d) => d.steps !== null);
  return (
    <Columns
      columns={columns}
      max={max}
      accessibilityLabel={`Steps each day: ${known
        .map((d) => `${short(d.day)} ${d.steps!.toLocaleString()}`)
        .join(', ')}`}
    />
  );
}

/** January to December: each month's average a day. */
function YearChart({ months, year }: { months: MonthRow[]; year: string }) {
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const columns: Column[] = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}-01`;
    const m = byMonth.get(key);
    const label = parseDay(key).toLocaleDateString(undefined, { month: 'narrow' });
    return { key, value: m ? monthAverage(m) : null, strong: true, label };
  });
  const max = Math.max(1, ...columns.map((c) => c.value ?? 0));
  return (
    <Columns
      columns={columns}
      max={max}
      accessibilityLabel={`Average steps a day by month: ${months
        .map((m) => `${monthName(m.month)} ${monthAverage(m)?.toLocaleString()}`)
        .join(', ')}`}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.three,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  disabled: {
    opacity: 0.3,
  },
  loading: {
    marginTop: Spacing.four,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: Spacing.three,
  },
  stat: {
    width: '50%',
    gap: Spacing.half,
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
  columns: {
    height: 120,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  column: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  columnBar: {
    width: '100%',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  stub: {
    height: 2,
    opacity: 0.35,
  },
  columnLabels: {
    flexDirection: 'row',
    gap: 2,
    marginTop: -Spacing.two,
  },
  columnLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 12,
  },
});
