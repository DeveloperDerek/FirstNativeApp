import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import {
  AndroidImportance,
  IosAuthorizationStatus,
  SchedulableTriggerInputTypes,
} from 'expo-notifications';
import { Platform } from 'react-native';

import {
  oneAtATime,
  parseReminderSettings,
  planReminders,
  type ReminderSettings,
  type ReminderStore,
  syncReminders,
} from './plan';

// Goal reminders, scheduled on the phone itself (decision 4): they work
// without push being set up, and nothing about them leaves the phone.

const CHANNEL = 'goal-reminders';

/** Kept on the phone per account; removed on sign-out (clearLocalUserData). */
export const remindersKey = (userId: string) => `reminders:${userId}`;

export async function loadReminderSettings(userId: string): Promise<ReminderSettings> {
  return parseReminderSettings(await AsyncStorage.getItem(remindersKey(userId)).catch(() => null));
}

export async function saveReminderSettings(userId: string, settings: ReminderSettings) {
  await AsyncStorage.setItem(remindersKey(userId), JSON.stringify(settings));
}

/** Android 13+ shows no permission prompt until a channel exists. */
async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Goal reminders',
    importance: AndroidImportance.DEFAULT,
  });
}

export type NotificationPermission = 'granted' | 'undetermined' | 'denied';

/** Whether this phone lets the app show notifications (no push needed). */
export async function notificationPermission(): Promise<NotificationPermission> {
  const p = await Notifications.getPermissionsAsync();
  if (Platform.OS === 'ios' && p.ios) {
    const s = p.ios.status;
    if (s === IosAuthorizationStatus.NOT_DETERMINED) return 'undetermined';
    return s === IosAuthorizationStatus.DENIED ? 'denied' : 'granted';
  }
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/** Asks only if never asked: when reminders are turned on, never on first launch. */
export async function askForNotifications(): Promise<NotificationPermission> {
  let status = await notificationPermission();
  if (status === 'undetermined') {
    await ensureChannel();
    await Notifications.requestPermissionsAsync();
    status = await notificationPermission();
  }
  return status;
}

const store: ReminderStore = {
  scheduledIds: async () =>
    (await Notifications.getAllScheduledNotificationsAsync()).map((r) => r.identifier),
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
  schedule: async (r) => {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      // Tapping opens Today (handled in use-push.ts)
      content: { body: r.body, data: { url: '/' } },
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: r.date, channelId: CHANNEL },
    });
  },
};

const queue = oneAtATime();

export type ReminderState = {
  /** The phone's steps at the last refresh against today's goal */
  goalReachedToday: boolean;
  /** The server's current streak; null when not sharing or not known */
  streak: number | null;
  /** The goal was reached and today's daily roll not taken, at the last refresh */
  rollWaiting: boolean;
};

/**
 * Cancels the account's goal reminders and schedules the next ones from the
 * saved setting. Run on every refresh and app open, so reminders the phone
 * dropped come back, and none are scheduled while permission is off (the
 * setting stays as it is).
 */
export function rescheduleReminders(userId: string, state: ReminderState): Promise<void> {
  return queue(async () => {
    const settings = await loadReminderSettings(userId);
    const allowed = settings.on && (await notificationPermission()) === 'granted';
    if (allowed) await ensureChannel();
    const planned = allowed ? planReminders({ settings, now: new Date(), ...state }) : [];
    await syncReminders(store, planned);
  });
}

/** On sign-out: no goal reminder is left behind. */
export function cancelReminders(): Promise<void> {
  return queue(() => syncReminders(store, []));
}
