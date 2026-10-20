import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';

import { createGroup, type Group, joinGroup, listMyGroups } from '@/api/groups';
import { useAuth } from '@/auth/AuthProvider';
import { checkName } from '@/auth/name-rules';
import { nameProblem } from '@/auth/register';
import { QuestBanners } from '@/components/quest-banners';
import { SharingRequired } from '@/components/sharing-required';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Row, Section } from '@/components/ui/section';
import { TextField } from '@/components/ui/text-field';
import { useNotificationCounts } from '@/hooks/use-notification-counts';
import { useSteps } from '@/hooks/use-steps';
import { errorMessage } from '@/lib/error-message';

export default function GroupsScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const myId = session?.user.id ?? '';
  const sharing = Boolean(profile?.sharing_consent_at);

  const [groups, setGroups] = useState<Group[]>([]);
  const [newName, setNewName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Each shown in the card it is about
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const { refreshQuests } = useSteps();
  const { refreshCounts } = useNotificationCounts();

  const load = useCallback(async () => {
    if (!sharing) return;
    refreshCounts(); // the tab badge reloads with the list
    try {
      const [list] = await Promise.all([listMyGroups(), refreshQuests()]);
      setGroups(list);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [sharing, refreshQuests, refreshCounts]);

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

  async function create() {
    if (!newName.trim()) return;
    const check = checkName(newName, 'group');
    if (!check.ok) {
      setCreateError(nameProblem(check, 'group'));
      return;
    }
    setBusy('create');
    setCreateError(null);
    try {
      const group = await createGroup(myId, check.name);
      setNewName('');
      router.push(`/groups/${group.id}`);
    } catch (e) {
      setCreateError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function join() {
    if (!code.trim()) return;
    setBusy('join');
    setJoinError(null);
    try {
      const groupId = await joinGroup(code);
      setCode('');
      router.push(`/groups/${groupId}`);
    } catch (e) {
      setJoinError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!sharing) {
    return (
      <Screen title="Groups">
        <SharingRequired />
      </Screen>
    );
  }

  return (
    <Screen title="Groups" onRefresh={pullToRefresh} refreshing={refreshing}>
      <QuestBanners />

      <Section title="Your groups" first>
        {error && (
          <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
            {error}
          </ThemedText>
        )}
        {!error && groups.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            You are not in any groups yet. Create one or join with an invite code.
          </ThemedText>
        )}
        {groups.map((g) => (
          <Pressable key={g.id} onPress={() => router.push(`/groups/${g.id}`)}>
            <Row title={g.name} detail={g.owner_id === myId ? 'Owner' : 'Member'}>
              <ThemedText themeColor="textSecondary">›</ThemedText>
            </Row>
          </Pressable>
        ))}
      </Section>

      <Section title="Join a group">
        <TextField
          placeholder="Invite code"
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={join}
        />
        {joinError && (
          <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
            {joinError}
          </ThemedText>
        )}
        <Button title="Join" onPress={join} loading={busy === 'join'} disabled={!code.trim()} />
      </Section>

      <Section title="Create a group">
        <TextField
          placeholder="Group name"
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={create}
          // Longer than 15: emoji count as one name character but more here
          maxLength={40}
        />
        {createError && (
          <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
            {createError}
          </ThemedText>
        )}
        <Button
          title="Create"
          onPress={create}
          loading={busy === 'create'}
          disabled={!newName.trim()}
        />
      </Section>
    </Screen>
  );
}
