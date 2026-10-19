import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { dayLabel, type Giver, giverNames, type NewKudos, newKudosText } from '@/activity/activity';
import { Avatar } from '@/avatar/Avatar';
import { normalizeAvatar } from '@/avatar/catalog';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { boardItemName } from '@/lib/shop-entries';

const giverName = (g: Giver) => g.display_name || 'Unnamed';

/** A card over the page, closed by its button or a tap outside it. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable onPress={onClose} accessibilityLabel="Close" style={StyleSheet.absoluteFill} />
        <ThemedView type="background" style={styles.card} accessibilityViewIsModal>
          <ThemedText type="subtitle" accessibilityRole="header">
            {title}
          </ThemedText>
          <ScrollView contentContainerStyle={styles.list}>{children}</ScrollView>
          <Button title="Close" variant="secondary" onPress={onClose} />
        </ThemedView>
      </View>
    </Modal>
  );
}

/** A giver's head, which opens their card. */
function Head({ giver, onSelect }: { giver: Giver; onSelect: (g: Giver) => void }) {
  return (
    <Pressable
      onPress={() => onSelect(giver)}
      accessibilityRole="button"
      accessibilityLabel={`${giverName(giver)}, opens their profile`}
      style={styles.head}>
      <Avatar config={normalizeAvatar(giver.avatar)} scale={1} accessibilityLabel="" />
    </Pressable>
  );
}

function Status({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) {
    return (
      <ThemedText type="small" themeColor="danger">
        Couldn&apos;t load this. Close it and try again.
      </ThemedText>
    );
  }
  if (!loading) return null;
  return (
    <ThemedText type="small" themeColor="textSecondary">
      Loading…
    </ThemedText>
  );
}

/**
 * The "New kudos" list (step-tracker-kudos.txt, section 5): each of your
 * lines with kudos you haven't been shown, newest first, and who gave them.
 */
export function NewKudosSheet({
  list,
  error,
  today,
  onSelect,
  onClose,
}: {
  list: NewKudos | null;
  error: string | null;
  /** The phone's date, for the day labels */
  today: string;
  onSelect: (giver: Giver) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="New kudos" onClose={onClose}>
      <Status error={error} loading={!list} />
      {list?.lines.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing new.
        </ThemedText>
      )}
      {list?.lines.map((l) => {
        const names = giverNames(l.givers.map(giverName));
        return (
          <View key={`${l.day}:${l.kind}:${l.ref}`} style={styles.entry}>
            <ThemedText
              type="smallBold"
              accessibilityLabel={`${names} gave you kudos for ${newKudosText(l, boardItemName)}, ${dayLabel(l.day, today).toLowerCase()}`}>
              {dayLabel(l.day, today)} · {newKudosText(l, boardItemName)}
            </ThemedText>
            <View style={styles.givers}>
              {l.givers.slice(0, 5).map((g) => (
                <Head key={g.user_id} giver={g} onSelect={onSelect} />
              ))}
            </View>
            <ThemedText type="small" accessibilityElementsHidden importantForAccessibility="no">
              {names}
            </ThemedText>
          </View>
        );
      })}
    </Sheet>
  );
}

/** Who gave kudos on one of your lines. Seeing it marks nothing. */
export function GiversSheet({
  title,
  givers,
  error,
  onSelect,
  onClose,
}: {
  /** "Kudos for Thu, Oct 16" */
  title: string;
  givers: Giver[] | null;
  error: string | null;
  onSelect: (giver: Giver) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <Status error={error} loading={!givers} />
      {givers?.map((g) => (
        <Pressable
          key={g.user_id}
          onPress={() => onSelect(g)}
          accessibilityRole="button"
          accessibilityLabel={`${giverName(g)}, opens their profile`}
          style={styles.row}>
          <Avatar config={normalizeAvatar(g.avatar)} scale={1} accessibilityLabel="" />
          <ThemedText>{giverName(g)}</ThemedText>
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.three,
    maxHeight: '80%',
  },
  list: {
    gap: Spacing.three,
  },
  entry: {
    gap: Spacing.one,
  },
  givers: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  head: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 44,
  },
});
