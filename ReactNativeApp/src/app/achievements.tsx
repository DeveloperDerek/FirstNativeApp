import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  ACHIEVEMENTS,
  achievementList,
  describe,
  formatEarnedOn,
  type ListEntry,
  type MyAchievements,
} from '@/achievements/achievements';
import { getMyAchievements } from '@/api/achievements';
import { AchievementBadge } from '@/components/achievement-badge';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Section } from '@/components/ui/section';
import { Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/error-message';

/** One achievement: its badge, what it's for, and when or how far along. */
function Entry({ entry }: { entry: ListEntry }) {
  const { achievement: a, earnedOn, progress } = entry;
  return (
    <View style={styles.entry}>
      <AchievementBadge achievement={a} earned={earnedOn !== null} />
      <View style={styles.entryText}>
        <ThemedText type="smallBold">{a.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {describe(a)}
        </ThemedText>
        {earnedOn ? (
          <ThemedText type="small">Earned {formatEarnedOn(earnedOn)}</ThemedText>
        ) : (
          progress && <ThemedText type="small">{progress}</ThemedText>
        )}
        {a.reward && (
          <ThemedText type="small" themeColor="textSecondary">
            {earnedOn ? 'Unlocked' : 'Unlocks'} the {a.reward.label}
            {a.reward.pet ? ' (pet)' : ''}
          </ThemedText>
        )}
      </View>
    </View>
  );
}

/**
 * Profile > Achievements (step-tracker-achievements.txt, section 5): every
 * achievement, earned ones first with their dates, then the rest closest
 * first with how far along they are.
 */
export default function AchievementsScreen() {
  const router = useRouter();
  const [mine, setMine] = useState<MyAchievements | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getMyAchievements()
        .then((m) => {
          if (!alive) return;
          setMine(m);
          setError(null);
        })
        .catch((e) => alive && setError(errorMessage(e)));
      return () => {
        alive = false;
      };
    }, [])
  );

  const list = mine ? achievementList(mine) : [];
  const earned = list.filter((e) => e.earnedOn !== null).length;

  return (
    <Screen
      title="Achievements"
      subtitle={mine ? `${earned} of ${ACHIEVEMENTS.length} earned` : undefined}
      inTabs={false}>
      {error && (
        <ThemedText type="small" themeColor="danger">
          {error}
        </ThemedText>
      )}
      {mine && !mine.sharing && (
        <Section>
          <ThemedText type="small" themeColor="textSecondary">
            Share your steps to earn these. Turn it on in Profile under Privacy.
          </ThemedText>
        </Section>
      )}
      {mine && (
        <Section>
          {list.map((e) => (
            <Entry key={e.achievement.id} entry={e} />
          ))}
        </Section>
      )}
      <Button title="Done" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  entry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  entryText: {
    flex: 1,
  },
});
