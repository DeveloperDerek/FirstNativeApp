import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  type ActivityLine,
  dayLabel,
  hasKudos,
  lineBadge,
  lineKey,
  lineLabel,
  lineText,
} from '@/activity/activity';
import { Avatar } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import { AchievementBadge, GoalBadge } from '@/components/achievement-badge';
import { KudosButton } from '@/components/kudos-button';
import { ShopItemIcon } from '@/components/shop-item-icon';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/section';
import { Spacing } from '@/constants/theme';
import { boardItemName } from '@/lib/shop-entries';

// How long "Couldn't send kudos." stays under a line
const KUDOS_ERROR_MS = 4000;
// Fixed columns, so every line's picture and kudos sit one above the
// other: a badge at scale 2 (and its number) or a 44-point item, and a
// kudos pill with up to a two-digit count. The kudos column is kept on
// lines without a button (yours at 0) too.
const BADGE_COLUMN = 48;
const KUDOS_COLUMN = 88;

/**
 * The activity board (step-tracker-activity-board.txt): one line per
 * person per day, newest first. Each line opens that person's card, and
 * has its kudos (step-tracker-kudos.txt) beside the day.
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
  newKudos,
  onGiveKudos,
  onOpenGivers,
  onOpenNewKudos,
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
  /** Kudos on your lines you haven't been shown (the tab's count) */
  newKudos: number;
  /** Resolves false if the server refused or the phone is offline */
  onGiveKudos: (line: ActivityLine) => Promise<boolean>;
  /** Your own line: who gave kudos */
  onOpenGivers: (line: ActivityLine) => void;
  onOpenNewKudos: () => void;
}) {
  // The line whose kudos just failed, for a few seconds
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(() => setFailed(null), KUDOS_ERROR_MS);
    return () => clearTimeout(t);
  }, [failed]);

  async function give(l: ActivityLine) {
    setFailed(null);
    if (!(await onGiveKudos(l))) setFailed(lineKey(l));
  }

  return (
    <Section>
      {newKudos > 0 && (
        <Button title={`${newKudos} new kudos`} size="small" onPress={onOpenNewKudos} />
      )}
      {hasNew && <Button title="New activity" size="small" onPress={onShowNew} />}
      {loaded && lines.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing yet. When friends reach their goal, unlock achievements or buy something, it shows here.
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
        const badge = lineBadge(l, boardItemName);
        const character = normalizeAvatar(l.avatar);
        return (
          <View key={lineKey(l)}>
            <View style={styles.row}>
              {/* The line opens their card; the kudos button beside it is its own
                  button, so a screen reader reaches both */}
              <Pressable
                onPress={() => onSelect(l)}
                accessibilityRole="button"
                accessibilityLabel={lineLabel(l, name, isMe, today, boardItemName)}
                accessibilityHint="Opens their profile"
                style={({ pressed }) => [styles.line, pressed && styles.pressed]}>
                <Avatar config={character} scale={1} accessibilityLabel={`${name}'s character`} />
                <View style={styles.text}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {isMe ? 'You' : name}
                  </ThemedText>
                  <ThemedText type="small">{lineText(l, isMe, boardItemName)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {dayLabel(l.day, today)}
                  </ThemedText>
                </View>
                <View style={styles.badge}>
                  {badge === 'goal' ? (
                    <GoalBadge scale={2} />
                  ) : 'item' in badge ? (
                    <ShopItemIcon
                      id={badge.item}
                      wearer={character}
                      accessibilityLabel={boardItemName(badge.item) ?? 'Shop item'}
                    />
                  ) : (
                    <AchievementBadge achievement={badge} earned scale={2} />
                  )}
                </View>
              </Pressable>
              {hasKudos(l) && (
                <View style={styles.kudos}>
                  <KudosButton
                    line={l}
                    name={name}
                    isMe={isMe}
                    onGive={() => give(l)}
                    onOpenGivers={() => onOpenGivers(l)}
                  />
                </View>
              )}
            </View>
            {failed === lineKey(l) && (
              <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite">
                Couldn&apos;t send kudos.
              </ThemedText>
            )}
          </View>
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
    flex: 1,
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
  badge: {
    width: BADGE_COLUMN,
    alignItems: 'center',
  },
  // The pill fills it (a column's children stretch), whatever its count
  kudos: {
    width: KUDOS_COLUMN,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
