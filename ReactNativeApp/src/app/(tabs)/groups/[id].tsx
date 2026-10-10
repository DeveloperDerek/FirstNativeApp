import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Share } from 'react-native';

import {
  deleteGroup,
  getGroup,
  type Group,
  groupLeaderboard,
  leaveGroup,
  removeMember,
  renameGroup,
} from '@/api/groups';
import { getGroupQuest, type GroupQuest, markQuestSeen, voteQuest } from '@/api/quests';
import { type LeaderboardRow, type Period, periodRange } from '@/api/steps';
import { useAuth } from '@/auth/AuthProvider';
import { Leaderboard, PeriodPicker } from '@/components/leaderboard';
import { QuestCard } from '@/components/quest-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Row, Section } from '@/components/ui/section';
import { TextField } from '@/components/ui/text-field';
import { useNotificationCounts } from '@/hooks/use-notification-counts';
import { useSteps } from '@/hooks/use-steps';
import { useWallet } from '@/hooks/use-wallet';
import { errorMessage } from '@/lib/error-message';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const myId = session?.user.id ?? '';

  const [group, setGroup] = useState<Group | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [quest, setQuest] = useState<GroupQuest | null>(null);
  const [voting, setVoting] = useState(false);
  const { refresh: refreshSteps, refreshQuests, error: stepsError } = useSteps();
  const { refreshBalance } = useWallet();
  const { refreshCounts } = useNotificationCounts();
  const [newName, setNewName] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Also moves the quest forward on the server: starts it, ends it, pays it
  const loadQuest = useCallback(async () => {
    const q = await getGroupQuest(id);
    setQuest(q);
    const mine = q.quest?.settled_at && q.members.find((m) => m.user_id === myId);
    if (q.quest && mine) {
      // The result is on screen: stop its banner, and show any coins paid
      markQuestSeen(q.quest.id).catch(() => {});
      if (mine.coins_paid) refreshBalance().catch(() => {});
    }
    refreshQuests(); // keep the banners in step with the card
    refreshCounts(); // and the Groups badge (it clears once you vote)
  }, [id, myId, refreshBalance, refreshQuests, refreshCounts]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { fromDay, toDay } = periodRange(period);
      const [g, rows] = await Promise.all([
        getGroup(id),
        groupLeaderboard(id, fromDay, toDay),
        loadQuest(),
      ]);
      setGroup(g);
      setNewName(g.name);
      setBoard(rows);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, period, loadQuest]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // While a quest is voting or running, keep the card fresh
  const live = quest?.quest && !quest.quest.settled_at && quest.quest.status !== 'cancelled';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => loadQuest().catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [live, loadQuest]);

  async function vote(accept: boolean) {
    if (!quest?.quest) return;
    setVoting(true);
    setError(null);
    try {
      const status = await voteQuest(quest.quest.id, accept);
      if (status === 'active') {
        Alert.alert('Everyone accepted!', 'The quest is locked in. Every step in the window counts.');
      }
      await loadQuest();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setVoting(false);
    }
  }

  function confirmDecline() {
    Alert.alert('Decline the quest?', 'This cancels it for the whole group.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: () => vote(false) },
    ]);
  }

  async function sendSteps() {
    await refreshSteps(); // reads and uploads my quest steps
    await loadQuest().catch((e) => setError(errorMessage(e)));
  }

  async function pullToRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const isOwner = group?.owner_id === myId;

  function shareCode() {
    if (!group) return;
    Share.share({
      message: `Join my StepTracker group "${group.name}" with invite code: ${group.invite_code}`,
    });
  }

  async function rename() {
    if (!group || !newName.trim() || newName.trim() === group.name) return;
    try {
      await renameGroup(group.id, newName.trim());
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function confirmLeave() {
    Alert.alert('Leave group?', 'You will stop seeing this group and its members will stop seeing your steps.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveGroup(id, myId);
            router.back();
          } catch (e) {
            setError(errorMessage(e));
          }
        },
      },
    ]);
  }

  function confirmRemove(row: LeaderboardRow) {
    const name = row.display_name || 'this member';
    Alert.alert(`Remove ${name}?`, 'They will stop seeing this group. They can rejoin with the invite code.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeMember(id, row.user_id);
            await load();
          } catch (e) {
            setError(errorMessage(e));
          }
        },
      },
    ]);
  }

  function confirmDelete() {
    Alert.alert('Delete group?', 'This removes the group for every member. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteGroup(id);
            router.back();
          } catch (e) {
            setError(errorMessage(e));
          }
        },
      },
    ]);
  }

  return (
    <Screen
      title={group?.name ?? ''}
      inTabs
      hasHeader
      onRefresh={pullToRefresh}
      refreshing={refreshing}>
      {error && (
        // In a card, so the red reads on every map's ground
        <Section>
          <ThemedText type="small" themeColor="danger">
            {error}
          </ThemedText>
        </Section>
      )}

      {quest && (
        <QuestCard
          data={quest}
          myId={myId}
          busy={voting}
          onPropose={() => router.push({ pathname: '/propose-quest', params: { groupId: id } })}
          onVote={(accept) => (accept ? vote(true) : confirmDecline())}
          onSendSteps={sendSteps}
        />
      )}

      {stepsError?.startsWith("Couldn't send quest steps") && (
        <Section>
          <ThemedText type="small" themeColor="danger">
            {stepsError}
          </ThemedText>
        </Section>
      )}

      <PeriodPicker value={period} onChange={setPeriod} />
      <Leaderboard rows={board} myId={myId} onRemove={isOwner ? confirmRemove : undefined} />
      {isOwner && board.length > 1 && (
        <ThemedText type="small" themeColor="textSecondary">
          Swipe a member left to remove them.
        </ThemedText>
      )}

      {group && (
        <Section title="Invite">
          <Row title={group.invite_code} detail="Anyone with this code can join and see members' steps">
            <Button title="Share" size="small" onPress={shareCode} />
          </Row>
        </Section>
      )}

      {group && isOwner && (
        <Section title="Manage">
          <TextField value={newName} onChangeText={setNewName} maxLength={50} />
          <Button
            title="Rename"
            variant="secondary"
            onPress={rename}
            disabled={!newName.trim() || newName.trim() === group.name}
          />
          <Button title="Delete group" variant="danger" onPress={confirmDelete} />
        </Section>
      )}

      {group && !isOwner && (
        <Section>
          <Button title="Leave group" variant="danger" onPress={confirmLeave} />
        </Section>
      )}
    </Screen>
  );
}
