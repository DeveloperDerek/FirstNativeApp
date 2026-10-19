// The activity board in Friends (step-tracker-activity-board.txt): one
// line per thing done (the day's goal, an achievement, a purchase). The server decides what
// is on it (supabase/migrations/*_activity_board.sql); this is the words
// and the list handling. No React Native imports, so `npm test` can run it.

import { type Achievement, findAchievement } from '../achievements/achievements.ts';
import { dayToUtc } from '../lib/day.ts';

/** What a line is about: the day's goal, one achievement, or one purchase. */
export type LineKind = 'goal' | 'achievement' | 'purchase';

/** One line from activity_feed(). */
export type ActivityLine = {
  /** 'YYYY-MM-DD', the day as the person's phone counted it */
  day: string;
  /** When it happened; part of the page position */
  at: string;
  user_id: string;
  kind: LineKind;
  /** The achievement or item id; '' for the goal */
  ref: string;
  display_name: string | null;
  /** Raw JSON from the database; run it through normalizeAvatar() before drawing. */
  avatar: unknown;
  goal: boolean;
  /** Yours only: the day's coins */
  coins: number | null;
  /** Earned that day, oldest first */
  achievements: string[];
  /** Shop item ids bought that day, oldest first; missing from a server without them */
  items?: string[];
  /** Goal lines: the item won with that day's roll (yours and friends'); missing or null without one */
  prize_item?: string | null;
  /** Your goal lines only: the coins won with that day's roll */
  prize_coins?: number | null;
  /** Kudos on the line (step-tracker-kudos.txt); missing from a server without kudos */
  kudos?: number;
  /** You gave kudos on it (always false on yours) */
  my_kudos?: boolean;
  /** Yours only: how many of its kudos you haven't been shown */
  new_kudos?: number | null;
};

/** Where the next page starts: the last line shown. */
export type ActivityCursor = Pick<ActivityLine, 'day' | 'at' | 'user_id' | 'kind' | 'ref'>;

export const PAGE_SIZE = 20;

/**
 * The board's name for a shop item ("red cap"), or undefined for an id
 * this app doesn't know. The names live with the item art, which `npm
 * test` can't load, so the screen passes boardItemName in.
 */
export type ItemName = (id: string) => string | undefined;

const noItems: ItemName = () => undefined;

/** The items this app knows, with their names (an id from a newer server is left out). */
export function knownItems(
  line: Pick<ActivityLine, 'items'>,
  itemName: ItemName = noItems
): { id: string; name: string }[] {
  return (line.items ?? []).flatMap((id) => {
    const name = itemName(id);
    return name ? [{ id, name }] : [];
  });
}

/** The achievements this app knows (an id from a newer server is left out). */
export function knownAchievements(line: ActivityLine): Achievement[] {
  return line.achievements
    .map((id) => findAchievement(id))
    .filter((a): a is Achievement => a !== undefined);
}

/** Leaves out lines with nothing this app can show. */
export function showable(lines: ActivityLine[], itemName: ItemName = noItems): ActivityLine[] {
  return lines.filter(
    (l) => l.goal || knownAchievements(l).length > 0 || knownItems(l, itemName).length > 0
  );
}

/** "A and B", "A, B and 2 more" */
function names(list: { name: string }[]): string {
  if (list.length <= 2) return list.map((a) => a.name).join(' and ');
  return `${list[0].name}, ${list[1].name} and ${list.length - 2} more`;
}

/**
 * What the line says, after the name, all lowercase: "reached their goal ·
 * unlocked first 10k", "unlocked a week in a row", "bought red cap". Yours:
 * "reached your goal · +150 coins". With the daily roll (ROLL-11): "reached
 * their goal · won pirate hat", and yours "reached your goal · +250 coins"
 * for coins won. Never a price: the wallet is private.
 */
export function lineText(line: ActivityLine, isMe: boolean, itemName: ItemName = noItems): string {
  const earned = knownAchievements(line);
  const bought = knownItems(line, itemName);
  const parts: string[] = [];
  if (line.goal) {
    parts.push(isMe ? 'reached your goal' : 'reached their goal');
    const won = line.prize_item ? itemName(line.prize_item) : undefined;
    if (won) parts.push(`won ${won}`);
    else if (isMe && line.prize_coins) parts.push(`+${line.prize_coins} coins`);
    else if (isMe && line.coins) parts.push(`+${line.coins} coins`);
  }
  if (earned.length > 0) parts.push(`unlocked ${names(earned)}`);
  if (bought.length > 0) parts.push(`bought ${names(bought)}`);
  return parts.join(' · ').toLowerCase();
}

/**
 * The picture beside the kudos: the newest item bought (the thing itself),
 * else the item won with the day's roll, else the newest achievement's
 * badge, else the goal's.
 */
