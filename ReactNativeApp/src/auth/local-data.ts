import AsyncStorage from '@react-native-async-storage/async-storage';

import { sessionStorage } from '@/lib/session-storage';
import { stepsKey } from '@/storage/step-log';
import { LEGACY_STEPS_KEY } from '@/storage/stepStore';

/**
 * Everything kept on the phone for the person signing out, so the next
 * person starts clean (step-tracker-register.txt, 8a): the step history
 * cache, their one-time prompts, a half-finished reset, and the key the
 * saved session was encrypted with. The session itself is removed by
 * Supabase's sign-out.
 */
export async function clearLocalUserData(userId: string | undefined) {
  const keys = [LEGACY_STEPS_KEY, 'pending-signup-email'];
  if (userId) {
    keys.push(stepsKey(userId), `consent-prompted:${userId}`, `password-recovery:${userId}`);
  }
  await AsyncStorage.multiRemove(keys).catch(() => {});
  await sessionStorage.forgetKey().catch(() => {});
}
