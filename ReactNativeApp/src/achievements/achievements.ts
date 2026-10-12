// The achievements as the app shows them (step-tracker-achievements.txt).
// The server knows only the ids, kinds and thresholds
// (supabase/migrations/*_achievements.sql); the names, the badge numbers
// and the items they unlock live here, like the item names in catalog.ts.
// No React Native imports, so `npm test` can run it.

export type AchievementKind = 'day_steps' | 'total_steps' | 'streak' | 'quests';

export type Achievement = {
  id: string;
  kind: AchievementKind;
  threshold: number;
  name: string;
  /** Written under the badge */
  short: string;
  /** The item it unlocks, which can't be bought (shop_items.unlocked_by) */
  reward?: { item: string; label: string; pet?: boolean };
};

/** In the server's sort order. */
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_10k', kind: 'day_steps', threshold: 10_000, name: 'First 10K', short: '10K' },
  { id: 'big_day', kind: 'day_steps', threshold: 20_000, name: 'Big day', short: '20K' },
  { id: 'huge_day', kind: 'day_steps', threshold: 30_000, name: 'Huge day', short: '30K' },
  { id: 'steps_100k', kind: 'total_steps', threshold: 100_000, name: '100,000 steps', short: '100K' },
  {
    id: 'steps_1m',
    kind: 'total_steps',
    threshold: 1_000_000,
    name: 'A million steps',
    short: '1M',
    reward: { item: 'shoes_winged', label: 'Winged sneakers' },
  },
  { id: 'steps_5m', kind: 'total_steps', threshold: 5_000_000, name: 'Five million steps', short: '5M' },
  { id: 'streak_7', kind: 'streak', threshold: 7, name: 'A week in a row', short: '7' },
  {
    id: 'streak_30',
    kind: 'streak',
    threshold: 30,
    name: 'A month in a row',
    short: '30',
    reward: { item: 'cape_ember', label: 'Ember cape' },
  },
  {
    id: 'streak_100',
    kind: 'streak',
    threshold: 100,
    name: '100 days in a row',
    short: '100',
    reward: { item: 'hat_laurel', label: 'Laurel wreath' },
  },
  {
    id: 'quest_1',
    kind: 'quests',
    threshold: 1,
    name: 'First quest won',
    short: '1',
    reward: { item: 'pet_mimic', label: 'Mimic', pet: true },
  },
  { id: 'quest_10', kind: 'quests', threshold: 10, name: 'Ten quests won', short: '10' },
];

export function findAchievement(id: string) {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** What each kind is for, in a sentence ("a day of 20,000 steps or more"). */
export function describe(a: Achievement): string {
  const n = a.threshold.toLocaleString('en-US');
  switch (a.kind) {
    case 'day_steps':
      return `A day of ${n} steps or more`;
    case 'total_steps':
      return `${n} steps all together`;
    case 'streak':
      return `Your goal ${n} days in a row`;
    case 'quests':
      return a.threshold === 1 ? 'Win a group quest' : `Win ${n} group quests`;
  }
}

/** The achievement that unlocks this item, if it's a reward item. */
export function unlockedBy(itemId: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.reward?.item === itemId);
}

/** Customize's note on a reward item not earned yet. */
export function lockText(itemId: string): string | null {
  const a = unlockedBy(itemId);
  return a ? `Earn ${a.name} to unlock` : null;
}

// ---------------------------------------------------------------- the list

/** What my_achievements() returns. */
export type MyAchievements = {
  sharing: boolean;
  /** Newest first */
  earned: { id: string; earned_on: string }[];
  /** Only while sharing: each one not earned yet */
  progress: { id: string; value: number; threshold: number }[];
};

export type ListEntry = {
  achievement: Achievement;
  /** 'YYYY-MM-DD', or null while locked */
  earnedOn: string | null;
  /** "640,000 of 1,000,000 steps"; null when earned or not sharing */
  progress: string | null;
};

/** How far along a locked one is, in words. */
export function progressText(a: Achievement, value: number): string {
  const v = Math.min(value, a.threshold).toLocaleString('en-US');
  const t = a.threshold.toLocaleString('en-US');
  switch (a.kind) {
    case 'day_steps':
      return `Best day ${v} of ${t} steps`;
    case 'total_steps':
      return `${v} of ${t} steps`;
    case 'streak':
      return `Best streak ${v} of ${t}`;
    case 'quests':
      return `${v} of ${t} ${a.threshold === 1 ? 'quest' : 'quests'}`;
  }
}

/**
 * The full list: earned first, newest first; then locked ones, closest
 * first (ties in the server's order). Ids this app doesn't know (added by
 * a later version) are left out.
 */
