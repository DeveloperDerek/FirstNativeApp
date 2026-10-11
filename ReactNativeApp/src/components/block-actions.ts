import type { Href } from 'expo-router';
import { Alert, type AlertButton } from 'react-native';

import { blockUser, unblockUser } from '@/api/blocks';
import { errorMessage } from '@/lib/error-message';

// The Block and Unblock confirmations (step-tracker-safety.txt, section 8),
// the same wherever they're offered.

type Person = { id: string; username: string };

/** Asks first; calls onDone after the block is saved. */
export function confirmBlock(person: Person, onDone: () => void) {
  Alert.alert(
    `Block @${person.username}?`,
    "They won't be able to find you or see your steps. You'll stop being friends. " +
      "They won't be told.",
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          try {
            await blockUser(person.id);
            onDone();
          } catch (e) {
            Alert.alert('Could not block', errorMessage(e));
          }
        },
      },
    ]
  );
}

/** Asks first; calls onDone after the block is lifted. */
export function confirmUnblock(person: Person, onDone: () => void) {
  Alert.alert(
    `Unblock @${person.username}?`,
    "You can find each other again, but you won't be friends until one of you sends a request.",
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        onPress: async () => {
          try {
            await unblockUser(person.id);
            onDone();
          } catch (e) {
            Alert.alert('Could not unblock', errorMessage(e));
          }
        },
      },
    ]
  );
}

/** The report sheet for a person or a group's name. */
export const reportHref = (kind: 'person' | 'group', id: string, label: string): Href => ({
  pathname: '/report',
  params: { kind, id, label },
});

/**
 * The "..." menu for someone: Report (only when given, i.e. reports are
 * turned on), then Block, or Unblock for someone you blocked.
 */
export function personMenu(
  person: Person,
  {
    blocked = false,
    onChanged,
    onReport,
  }: { blocked?: boolean; onChanged: () => void; onReport?: () => void }
) {
  const buttons: AlertButton[] = [];
  if (onReport) buttons.push({ text: 'Report', onPress: onReport });
  buttons.push(
    blocked
      ? { text: 'Unblock', onPress: () => confirmUnblock(person, onChanged) }
      : { text: 'Block', style: 'destructive', onPress: () => confirmBlock(person, onChanged) }
  );
  buttons.push({ text: 'Cancel', style: 'cancel' });
  Alert.alert(`@${person.username}`, undefined, buttons);
}
