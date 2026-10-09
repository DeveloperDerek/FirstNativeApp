import { useEffect } from 'react';
import { AppState } from 'react-native';

import { markSeen } from '@/api/players';

/**
 * Updates "Last seen" when the app opens and every time it comes back to
 * the foreground. The server keeps the time and decides whether to record
 * it (only for users who share their steps).
 */
export function useMarkSeen(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    const mark = () => markSeen().catch(() => {});
    mark();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') mark();
    });
    return () => sub.remove();
  }, [userId]);
}