export function achievementList(mine: MyAchievements): ListEntry[] {
  const order = (id: string) => ACHIEVEMENTS.findIndex((a) => a.id === id);
  const earnedOn = new Map(mine.earned.map((e) => [e.id, e.earned_on]));
  const progress = new Map(mine.progress.map((p) => [p.id, p.value]));

  const earned = ACHIEVEMENTS.filter((a) => earnedOn.has(a.id))
    .map((a) => ({ achievement: a, earnedOn: earnedOn.get(a.id)!, progress: null }))
    .sort((x, y) =>
      x.earnedOn === y.earnedOn
        ? order(y.achievement.id) - order(x.achievement.id)
        : x.earnedOn < y.earnedOn
          ? 1
          : -1
    );

  const closeness = (a: Achievement) => (progress.get(a.id) ?? 0) / a.threshold;
  const locked = ACHIEVEMENTS.filter((a) => !earnedOn.has(a.id))
    .sort((x, y) => (mine.sharing ? closeness(y) - closeness(x) : 0) || order(x.id) - order(y.id))
    .map((a) => ({
      achievement: a,
      earnedOn: null,
      progress: mine.sharing ? progressText(a, progress.get(a.id) ?? 0) : null,
    }));

  return [...earned, ...locked];
}

// ---------------------------------------------------------------- the card

/** What player_achievements() and group_member_card's 'achievements' hold. */
export type EarnedAchievement = { id: string; earned_on: string };

/**
 * Someone else's earned ones for their player card, newest first: names and
 * dates only, never progress. Ids this app doesn't know are left out, so the
 * count on the card matches the list it opens.
 */
export function earnedList(earned: EarnedAchievement[]): ListEntry[] {
  return achievementList({ sharing: false, earned, progress: [] }).filter(
    (e) => e.earnedOn !== null
  );
}

/** "1 achievement", "9 achievements" */
export function achievementCount(n: number): string {
  return `${n} ${n === 1 ? 'achievement' : 'achievements'}`;
}

/** "12 Oct 2026" style, from 'YYYY-MM-DD', without the phone's time zone moving it. */
export function formatEarnedOn(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------- the message

/** What new_achievements() returns: unseen ones, oldest first. */
export type NewAchievement = {
  id: string;
  earned_on: string;
  at_launch: boolean;
  item: string | null;
};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "You can now wear the Winged sneakers." for each reward item among them. */
function rewardLines(list: Achievement[]): string[] {
  const rewards = list.flatMap((a) => (a.reward ? [a.reward] : []));
  const worn = rewards.filter((r) => !r.pet).map((r) => `the ${r.label}`);
  const pets = rewards.filter((r) => r.pet).map((r) => `The ${r.label}`);
  return [
    ...(worn.length ? [`You can now wear ${joinNames(worn)}.`] : []),
    ...pets.map((p) => `${p} can now walk beside you.`),
  ];
}

/**
 * The in-app message for unseen achievements: one, several, or, when any
 * came from the launch check, one summary for them all. null when there's
 * nothing this app knows how to show.
 */
export function unlockMessage(news: NewAchievement[]): { title: string; body: string } | null {
  const list = news.flatMap((n) => findAchievement(n.id) ?? []);
  if (list.length === 0) return null;
  const rewards = rewardLines(list);

  if (news.some((n) => n.at_launch)) {
    return {
      title: list.length === 1 ? 'Achievement unlocked' : 'Achievements unlocked',
      body: [
        list.length === 1
          ? `You've earned ${list[0].name}.`
          : `You've earned ${list.length} achievements.`,
        ...rewards,
        'See them all in Profile.',
      ].join(' '),
    };
  }
  if (list.length === 1) {
    return {
      title: 'Achievement unlocked',
      body: [`${list[0].name}.`, ...rewards].join(' '),
    };
  }
  return {
    title: 'Achievements unlocked',
    body: [`${joinNames(list.map((a) => a.name))}.`, ...rewards].join(' '),
  };
}

/**
 * The ids on screen right now, so a second fetch while the message is up
 * doesn't show them again. Acknowledging happens only after they've been
 * shown; until then a later fetch (after the app closed) brings them back.
 */
export class ShowingNow {
  private ids = new Set<string>();

  /** Those not already on screen, now counted as on screen. */
  take(news: NewAchievement[]): NewAchievement[] {
    const fresh = news.filter((n) => !this.ids.has(n.id));
    for (const n of fresh) this.ids.add(n.id);
    return fresh;
  }

  /** The message with these ids has closed. */
  release(ids: string[]) {
    for (const id of ids) this.ids.delete(id);
  }
}
