import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSteps } from '@/hooks/use-steps';
import { bannerText } from '@/quests/banners';

/**
 * A banner for each group quest that needs me: votes, running quests and
 * results I haven't seen. Tapping one opens the group. Stage A has no push
 * notifications, so this is where people find out.
 */
export function QuestBanners() {
  const router = useRouter();
  const { quests } = useSteps();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const banners = quests
    .map((q) => ({ q, text: bannerText(q, now) }))
    .filter((b): b is { q: (typeof quests)[number]; text: string } => b.text !== null);

  if (banners.length === 0) return null;
  return (
    <>
      {banners.map(({ q, text }) => (
        <Pressable
          key={q.quest_id}
          onPress={() => router.navigate(`/groups/${q.group_id}`)}
          accessibilityRole="button"
          accessibilityHint="Opens the group"
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView type="backgroundElement" style={styles.banner}>
            <ThemedText type="smallBold" numberOfLines={1}>
              Quest · {q.group_name}
            </ThemedText>
            <ThemedText type="small">{text}</ThemedText>
          </ThemedView>
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.6,
  },
});
