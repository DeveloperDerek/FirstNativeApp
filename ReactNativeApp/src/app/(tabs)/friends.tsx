import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import {
  acceptFriendRequest,
  type Friendship,
  friendsLeaderboard,
  listFriendships,
  type PublicProfile,
  removeFriendship,
  searchUsers,
  sendFriendRequest,
} from '@/api/friends';
import { type LeaderboardRow, type Period, periodRange } from '@/api/steps';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import { GroundText } from '@/components/ground-text';
import { Leaderboard, PeriodPicker } from '@/components/leaderboard';
import { PlayerCard } from '@/components/player-card';
import { SharingRequired } from '@/components/sharing-required';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Row, Section } from '@/components/ui/section';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useNotificationCounts } from '@/hooks/use-notification-counts';
import { errorMessage } from '@/lib/error-message';

const name = (p: PublicProfile) => p.display_name || p.username;

/** Small character shown at the start of each person's row. */
const character = (p: PublicProfile) => (
  <Avatar
    config={normalizeAvatar(p.avatar)}
    scale={1}
    accessibilityLabel={`${name(p)}'s character`}
  />
);

export default function FriendsScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const myId = session?.user.id ?? '';
  const sharing = Boolean(profile?.sharing_consent_at);
  const { refreshCounts } = useNotificationCounts();

  const [period, setPeriod] = useState<Period>('week');
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicProfile[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The person whose profile card is open
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sharing) return;
    // The tab badge reloads with the list: on opening the tab, and right
    // after accept / decline so it drops straight away.
    refreshCounts();
    setError(null);
    try {
      const { fromDay, toDay } = periodRange(period);
      const [rows, list] = await Promise.all([
        friendsLeaderboard(fromDay, toDay),
        listFriendships(),
      ]);
      setBoard(rows);
      setFriendships(list);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [sharing, period, refreshCounts]);

  // Reload whenever the tab is opened, so new requests show up.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function pullToRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  /** Runs an action, shows any error, then reloads the lists. */
  async function act(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (e) {
      Alert.alert('Something went wrong', errorMessage(e));
    }
    await load();
  }

  async function search() {
    try {
      setResults(await searchUsers(query, myId));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const confirmRemove = (f: Friendship, other: PublicProfile) =>
    Alert.alert('Remove friend?', `${name(other)} will no longer see your steps.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => act(() => removeFriendship(f.id)) },
    ]);

  if (!sharing) {
    return (
      <Screen title="Friends">
        <SharingRequired />
      </Screen>
    );
  }

  const other = (f: Friendship) => (f.requester_id === myId ? f.addressee : f.requester);
  const incoming = friendships.filter((f) => f.status === 'pending' && f.addressee_id === myId);
  const outgoing = friendships.filter((f) => f.status === 'pending' && f.requester_id === myId);
  const accepted = friendships.filter((f) => f.status === 'accepted');
  const relatedIds = new Set(friendships.map((f) => other(f).id));
  // Looked up each render, so an open card follows the period picker
  const selectedRow = board.find((r) => r.user_id === selectedId);

  return (
    <Screen title="Friends" onRefresh={pullToRefresh} refreshing={refreshing}>
      {error && (
        // In a card, so the red reads on every map's ground
        <Section>
          <ThemedText type="small" themeColor="danger">
            {error}
          </ThemedText>
        </Section>
      )}

      <PeriodPicker value={period} onChange={setPeriod} />
      {board.length > 0 && <GroundText type="small">Tap a name to see their profile.</GroundText>}
      <Leaderboard rows={board} myId={myId} onSelect={(r) => setSelectedId(r.user_id)} />

      {incoming.length > 0 && (
        <Section title="Requests">
          {incoming.map((f) => (
            <Row
              key={f.id}
              title={name(f.requester)}
              detail={`@${f.requester.username}`}
              leading={character(f.requester)}>
              <Button
                title="Accept"
                size="small"
                onPress={() => act(() => acceptFriendRequest(f.id))}
              />
              <Button
                title="Decline"
                size="small"
                variant="secondary"
                onPress={() => act(() => removeFriendship(f.id))}
              />
            </Row>
          ))}
        </Section>
      )}

      <Section title="Add friends">
        <TextField
          placeholder="Search by username"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {results?.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            No users found.
          </ThemedText>
        )}
        {results?.map((p) => (
          <Row key={p.id} title={name(p)} detail={`@${p.username}`} leading={character(p)}>
            {relatedIds.has(p.id) ? (
              <ThemedText type="small" themeColor="textSecondary">
                Added
              </ThemedText>
            ) : (
              <Button
                title="Add"
                size="small"
                onPress={() => act(() => sendFriendRequest(myId, p.id))}
              />
            )}
          </Row>
        ))}
      </Section>

      {outgoing.length > 0 && (
        <Section title="Sent requests">
          {outgoing.map((f) => (
            <Row
              key={f.id}
              title={name(f.addressee)}
              detail="Waiting for them to accept"
              leading={character(f.addressee)}>
              <Button
                title="Cancel"
                size="small"
                variant="secondary"
                onPress={() => act(() => removeFriendship(f.id))}
              />
            </Row>
          ))}
        </Section>
      )}

      <Section title="Your friends">
        {accepted.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No friends yet. Search for someone by username above.
          </ThemedText>
        )}
        {accepted.map((f) => (
          <Row
            key={f.id}
            title={name(other(f))}
            detail={`@${other(f).username}`}
            leading={character(other(f))}>
            <Button
              title="Remove"
              size="small"
              variant="secondary"
              onPress={() => confirmRemove(f, other(f))}
            />
          </Row>
        ))}
      </Section>

      {/* Opens over the page when a ranking row is tapped */}
      <PlayerCard
        walker={
          selectedRow
            ? {
                id: selectedRow.user_id,
                name: selectedRow.display_name || 'Player',
                steps: Number(selectedRow.total_steps), // bigint arrives as a number or string
                avatar: selectedRow.avatar,
                isMe: selectedRow.user_id === myId,
              }
            : null
        }
        stepsLabel={period === 'today' ? 'Today' : 'Last 7 days'}
        onClose={() => setSelectedId(null)}
        onEditMine={() => router.navigate('/profile')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {
    paddingVertical: Spacing.one,
  },
});
