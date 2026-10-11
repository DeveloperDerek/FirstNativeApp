import { Alert } from 'react-native';

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

/** The "..." menu for someone: Block (more choices join it later, e.g. Report). */
export function personMenu(person: Person, onBlocked: () => void) {
  Alert.alert(`@${person.username}`, undefined, [
    { text: 'Block', style: 'destructive', onPress: () => confirmBlock(person, onBlocked) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
