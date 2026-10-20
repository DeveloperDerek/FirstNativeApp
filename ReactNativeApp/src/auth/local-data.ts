import AsyncStorage from '@react-native-async-storage/async-storage';

import { forgetMyItems } from '@/avatar/my-items';
import { sessionStorage } from '@/lib/session-storage';
import { whoOrderKey } from '@/lib/who-order';
import { cancelReminders, remindersKey } from '@/reminders/reminders';
import { stepsKey } from '@/storage/step-log';
import { LEGACY_STEPS_KEY } from '@/storage/stepStore';

/**
 * Everything kept on the phone for the person signing out, so the next
 * person starts clean (step-tracker-register.txt, 8a): the step history
 * cache, their one-time prompts, a half-finished reset, their goal reminders
 * and its setting, the order of Today's Who buttons, the key the saved session was encrypted with, and the
 * character editor's item lists held in memory. The session itself is removed by
 * Supabase's sign-out.
 */
export async function clearLocalUserData(userId: string | undefined) {
  forgetMyItems();
  const keys = [LEGACY_STEPS_KEY, 'pending-signup-email'];
  if (userId) {
    keys.push(
      stepsKey(userId),
      `consent-prompted:${userId}`,
      `password-recovery:${userId}`,
      remindersKey(userId),
      whoOrderKey(userId)
    );
  }
  await AsyncStorage.multiRemove(keys).catch(() => {});
  await cancelReminders().catch(() => {});
  await sessionStorage.forgetKey().catch(() => {});
}
