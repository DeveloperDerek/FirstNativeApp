import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { type ActivityLine, dayLabel, type Giver } from '@/activity/activity';
import { lineKudos } from '@/api/activity';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  type Friendship,
  friendsLeaderboard,
  listFriendships,
  type PublicProfile,
  removeFriend,
  searchUsers,
  sendFriendRequest,
} from '@/api/friends';
import { type LeaderboardRow, myToday, type Period } from '@/api/steps';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import { ActivityList } from '@/components/activity-list';
import { GroundText } from '@/components/ground-text';
import { GiversSheet, NewKudosSheet } from '@/components/kudos-sheet';
import { personMenu, reportHref } from '@/components/block-actions';
import { Leaderboard, periodLabel, PERIODS, PillPicker, rowToWalker } from '@/components/leaderboard';
import { MoreButton } from '@/components/more-button';
import { PlayerCard } from '@/components/player-card';
import { SharingRequired } from '@/components/sharing-required';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Row, Section } from '@/components/ui/section';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useFriendsActivity } from '@/hooks/use-friends-activity';
import { useNewKudos } from '@/hooks/use-new-kudos';
import { useNotificationCounts } from '@/hooks/use-notification-counts';
import { errorMessage } from '@/lib/error-message';
import * as haptics from '@/lib/haptics';
import { askForPush } from '@/notifications/push';

const name = (p: PublicProfile) => p.display_name || p.username;

// The two rankings, and the activity board (step-tracker-activity-board.txt)
type View = Period | 'activity';

