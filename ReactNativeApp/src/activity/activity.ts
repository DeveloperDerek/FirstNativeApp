// The activity board in Friends (step-tracker-activity-board.txt): one
// line per person per day, saying what they did. The server decides what
// is on it (supabase/migrations/*_activity_board.sql); this is the words
// and the list handling. No React Native imports, so `npm test` can run it.

import { type Achievement, findAchievement } from '../achievements/achievements.ts';

/** One line from friends_activity(). */
export type ActivityLine = {
  /** 'YYYY-MM-DD', the day as the person's phone counted it */
  day: string;
  /** When the line's latest part arrived; part of the page position */
  at: string;
  user_id: string;
  display_name: string | null;
  /** Raw JSON from the database; run it through normalizeAvatar() before drawing. */
  avatar: unknown;
  goal: boolean;
  /** Yours only: the day's coins */
  coins: number | null;
  /** Earned that day, oldest first */
  achievements: string[];
};

/** Where the next page starts: the last line shown. */
export type ActivityCursor = Pick<ActivityLine, 'day' | 'at' | 'user_id'>;

export const PAGE_SIZE = 20;

/** The achievements this app knows (an id from a newer server is left out). */
export function knownAchievements(line: ActivityLine): Achievement[] {
  return line.achievements
    .map((id) => findAchievement(id))
    .filter((a): a is Achievement => a !== undefined);
}

/** Leaves out lines with nothing this app can show. */
export function showable(lines: ActivityLine[]): ActivityLine[] {
  return lines.filter((l) => l.goal || knownAchievements(l).length > 0);
}

/** "A and B", "A, B and 2 more" */
function names(list: Achievement[]): string {
  if (list.length <= 2) return list.map((a) => a.name).join(' and ');
  return `${list[0].name}, ${list[1].name} and ${list.length - 2} more`;
}

/**
 * What the line says, after the name, all lowercase: "reached their goal ·
 * unlocked first 10k", "unlocked a week in a row". Yours: "reached your
 * goal · +150 coins".
 */
export function lineText(line: ActivityLine, isMe: boolean): string {
  const earned = knownAchievements(line);
  const parts: string[] = [];
  if (line.goal) {
    parts.push(isMe ? 'reached your goal' : 'reached their goal');
    if (isMe && line.coins) parts.push(`+${line.coins} coins`);
  }
  if (earned.length > 0) parts.push(`unlocked ${names(earned)}`);
  return parts.join(' · ').toLowerCase();
}

/** The badge to show: the newest achievement's, or the goal's. */
export function lineBadge(line: ActivityLine): Achievement | 'goal' {
  const earned = knownAchievements(line);
  return earned.length > 0 ? earned[earned.length - 1] : 'goal';
}

const parse = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/**
 * Today, Yesterday, then "Mon Oct 13", from the viewer's date. A friend
 * ahead of you can be on your tomorrow: that's their today, so Today too.
 */
export function dayLabel(day: string, today: string): string {
  const ago = Math.round((parse(today) - parse(day)) / 86_400_000);
  if (ago <= 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  return new Date(parse(day)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** The sentence a screen reader says for a line. */
export function lineLabel(line: ActivityLine, name: string, isMe: boolean, today: string): string {
  return `${isMe ? 'You' : name}, ${lineText(line, isMe)}, ${dayLabel(line.day, today).toLowerCase()}`;
}

/** The position after a page, or null when there's nothing more. */
export function nextCursor(page: ActivityLine[]): ActivityCursor | null {
  if (page.length < PAGE_SIZE) return null;
  const last = page[page.length - 1];
  return { day: last.day, at: last.at, user_id: last.user_id };
}

/** A line's identity: one per person per day. */
export const lineKey = (l: Pick<ActivityLine, 'user_id' | 'day'>) => `${l.user_id}:${l.day}`;

/**
 * Adds a next page under what's shown. Pages never overlap, but a line
 * that gained a part between loads can move up into a page already shown;
 * the copy already shown is kept, so nothing appears twice.
 */
export function appendPage(shown: ActivityLine[], page: ActivityLine[]): ActivityLine[] {
  const seen = new Set(shown.map(lineKey));
  return [...shown, ...page.filter((l) => !seen.has(lineKey(l)))];
}

/** Without this person's lines: straight after blocking or removing them here. */
export function withoutPerson(lines: ActivityLine[], userId: string): ActivityLine[] {
  return lines.filter((l) => l.user_id !== userId);
}

/** Whether a fresh first page has anything the list on screen doesn't. */
export function hasNew(shown: ActivityLine[], fresh: ActivityLine[]): boolean {
  const seen = new Map(shown.map((l) => [lineKey(l), l.at]));
  return fresh.some((l) => seen.get(lineKey(l)) !== l.at);
}
