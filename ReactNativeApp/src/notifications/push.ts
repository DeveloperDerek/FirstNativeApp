import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Push notifications (step-tracker-notifications.txt, Phase 3). Only the
// server sends them; the app asks permission, keeps this phone's push
// address up to date, and removes it on sign-out.

const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId;

/** Off until set up (see app.config.ts), and never on a simulator. */
export const pushAvailable =
  process.env.EXPO_PUBLIC_PUSH_NOTIFICATIONS === 'true' && !!projectId && Device.isDevice;

const tokenKey = 'push-token';

// Shown while the app is open too; the app sets the icon number itself.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Android 13+ shows no permission prompt until a channel exists. */
async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Friend requests',
    importance: AndroidImportance.HIGH,
  });
}

export type PushPermission = 'granted' | 'undetermined' | 'denied';

export async function pushPermission(): Promise<PushPermission> {
  if (!pushAvailable) return 'denied';
  const p = await Notifications.getPermissionsAsync();
  if (Platform.OS === 'ios' && p.ios) {
    const s = p.ios.status;
    if (s === IosAuthorizationStatus.NOT_DETERMINED) return 'undetermined';
    return s === IosAuthorizationStatus.DENIED ? 'denied' : 'granted';
  }
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/** Saves this phone's push address for the signed-in account, if allowed. */
export async function registerPushDevice(): Promise<void> {
  if ((await pushPermission()) !== 'granted') return;
  await ensureChannel();
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const { error } = await supabase.rpc('register_push_device', {
    p_token: token,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (error) throw error;
  await AsyncStorage.setItem(tokenKey, token);
}

/**
 * Asks for permission (only if never asked), then registers. Called at a
 * moment the person cares about: right after they send a friend request,
 * or when they turn notifications on in Profile. Never on first launch.
 */
export async function askForPush(): Promise<PushPermission> {
  if (!pushAvailable) return 'denied';
  let status = await pushPermission();
  if (status === 'undetermined') {
    await ensureChannel();
    await Notifications.requestPermissionsAsync();
    status = await pushPermission();
  }
  if (status === 'granted') await registerPushDevice().catch(() => {});
  return status;
}

/** On sign-out: this phone stops getting the account's notifications. */
export async function unregisterPushDevice(): Promise<void> {
  const token = await AsyncStorage.getItem(tokenKey).catch(() => null);
  if (!token) return;
  const { error } = await supabase.rpc('unregister_push_device', { p_token: token });
  if (error) throw error;
  await AsyncStorage.removeItem(tokenKey).catch(() => {});
}

/** "Sign out other devices": their push addresses go too. */
export async function unregisterOtherPushDevices(): Promise<void> {
  const keep = await AsyncStorage.getItem(tokenKey).catch(() => null);
  const { error } = await supabase.rpc('unregister_other_push_devices', { p_keep: keep });
  if (error) throw error;
}

/** The Profile setting. Missing = on. */
export async function getPushEnabled(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('notification_settings')
    .select('push_enabled')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.push_enabled ?? true;
}

export async function setPushEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_push_enabled', { p_enabled: enabled });
  if (error) throw error;
}

/** The number on the app icon. Fails quietly without badge permission. */
export function setAppIconCount(count: number) {
  if (!pushAvailable) return;
  Notifications.setBadgeCountAsync(Math.max(0, count)).catch(() => {});
}
