import * as Notifications from 'expo-notifications';
import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { pushAvailable, registerPushDevice } from '@/notifications/push';

/**
 * Keeps this phone's push address saved for the signed-in account (tokens
 * can change, and permission can be turned on in Settings), and opens the
 * screen a tapped notification points to.
 */
export function usePush(userId: string | undefined) {
  const router = useRouter();

  useEffect(() => {
    if (!userId || !pushAvailable) return;
    const register = () => registerPushDevice().catch(() => {});
    register();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') register();
    });
    return () => sub.remove();
  }, [userId]);

  // Covers a tap that launched the app as well as one while it was open
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || !response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const url = response.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) router.navigate(url as Href);
  }, [userId, response, router]);
}
