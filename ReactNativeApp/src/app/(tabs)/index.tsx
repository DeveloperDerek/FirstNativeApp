import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { friendsLeaderboard } from '@/api/friends';
import { type Group, groupLeaderboard, listMyGroups } from '@/api/groups';
import type { LeaderboardRow } from '@/api/steps';
import { useAuth } from '@/auth/AuthProvider';
import { CheckinCountdown } from '@/components/checkin-countdown';
import { CoinBalance } from '@/components/coin-balance';
import { Leaderboard } from '@/components/leaderboard';
import { SharingRequired } from '@/components/sharing-required';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, DailyStepGoal, MaxContentWidth, Spacing } from '@/constants/theme';
import { openHealthSettings, permissionHelp } from '@/health';
import { useSteps } from '@/hooks/use-steps';
import { useTheme } from '@/hooks/use-theme';
import { useWallet } from '@/hooks/use-wallet';
import { errorMessage } from '@/lib/error-message';
import { dayKey } from '@/storage/stepStore';
import { pickShown } from '@/track/scale';
import { StepTrack, type Walker } from '@/track/StepTrack';

type Mode = { kind: 'solo' } | { kind: 'friends' } | { kind: 'group'; id: string; name: string };

const modeKey = (m: Mode) => (m.kind === 'group' ? `group:${m.id}` : m.kind);
// The road scrolls, so up to about 30 characters stay manageable; past
// that only the top ones (plus you) are drawn. The ranked list underneath
// always shows everyone.
const MAX_ON_TRACK = 30;

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={selected ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.chip}>
        <ThemedText type="small" themeColor={selected ? 'text' : 'textSecondary'} numberOfLines={1}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export default function TodayScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { today, permission, loading, error, refresh } = useSteps();
  const { session, profile } = useAuth();
  const { balance, nextCheckin, checkIn } = useWallet();
  const myId = session?.user.id ?? '';
  const sharing = Boolean(profile?.sharing_consent_at);

  const [mode, setMode] = useState<Mode>({ kind: 'solo' });
  const [groups, setGroups] = useState<Group[]>([]);
  // Leaderboard rows remember which mode they belong to, so switching
  // modes never shows the previous mode's people.
  const [board, setBoard] = useState<{ key: string; rows: LeaderboardRow[] } | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const progress = Math.min((today ?? 0) / DailyStepGoal, 1);
  const blocked = permission === 'denied' || permission === 'unavailable';
  // iOS hides denied read access, so zero steps may really mean "no permission".
  const showIosZeroHint = Platform.OS === 'ios' && permission === 'granted' && today === 0;

  // Friends and Group modes reuse the Part 2/3 leaderboards for a single day.
  const loadBoard = useCallback(async () => {
    if (!sharing) return;
    try {
      const day = dayKey(new Date()); // "today" is your own calendar date
      const [rows, myGroups] = await Promise.all([
        mode.kind === 'friends'
          ? friendsLeaderboard(day, day)
          : mode.kind === 'group'
            ? groupLeaderboard(mode.id, day, day)
            : Promise.resolve([]),
        listMyGroups(),
      ]);
      setBoard({ key: modeKey(mode), rows });
      setGroups(myGroups);
      setBoardError(null);
    } catch (e) {
      setBoardError(errorMessage(e));
    }
  }, [mode, sharing]);

  // Load on open and when the mode changes, then poll lightly (every 60
  // seconds) while this screen is visible. Other people only move when
  // their own app syncs.
  useFocusEffect(
    useCallback(() => {
      loadBoard();
      const timer = setInterval(() => {
        refresh();
        loadBoard();
      }, 60_000);
      return () => clearInterval(timer);
    }, [loadBoard, refresh])
  );

  async function pullToRefresh() {
    setRefreshing(true);
    await Promise.all([refresh(), loadBoard(), checkIn().catch(() => {})]);
    setRefreshing(false);
  }

  const me: Walker = {
    id: myId,
    name: profile?.display_name || 'You',
    steps: today ?? 0,
    avatar: profile?.avatar,
    isMe: true,
  };

  let walkers: Walker[] = [me];
  if (mode.kind !== 'solo' && board?.key === modeKey(mode)) {
    walkers = board.rows.map((r) =>
      r.user_id === myId
        ? me // show my live phone count even if the upload lagged
        : {
            id: r.user_id,
            name: r.display_name || 'Player',
            steps: Number(r.total_steps), // bigint arrives as a number or string
            avatar: r.avatar,
            isMe: false,
          }
    );
    if (!walkers.some((w) => w.isMe)) walkers.push(me);
  }
  const socialLoading = mode.kind !== 'solo' && board?.key !== modeKey(mode) && !boardError;
  const ranked: LeaderboardRow[] = [...walkers]
    .sort((a, b) => b.steps - a.steps)
    .map((w) => ({ user_id: w.id, display_name: w.name, avatar: w.avatar, total_steps: w.steps }));

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} />}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + Spacing.two,
          paddingBottom: insets.bottom + BottomTabInset + Spacing.three,
        },
      ]}>
      <View style={styles.inner}>
        <View style={styles.topBar}>
          <CoinBalance balance={balance} />
          <Pressable
            onPress={() => router.push('/shop')}
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="linkPrimary">Shop</ThemedText>
          </Pressable>
        </View>
        <CheckinCountdown nextAt={nextCheckin} />

        <View style={styles.hero}>
          <ThemedText type="code" themeColor="textSecondary" style={styles.caps}>
            Today
          </ThemedText>
          <ThemedText style={styles.count}>{today?.toLocaleString() ?? '--'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {Math.round(progress * 100)}% of {DailyStepGoal.toLocaleString()} goal
            {progress >= 1 && sharing ? ' · +100 coins' : ''}
          </ThemedText>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chips}>
            <Chip
              label="Just me"
              selected={mode.kind === 'solo'}
              onPress={() => setMode({ kind: 'solo' })}
            />
            <Chip
              label="Friends"
              selected={mode.kind === 'friends'}
              onPress={() => setMode({ kind: 'friends' })}
            />
            {groups.map((g) => (
              <Chip
                key={g.id}
                label={g.name}
                selected={mode.kind === 'group' && mode.id === g.id}
                onPress={() => setMode({ kind: 'group', id: g.id, name: g.name })}
              />
            ))}
          </View>
        </ScrollView>

        {mode.kind !== 'solo' && !sharing ? (
          // Same rule as the Friends and Groups tabs: comparing needs sharing.
          <SharingRequired />
        ) : (
          <>
            <StepTrack walkers={pickShown(walkers, MAX_ON_TRACK)} />
            {socialLoading && <ActivityIndicator />}
            {boardError && mode.kind !== 'solo' && (
              <ThemedText type="small" themeColor="danger">
                {boardError}
              </ThemedText>
            )}
            {mode.kind !== 'solo' && board?.key === modeKey(mode) && (
              <>
                {walkers.length > MAX_ON_TRACK && (
                  <ThemedText type="small" themeColor="textSecondary">
                    Showing the top {MAX_ON_TRACK} and you on the road. Everyone is listed below.
                  </ThemedText>
                )}
                <Leaderboard rows={ranked} myId={myId} />
                <ThemedText type="small" themeColor="textSecondary">
                  Others move when their app syncs. Someone who has not opened StepTracker today
                  shows at 0.
                </ThemedText>
              </>
            )}
          </>
        )}

        {(blocked || showIosZeroHint || error) && (
          <ThemedView type="backgroundElement" style={styles.notice}>
            {error && (
              <ThemedText type="small" themeColor="danger">
                {error}
              </ThemedText>
            )}
            {blocked && <ThemedText type="small">{permissionHelp[permission]}</ThemedText>}
            {showIosZeroHint && (
              <ThemedText type="small">
                Seeing 0? Check Settings › Health › Data Access & Devices › StepTracker and allow
                Steps.
              </ThemedText>
            )}
            {blocked && Platform.OS !== 'web' && (
              <Pressable onPress={() => openHealthSettings(permission)}>
                <ThemedText type="linkPrimary">
                  {permission === 'unavailable' && Platform.OS === 'android'
                    ? 'Get Health Connect'
                    : 'Open settings'}
                </ThemedText>
              </Pressable>
            )}
          </ThemedView>
        )}

        <Pressable
          onPress={refresh}
          disabled={loading}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.accent },
            (pressed || loading) && styles.pressed,
          ]}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.buttonText}>Refresh</ThemedText>
          )}
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary" style={styles.fineprint}>
          Manually entered steps and steps from unsupported apps do not count.
        </ThemedText>
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
    gap: Spacing.three,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.one,
    marginVertical: Spacing.two,
  },
  caps: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  count: {
    fontSize: 56,
    lineHeight: 64,
    fontWeight: 700,
    fontVariant: ['tabular-nums'],
  },
  chips: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  chip: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    maxWidth: 160,
  },
  notice: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  button: {
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 600,
  },
  fineprint: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
