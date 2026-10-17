import { Pressable, StyleSheet, View } from 'react-native';

import { type ActivityLine, dayLabel, lineBadge, lineLabel, lineText } from '@/activity/activity';
import { Avatar } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import { AchievementBadge, GoalBadge } from '@/components/achievement-badge';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/section';
import { Spacing } from '@/constants/theme';

/**
 * The activity board (step-tracker-activity-board.txt): one line per
 * person per day, newest first. Each line opens that person's card.
 */
export function ActivityList({
  lines,
  myId,
  today,
  loaded,
  hasOlder,
  loadingOlder,
  hasNew,
  onSelect,
  onOlder,
  onShowNew,
}: {
  lines: ActivityLine[];
  myId: string;
  /** The phone's date, 'YYYY-MM-DD', for the day labels */
  today: string;
  /** false until the first page has arrived (or failed) */
  loaded: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  /** A refresh found lines that aren't on screen (older pages were open) */
  hasNew: boolean;
  onSelect: (line: ActivityLine) => void;
  onOlder: () => void;
  onShowNew: () => void;
}) {
  return (
    <Section>
      {hasNew && <Button title="New activity" size="small" onPress={onShowNew} />}
      {loaded && lines.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing yet. When friends reach their goal or unlock achievements, it shows here.
        </ThemedText>
      )}
      {!loaded && (
        <ThemedText type="small" themeColor="textSecondary">
          Loading…
        </ThemedText>
      )}
      {lines.map((l) => {
        const isMe = l.user_id === myId;
        const name = l.display_name || 'Unnamed';
        const badge = lineBadge(l);
        return (
          <Pressable
            key={`${l.user_id}:${l.day}`}
            onPress={() => onSelect(l)}
            accessibilityRole="button"
            accessibilityLabel={lineLabel(l, name, isMe, today)}
            accessibilityHint="Opens their profile"
            style={({ pressed }) => [styles.line, pressed && styles.pressed]}>
            <Avatar config={normalizeAvatar(l.avatar)} scale={1} accessibilityLabel={`${name}'s character`} />
            <View style={styles.text}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {isMe ? 'You' : name}
              </ThemedText>
              <ThemedText type="small">{lineText(l, isMe)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {dayLabel(l.day, today)}
              </ThemedText>
            </View>
            {badge === 'goal' ? (
              <GoalBadge scale={2} />
            ) : (
              <AchievementBadge achievement={badge} earned scale={2} />
            )}
          </Pressable>
        );
      })}
      {loaded && lines.length > 0 && !hasOlder && (
        <ThemedText type="small" themeColor="textSecondary">
          That&apos;s everything from the last 30 days.
        </ThemedText>
      )}
      {hasOlder && (
        <Button
          title={loadingOlder ? 'Loading…' : 'Show older'}
          size="small"
          variant="secondary"
          onPress={onOlder}
          disabled={loadingOlder}
        />
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 56, // easy to hit; keep it above 44
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    flex: 1,
  },
});
