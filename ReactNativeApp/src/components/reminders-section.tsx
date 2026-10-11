import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Switch } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Row, Section } from '@/components/ui/section';
import { reminderState } from '@/hooks/use-goal-reminders';
import { useSteps } from '@/hooks/use-steps';
import { errorMessage } from '@/lib/error-message';
import { DEFAULT_REMINDERS, type ReminderSettings } from '@/reminders/plan';
import {
  askForNotifications,
  loadReminderSettings,
  notificationPermission,
  rescheduleReminders,
  saveReminderSettings,
} from '@/reminders/reminders';

const timeLabel = (s: ReminderSettings) =>
  new Date(2000, 0, 1, s.hour, s.minute).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * Profile > Reminders (step-tracker-history-reminders.txt, part B): off
 * until turned on, at most one a day at a time you pick. Permission is
 * asked only when turning it on.
 */
export function RemindersSection({ userId }: { userId: string }) {
  const { today, goal, streak } = useSteps();
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Again on every visit: permission can change in the Settings app
  useFocusEffect(
    useCallback(() => {
      loadReminderSettings(userId)
        .then(setSettings)
        .catch(() => setSettings(DEFAULT_REMINDERS));
      notificationPermission()
        .then((p) => setBlocked(p === 'denied'))
        .catch(() => {});
    }, [userId])
  );

  async function save(next: ReminderSettings) {
    try {
      await saveReminderSettings(userId, next);
      setSettings(next);
      await rescheduleReminders(userId, reminderState(today, goal, streak));
    } catch (e) {
      Alert.alert('Could not change reminders', errorMessage(e));
    }
  }

  async function toggle(on: boolean) {
    if (!settings) return;
    if (on) {
      const permission = await askForNotifications().catch(() => 'denied' as const);
      setBlocked(permission === 'denied');
      // Refused: the switch stays off, and the line below says why
      if (permission !== 'granted') return;
    }
    await save({ ...settings, on });
  }

  function pickTime(date: Date) {
    if (!settings) return;
    save({ ...settings, hour: date.getHours(), minute: date.getMinutes() });
  }

  if (!settings) return null;
  const value = new Date(2000, 0, 1, settings.hour, settings.minute);
  return (
    <Section title="Reminders">
      <Row title="Goal reminder" detail="If you haven't reached your goal yet">
        <Switch value={settings.on} onValueChange={toggle} />
      </Row>
      {settings.on && (
        <Row title="Time">
          {Platform.OS === 'ios' ? (
            <DateTimePicker
              value={value}
              mode="time"
              display="compact"
              onValueChange={(_, d) => pickTime(d)}
            />
          ) : (
            <Pressable
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Reminder time, ${timeLabel(settings)}`}>
              <ThemedText type="linkPrimary">{timeLabel(settings)}</ThemedText>
            </Pressable>
          )}
        </Row>
      )}
      {pickerOpen && Platform.OS !== 'ios' && (
        <DateTimePicker
          value={value}
          mode="time"
          onValueChange={(_, d) => {
            setPickerOpen(false);
            pickTime(d);
          }}
          onDismiss={() => setPickerOpen(false)}
        />
      )}
      {blocked && (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Notifications are off for StepTracker
            {settings.on ? ', so no reminders can come.' : '.'}
          </ThemedText>
          <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button">
            <ThemedText type="linkPrimary">Open Settings</ThemedText>
          </Pressable>
        </>
      )}
      {settings.on && !blocked && (
        <ThemedText type="small" themeColor="textSecondary">
          At most once a day, and not once you&apos;ve reached your goal. It knows your steps from
          the last time you opened the app.
        </ThemedText>
      )}
    </Section>
  );
}
