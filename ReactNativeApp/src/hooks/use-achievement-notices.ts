import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { findAchievement, ShowingNow, unlockMessage } from '@/achievements/achievements';
import { getNewAchievements, markAchievementsSeen } from '@/api/achievements';

/**
 * The "Achievement unlocked" message (step-tracker-achievements.txt,
 * "SEEING A NEW ONE"): after every refresh of steps, which also runs when
 * the app opens. The server decides what's earned; this only shows it,
 * then says so once the person has closed the message. If the app closes
 * first, nothing is acknowledged and it comes again next time.
 */
export function useAchievementNotices({
  userId,
  loading,
}: {
  userId: string | undefined;
  loading: boolean;
}) {
  // Who is signed in now, and the ids on screen for them
  const signedIn = useRef(userId);
  const showing = useRef(new ShowingNow());
  useEffect(() => {
    signedIn.current = userId;
    showing.current = new ShowingNow();
  }, [userId]);

  // After each refresh finishes
  useEffect(() => {
    if (!userId || loading) return;
    const forMe = () => signedIn.current === userId;
    getNewAchievements()
      .then((news) => {
        if (!forMe()) return;
        // Only those this app can name; a later version shows the rest
        const known = news.filter((n) => findAchievement(n.id));
        const shown = showing.current;
        const fresh = shown.take(known);
        const message = unlockMessage(fresh);
        if (!message) return;
        const ids = fresh.map((n) => n.id);
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          // Never someone else's: mark_achievements_seen uses the session
          const seen = forMe() ? markAchievementsSeen(ids) : Promise.resolve();
          seen.catch(() => {}).finally(() => shown.release(ids));
        };
        Alert.alert(message.title, message.body, [{ text: 'Nice!', onPress: close }], {
          cancelable: true,
          onDismiss: close,
        });
      })
      .catch(() => {});
  }, [userId, loading]);
}
