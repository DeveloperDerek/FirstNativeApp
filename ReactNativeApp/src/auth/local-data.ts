import AsyncStorage from '@react-native-async-storage/async-storage';

import { sessionStorage } from '@/lib/session-storage';

/**
 * Everything kept on the phone for the person signing out, so the next
 * person starts clean (step-tracker-register.txt, 8a): the step history
 * cache, their one-time prompts, a half-finished reset, and the key the
 * saved session was encrypted with. The session itself is removed by
 * Supabase's sign-out.
 */
export async function clearLocalUserData(userId: string | undefined) {
  const keys = ['steps-by-day', 'pending-signup-email'];
  if (userId) keys.push(`consent-prompted:${userId}`, `password-recovery:${userId}`);
  await AsyncStorage.multiRemove(keys).catch(() => {});
  await sessionStorage.forgetKey().catch(() => {});
}