export function lineBadge(
  line: ActivityLine,
  itemName: ItemName = noItems
): { item: string } | Achievement | 'goal' {
  const bought = knownItems(line, itemName);
  if (bought.length > 0) return { item: bought[bought.length - 1].id };
  if (line.prize_item && itemName(line.prize_item)) return { item: line.prize_item };
  const earned = knownAchievements(line);
  return earned.length > 0 ? earned[earned.length - 1] : 'goal';
}

/**
 * Today, Yesterday, then "Mon Oct 13", from the viewer's date. A friend
 * ahead of you can be on your tomorrow: that's their today, so Today too.
 */
export function dayLabel(day: string, today: string): string {
  const ago = Math.round((dayToUtc(today) - dayToUtc(day)) / 86_400_000);
  if (ago <= 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  return new Date(dayToUtc(day)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** The sentence a screen reader says for a line, with its kudos at the end. */
export function lineLabel(
  line: ActivityLine,
  name: string,
  isMe: boolean,
  today: string,
  itemName: ItemName = noItems
): string {
  const said = `${isMe ? 'You' : name}, ${lineText(line, isMe, itemName)}, ${dayLabel(line.day, today).toLowerCase()}`;
  return line.kudos ? `${said}, ${kudosCount(line.kudos)}` : said;
}

/** The position after a page, or null when there's nothing more. */
export function nextCursor(page: ActivityLine[]): ActivityCursor | null {
  if (page.length < PAGE_SIZE) return null;
  const last = page[page.length - 1];
  return { day: last.day, at: last.at, user_id: last.user_id, kind: last.kind, ref: last.ref };
}

/** A line's identity: one per thing a person did that day. */
export const lineKey = (l: Pick<ActivityLine, 'user_id' | 'day' | 'kind' | 'ref'>) =>
  `${l.user_id}:${l.day}:${l.kind}:${l.ref}`;

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

// ---------------------------------------------------------------- kudos
// (step-tracker-kudos.txt) A party popper on a friend's line, one per person per
// line, never taken back. "New" is decided by the server; the app only
// shows it.

/** "1 kudos" reads oddly; kudos is the same word either way. */
const kudosCount = (n: number) => `${n} kudos`;

/** False when the server doesn't know kudos yet: no button, no count. */
export const hasKudos = (line: ActivityLine) => line.kudos !== undefined;

/**
 * The line with your kudos on it: shown straight away, kept until the next
 * load replaces the list. `count` is the server's answer when there is
 * one; without it, one more than shown.
 */
export function withKudosGiven(lines: ActivityLine[], key: string, count?: number): ActivityLine[] {
  return lines.map((l) => {
    if (lineKey(l) !== key) return l;
    const shown = l.kudos ?? 0;
    return { ...l, my_kudos: true, kudos: count ?? (l.my_kudos ? shown : shown + 1) };
  });
}

/** Back as it was: the server refused, or the phone is offline. */
export function withoutKudosGiven(lines: ActivityLine[], key: string): ActivityLine[] {
  return lines.map((l) =>
    lineKey(l) === key && l.my_kudos
      ? { ...l, my_kudos: false, kudos: Math.max(0, (l.kudos ?? 1) - 1) }
      : l
  );
}

/** What a screen reader says for the kudos button. */
export function kudosLabel(line: ActivityLine, name: string, isMe: boolean): string {
  const n = line.kudos ?? 0;
  if (isMe) {
    const fresh = line.new_kudos ? `, ${line.new_kudos} new` : '';
    return `${kudosCount(n)}${fresh}, opens who gave them`;
  }
  return line.my_kudos ? `You gave ${name} kudos, ${n} in all` : `Give ${name} kudos, ${n} so far`;
}

/** "Ana", "Ana and Sam", "Ana, Sam and 2 more". */
export function giverNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** Someone who gave kudos (line_kudos and new_kudos). */
export type Giver = {
  user_id: string;
  display_name: string | null;
  avatar: unknown;
  created_at: string;
};

/** One of your lines in the "New kudos" list. */
export type NewKudosLine = {
  day: string;
  kind: LineKind;
  ref: string;
  goal: boolean;
  achievements: string[];
  /** Missing from a server without purchases on the board */
  items?: string[];
  /** Only the new ones, newest first */
  givers: Giver[];
};

export type NewKudos = {
  lines: NewKudosLine[];
  /**
   * The newest kudos in the list, for mark_kudos_seen. Kept as the
   * server's text: a Date would cut it to milliseconds, and the newest
   * kudos would then stay new for good.
   */
  up_to: string | null;
};

/** What a line in the "New kudos" list says; "your day" when this app can't describe it. */
export function newKudosText(l: NewKudosLine, itemName: ItemName = noItems): string {
  const text = lineText(
    { ...l, at: '', user_id: '', display_name: null, avatar: null, coins: null },
    true,
    itemName
  );
  return text || 'your day';
}
