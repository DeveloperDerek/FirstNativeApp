import { useFocusEffect, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import {
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
import { PlayerCard } from '@/components/player-card';
import { QuestBanners } from '@/components/quest-banners';
import { SharingRequired } from '@/components/sharing-required';
import { ThemedButton } from '@/components/themed-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, DailyStepGoal, GameFont, MaxContentWidth, Spacing } from '@/constants/theme';
import { openHealthSettings, permissionHelp } from '@/health';
import { useMapTheme } from '@/hooks/use-map-theme';
import { useSteps } from '@/hooks/use-steps';
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

export default function TodayScreen() {
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
  // The person whose profile card is open. Looked up by id each render,
  // so the step count on an open card stays current when the board refreshes.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // You always see YOUR map, even in Friends and Group modes. It is
  // chosen on the Profile page.
  const { theme } = useMapTheme();

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

  // On open: status bar text that reads on this map's sky, load the
  // board, then poll lightly every 60 seconds while visible. Other people
  // only move when their own app syncs.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(theme.statusBar);
      loadBoard();
      const timer = setInterval(() => {
        refresh();
        loadBoard();
      }, 60_000);
      return () => {
        clearInterval(timer);
        setStatusBarStyle('auto');
      };
    }, [loadBoard, refresh, theme.statusBar])
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
  const ink = { color: theme.ink };
  const selected = walkers.find((w) => w.id === selectedId) ?? null;

  return (
    // The ground color fills the whole screen, down to the bottom edge
    <View style={[styles.screen, { backgroundColor: theme.ground }]}>
      {/* Sky color from the very top of the screen (behind the status bar) down to the road */}
      <View style={{ backgroundColor: theme.sky, paddingTop: insets.top }}>
        <View style={styles.header}>
          <View style={styles.topBar}>
            <CoinBalance balance={balance} color={theme.skyInk} />
            <Pressable
              onPress={() => router.push('/shop')}
              accessibilityRole="button"
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="smallBold" style={[styles.shopLink, { color: theme.skyInk }]}>
                Shop
              </ThemedText>
            </Pressable>
          </View>
          <View style={styles.hero}>
            <ThemedText type="code" style={[styles.caps, { color: theme.skyInk }]}>
              Today
            </ThemedText>
            <ThemedText style={[styles.count, { color: theme.skyInk }]}>
              {today?.toLocaleString() ?? '--'}
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.skyInk }}>
              {Math.round(progress * 100)}% of {DailyStepGoal.toLocaleString()} goal
              {progress >= 1 && sharing ? ' · +100 coins' : ''}
            </ThemedText>
            <CheckinCountdown nextAt={nextCheckin} color={theme.skyInk} />
          </View>
        </View>
      </View>

      {/* Edge to edge: no padding around the map. It stays put while the list scrolls. */}
      {mode.kind !== 'solo' && !sharing ? null : (
        <StepTrack walkers={pickShown(walkers, MAX_ON_TRACK)} theme={theme} />
      )}

      <ScrollView
        style={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} tintColor={theme.ink} />
        }
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
        ]}>
        <View style={styles.inner}>
          {sharing && <QuestBanners />}

          <ThemedText type="smallBold" style={ink}>
            Who
          </ThemedText>
          <View style={styles.wrap}>
            <ThemedButton
              theme={theme}
              title="Just me"
              selected={mode.kind === 'solo'}
              onPress={() => setMode({ kind: 'solo' })}
            />
            <ThemedButton
              theme={theme}
              title="Friends"
              selected={mode.kind === 'friends'}
              onPress={() => setMode({ kind: 'friends' })}
            />
            {groups.map((g) => (
              <ThemedButton
                key={g.id}
                theme={theme}
                title={g.name}
                selected={mode.kind === 'group' && mode.id === g.id}
                onPress={() => setMode({ kind: 'group', id: g.id, name: g.name })}
              />
            ))}
          </View>

          {mode.kind !== 'solo' && !sharing && (
            // Same rule as the Friends and Groups tabs: comparing needs sharing.
            <SharingRequired />
          )}
          {socialLoading && (
            <ThemedText type="small" style={ink}>
              Loading…
            </ThemedText>
          )}
          {boardError && mode.kind !== 'solo' && (
            <ThemedView type="backgroundElement" style={styles.notice}>
              <ThemedText type="small" themeColor="danger">
                {boardError}
              </ThemedText>
            </ThemedView>
          )}

          {mode.kind !== 'solo' && board?.key === modeKey(mode) && (
            <>
              {walkers.length > MAX_ON_TRACK && (
                <ThemedText type="small" style={ink}>
                  Showing the top {MAX_ON_TRACK} and you on the road. Everyone is listed below.
                </ThemedText>
              )}
              <ThemedText type="small" style={ink}>
                Tap a name to see their profile.
              </ThemedText>
              <Leaderboard rows={ranked} myId={myId} onSelect={(r) => setSelectedId(r.user_id)} />
              <ThemedText type="small" style={ink}>
                Others move when their app syncs. Someone who has not opened StepTracker today
                shows at 0.
              </ThemedText>
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

          <ThemedButton
            theme={theme}
            title="Refresh"
            size="large"
            loading={loading}
            onPress={refresh}
          />
        </View>
      </ScrollView>

      {/* Opens over the page (and the tab bar) when a ranking row is tapped */}
      <PlayerCard
        walker={selected}
        onClose={() => setSelectedId(null)}
        onEditMine={() => router.navigate('/profile')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  shopLink: {
    textDecorationLine: 'underline',
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.half,
  },
  caps: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  count: {
    fontSize: 48,
    lineHeight: 56,
    fontFamily: GameFont.bold,
    fontVariant: ['tabular-nums'],
  },
  list: {
    flex: 1,
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  inner: {
    flex: 1,
    maxWidth: MaxContentWidth,
    gap: Spacing.three,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  notice: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
});
