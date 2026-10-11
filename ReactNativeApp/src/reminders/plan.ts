// Goal reminders (step-tracker-history-reminders.txt, part B): which ones
// to schedule, and what they say. No imports, so `npm test` can check them.

export type ReminderSettings = {
  on: boolean;
  /** Local time, 0-23 and 0-59 */
  hour: number;
  minute: number;
};

/** Off until turned on; 7pm when first turned on (decision 6). */
export const DEFAULT_REMINDERS: ReminderSettings = { on: false, hour: 19, minute: 0 };

/** Today and the next 6 days: someone who stops opening the app gets a week, then nothing. */
export const REMINDER_DAYS = 7;

/**
 * Every goal reminder's id starts with this, so cancelling touches only
 * these, never any other notification.
 */
export const REMINDER_PREFIX = 'goal-reminder:';

export const PLAIN_TEXT = 'Still time to reach your goal today.';
/** A streak this long or longer is mentioned (decision 6). */
export const STREAK_FROM = 2;

export type PlannedReminder = {
  /** Fixed per date, e.g. "goal-reminder:2026-10-11" */
  id: string;
  date: Date;
  body: string;
};

// Local date, as dayKey in storage/step-log.ts (kept free of imports here)
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
  `${String(d.getDate()).padStart(2, '0')}`;

export const reminderId = (date: Date) => `${REMINDER_PREFIX}${localDay(date)}`;

/**
 * The reminders to schedule now. Today's only if its time is still to come
 * and today's goal isn't reached; then one for each of the next 6 days.
 * Only today's mentions the streak, and only one the server confirmed:
 * a later one could find it already broken.
 */
export function planReminders({
  settings,
  now,
  goalReachedToday,
  streak,
}: {
  settings: ReminderSettings;
  now: Date;
  /** The phone's steps at the last refresh against today's goal */
  goalReachedToday: boolean;
  /** The server's current streak (null when not sharing or not known) */
  streak: number | null;
}): PlannedReminder[] {
  if (!settings.on) return [];
  const planned: PlannedReminder[] = [];
  for (let i = 0; i < REMINDER_DAYS; i++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    date.setHours(settings.hour, settings.minute, 0, 0);
    if (i === 0 && (goalReachedToday || date <= now)) continue;
    const withStreak = i === 0 && streak !== null && streak >= STREAK_FROM;
    planned.push({
      id: reminderId(date),
      date,
      body: withStreak ? `Keep your ${streak}-day streak going. ${PLAIN_TEXT}` : PLAIN_TEXT,
    });
  }
  return planned;
}

/** The setting as saved on the phone, with anything unreadable put right. */
export function parseReminderSettings(raw: string | null): ReminderSettings {
  try {
    const v = raw ? JSON.parse(raw) : null;
    const ok = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;
    if (v && typeof v.on === 'boolean' && ok(v.hour, 23) && ok(v.minute, 59)) {
      return { on: v.on, hour: v.hour, minute: v.minute };
    }
  } catch {
    // fall through to the default
  }
  return DEFAULT_REMINDERS;
}

/** What syncReminders needs from expo-notifications (a fake in the tests). */
export type ReminderStore = {
  scheduledIds: () => Promise<string[]>;
  cancel: (id: string) => Promise<void>;
  schedule: (reminder: PlannedReminder) => Promise<void>;
};

/**
 * Cancels every goal reminder, then schedules `planned`. Cancelling first
 * means no duplicate can build up even on a phone that doesn't replace a
 * reminder scheduled again with the same id; other notifications are
 * never touched.
 */
export async function syncReminders(store: ReminderStore, planned: PlannedReminder[]) {
  const ours = (await store.scheduledIds()).filter((id) => id.startsWith(REMINDER_PREFIX));
  await Promise.all(ours.map((id) => store.cancel(id)));
  for (const r of planned) await store.schedule(r);
}

/**
 * Runs jobs one at a time, in order: a second rescheduling waits for the
 * first, then runs with what it was given (the latest setting and steps).
 * A failed job doesn't stop the next.
 */
export function oneAtATime() {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const next = last.then(job, job);
    last = next.catch(() => {});
    return next;
  };
}