/** "Updated 5m ago"; nothing under a minute. */
function updatedText(at: number | null): string | null {
  if (at === null) return null;
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return null;
  return minutes < 60 ? `Updated ${minutes}m ago` : `Updated ${Math.floor(minutes / 60)}h ago`;
}

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
  const { session, profile, account } = useAuth();
  const myId = session?.user.id ?? '';
  const sharing = Boolean(profile?.sharing_consent_at);
  const { counts, refreshCounts } = useNotificationCounts();

  const [view, setView] = useState<View>('week');
  // The board's lines open a card with today's steps, from the Today ranking
  const period: Period = view === 'activity' ? 'today' : view;
  const activity = useFriendsActivity(sharing ? myId : '', sharing && view === 'activity');
  // Kudos (step-tracker-kudos.txt): the "New kudos" list marks them seen;
  // once the server confirms, the tab dot and the line dots go
  const clearNewKudos = activity.clearNewKudos;
  const kudos = useNewKudos(
    sharing ? myId : '',
    useCallback(() => {
      refreshCounts();
      clearNewKudos();
    }, [refreshCounts, clearNewKudos])
  );
  // Who gave kudos on your line for that day, while that list is open
  const [givers, setGivers] = useState<{ day: string; list: Giver[] | null; error: string | null } | null>(
    null
  );
  // With new kudos, the Activity button gets a dot so they know where to look
  const views: { value: View; label: string; dot?: string }[] = [
    ...PERIODS,
    { value: 'activity', label: 'Activity', dot: counts.newKudos > 0 ? 'new kudos' : undefined },
  ];
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicProfile[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown in the Add friends card
  const [searchError, setSearchError] = useState<string | null>(null);
  // The person whose profile card is open
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The ranking, again whenever the period changes
  const loadBoard = useCallback(async () => {
    if (!sharing) return;
    setError(null);
    try {
      setBoard(await friendsLeaderboard(period));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [sharing, period]);

  // Friends and requests; not reloaded by switching views
  const loadFriends = useCallback(async () => {
    if (!sharing) return;
    // The tab badge reloads with the list: on opening the tab, and right
    // after accept / decline so it drops straight away.
    refreshCounts();
    try {
      setFriendships(await listFriendships());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [sharing, refreshCounts]);

  const load = useCallback(() => Promise.all([loadBoard(), loadFriends()]), [loadBoard, loadFriends]);

  const refreshActivity = activity.refresh;
  const onActivity = view === 'activity';

  // Reload whenever the tab is opened, so new requests show up.
  useFocusEffect(
    useCallback(() => {
      loadFriends();
    }, [loadFriends])
  );
  useFocusEffect(
    useCallback(() => {
      loadBoard();
    }, [loadBoard])
  );
  useFocusEffect(
    useCallback(() => {
      if (onActivity) refreshActivity();
    }, [onActivity, refreshActivity])
  );

  async function pullToRefresh() {
    setRefreshing(true);
    await Promise.all([load(), onActivity && refreshActivity({ force: true, replace: true })]);
    setRefreshing(false);
  }

  /** Someone blocked or removed here: off the board at once, then reload. */
  function gone(id: string) {
    activity.dropPerson(id);
    load();
  }

  function openLine(l: ActivityLine) {
    setSelectedId(l.user_id);
  }

  /** Who gave kudos on one of your lines. Seeing it marks nothing. */
  function openGivers(l: ActivityLine) {
    setGivers({ day: l.day, list: null, error: null });
    lineKudos(l)
      .then((list) => setGivers((g) => (g?.day === l.day ? { ...g, list } : g)))
      .catch((e) => setGivers((g) => (g?.day === l.day ? { ...g, error: errorMessage(e) } : g)));
  }

  const closeGivers = () => setGivers(null);

  /** A giver tapped in a kudos list: the list closes, their card opens. */
  function openGiver(g: Giver) {
    closeGivers();
    kudos.close();
    setSelectedId(g.user_id);
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
    setSearchError(null);
    try {
      setResults(await searchUsers(query, myId));
    } catch (e) {
      setSearchError(errorMessage(e));
    }
  }

  // Report is offered only once reviewing works (a server setting)
  const reportFor = (p: PublicProfile) =>
    account?.reportsEnabled
      ? () => router.push(reportHref('person', p.id, `@${p.username}`))
      : undefined;

  const confirmRemove = (f: Friendship, other: PublicProfile) => {
    haptics.warn(); // it can't be undone
    Alert.alert('Remove friend?', `${name(other)} will no longer see your steps.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => act(() => removeFriend(f.id)).then(() => activity.dropPerson(other.id)),
      },
    ]);
  };

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

      <PillPicker options={views} value={view} onChange={setView} />
      {onActivity ? (
        <>
          {activity.error && activity.loaded && (
            <GroundText type="small">Couldn&apos;t refresh. Pull to try again.</GroundText>
          )}
          {!activity.error && updatedText(activity.updatedAt) && (
            <GroundText type="small">{updatedText(activity.updatedAt)}</GroundText>
          )}
          {accepted.length === 0 && activity.loaded && activity.lines.length === 0 ? (
            <Section>
              <ThemedText type="small" themeColor="textSecondary">
                Add friends to see what they&apos;re up to.
              </ThemedText>
            </Section>
          ) : (
            <ActivityList
              lines={activity.lines}
              myId={myId}
              today={myToday()}
              loaded={activity.loaded}
              hasOlder={activity.hasOlder}
              loadingOlder={activity.loadingOlder}
              hasNew={activity.hasNew}
              onSelect={openLine}
              onOlder={activity.loadOlder}
              onShowNew={activity.showNew}
              newKudos={counts.newKudos}
              onGiveKudos={activity.giveKudos}
              onOpenGivers={openGivers}
              onOpenNewKudos={kudos.show}
            />
          )}
        </>
      ) : (
        <>
          {board.length > 0 && <GroundText type="small">Tap a name to see their profile.</GroundText>}
          <Leaderboard rows={board} myId={myId} onSelect={(r) => setSelectedId(r.user_id)} />
        </>
      )}

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
                onPress={() => {
                  haptics.tap();
                  act(() => acceptFriendRequest(f.id));
                }}
              />
              <Button
                title="Decline"
                size="small"
                variant="secondary"
                onPress={() => act(() => declineFriendRequest(f.id))}
              />
              <MoreButton
                onPress={() =>
                  personMenu(f.requester, {
                    onChanged: () => gone(f.requester.id),
                    onReport: reportFor(f.requester),
                  })
                }
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
        {searchError && (
          <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
            {searchError}
          </ThemedText>
        )}
        {results?.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            No users found.
          </ThemedText>
        )}
        {results?.map((p) => (
          <Row key={p.id} title={name(p)} detail={`@${p.username}`} leading={character(p)}>
            <MoreButton
              onPress={() =>
                personMenu(p, {
                  onChanged: () => {
                    // Gone for you now: off the results and the lists
                    setResults((r) => r?.filter((x) => x.id !== p.id) ?? null);
                    gone(p.id);
                  },
                  onReport: reportFor(p),
                })
              }
            />
            {relatedIds.has(p.id) ? (
              <ThemedText type="small" themeColor="textSecondary">
                Added
              </ThemedText>
            ) : (
              <Button
                title="Add"
                size="small"
                onPress={() =>
                  act(async () => {
                    await sendFriendRequest(myId, p.id);
                    // A good moment to ask (only ever asked once): they
                    // will want to hear when someone adds them back
                    askForPush().catch(() => {});
                  })
                }
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
                onPress={() => act(() => cancelFriendRequest(f.id))}
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
        walker={selectedRow ? rowToWalker(selectedRow, myId) : null}
        stepsLabel={periodLabel(period)}
        onClose={() => setSelectedId(null)}
        onEditMine={() => router.navigate('/profile')}
        onBlockChanged={() => (selectedId ? gone(selectedId) : load())}
      />

      {kudos.open && (
        <NewKudosSheet
          list={kudos.list}
          error={kudos.error}
          today={myToday()}
          onSelect={openGiver}
          onClose={kudos.close}
        />
      )}
      {givers && (
        <GiversSheet
          title={`Kudos for ${dayLabel(givers.day, myToday())}`}
          givers={givers.list}
          error={givers.error}
          onSelect={openGiver}
          onClose={closeGivers}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {
    paddingVertical: Spacing.one,
  },
});
