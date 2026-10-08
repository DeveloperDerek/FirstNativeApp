import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Share } from 'react-native';

import {
  deleteGroup,
  getGroup,
  type Group,
  groupLeaderboard,
  leaveGroup,
  renameGroup,
} from '@/api/groups';
import { type LeaderboardRow, type Period, periodRange } from '@/api/steps';
import { useAuth } from '@/auth/AuthProvider';
import { Leaderboard, PeriodPicker } from '@/components/leaderboard';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Row, Section } from '@/components/ui/section';
import { TextField } from '@/components/ui/text-field';
import { errorMessage } from '@/lib/error-message';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const myId = session?.user.id ?? '';

  const [group, setGroup] = useState<Group | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [newName, setNewName] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { fromDay, toDay } = periodRange(period);
      const [g, rows] = await Promise.all([getGroup(id), groupLeaderboard(id, fromDay, toDay)]);
      setGroup(g);
      setNewName(g.name);
      setBoard(rows);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, period]);

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
        <ThemedText type="small" themeColor="danger">
          {error}
        </ThemedText>
      )}

      <PeriodPicker value={period} onChange={setPeriod} />
      <Leaderboard rows={board} myId={myId} />

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
