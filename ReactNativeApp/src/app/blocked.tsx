import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { type BlockedPerson, listBlocked } from '@/api/blocks';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import { confirmUnblock, reportHref } from '@/components/block-actions';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Row, Section } from '@/components/ui/section';
import { errorMessage } from '@/lib/error-message';

/**
 * Profile > Blocked people (step-tracker-safety.txt, section 8): the
 * people you blocked, with Unblock, and Report so someone can be reported
 * without unblocking them first. Never who blocked you.
 */
export default function BlockedScreen() {
  const router = useRouter();
  const { account } = useAuth();
  const [people, setPeople] = useState<BlockedPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPeople(await listBlocked());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <Screen
      title="Blocked people"
      subtitle="They can't find you or see your steps, outside a group you share. They aren't told.">
      <Section>
        {error && (
          <ThemedText type="small" themeColor="danger">
            {error}
          </ThemedText>
        )}
        {people?.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            You haven&apos;t blocked anyone.
          </ThemedText>
        )}
        {people?.map((p) => (
          <Row
            key={p.user_id}
            title={p.display_name || p.username}
            detail={`@${p.username}`}
            leading={
              <Avatar
                config={normalizeAvatar(p.avatar)}
                scale={1}
                accessibilityLabel={`${p.display_name || p.username}'s character`}
              />
            }>
            <View>
              {account?.reportsEnabled && (
                <Button
                  title="Report"
                  size="small"
                  variant="secondary"
                  onPress={() => router.push(reportHref('person', p.user_id, `@${p.username}`))}
                />
              )}
              <Button
                title="Unblock"
                size="small"
                variant="secondary"
                onPress={() => confirmUnblock({ id: p.user_id, username: p.username }, load)}
              />
            </View>
          </Row>
        ))}
      </Section>
      <Button title="Done" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
