// Group quest rules (step-tracker-group-quests.txt, sections 3 and 5).
// The database decides everything; these copies are only for showing
// numbers before the server has them (the proposal sheet, "so far").
// Keep them in step with supabase/migrations/*_group_quests.sql.

export type QuestTypeId = 'sprint' | 'patrol' | 'expedition' | 'day_trek' | 'weekend';

export type QuestType = { id: QuestTypeId; name: string; hours: number; goal: number };

/** Stage A offers Sprint and Patrol; the longer quests come later. */
export const QUEST_TYPES: QuestType[] = [
  { id: 'sprint', name: 'Sprint', hours: 2, goal: 8_000 },
  { id: 'patrol', name: 'Patrol', hours: 4, goal: 15_000 },
];

const ALL_TYPES: QuestType[] = [
  ...QUEST_TYPES,
  { id: 'expedition', name: 'Expedition', hours: 8, goal: 30_000 },
  { id: 'day_trek', name: 'Day Trek', hours: 12, goal: 50_000 },
  { id: 'weekend', name: 'Weekend Journey', hours: 48, goal: 120_000 },
];

export function questType(id: string): QuestType {
  return ALL_TYPES.find((t) => t.id === id) ?? { id: 'sprint', name: 'Quest', hours: 2, goal: 8_000 };
}

/** Steps past the goal pay too, up to this share of the goal. */
export const OVERSHOOT = 1.5;
export const MIN_COINS_EACH = 10;
/** Taking part needs at least this many members. */
export const MIN_PARTY = 2;

/** 1 coin per 200 steps, counting up to 150% of the goal. */
export function stepCoins(steps: number, goal: number): number {
  return Math.floor(Math.min(steps, Math.floor((goal * 3) / 2)) / 200);
}

/** x1.2 for 2 members, x1.6 for 4, ... at most x2.5. */
export function groupMultiplier(party: number): number {
  // Tenths, so 1 + 0.2 * 3 is exactly 1.6
  return Math.min(25, 10 + 2 * (Math.max(party, 1) - 1)) / 10;
}

/** Coins each party member gets for a completed quest. */
export function coinsEach(steps: number, goal: number, party: number): number {
  const size = Math.max(party, 1);
  // Postgres rounds halves away from zero, as Math.round does for positives
  return Math.max(MIN_COINS_EACH, Math.round((stepCoins(steps, goal) * groupMultiplier(size)) / size));
}

/**
 * The quest window cut into hours from its start: piece 0 is start to
 * start + 1h, and the last piece stops at the end. Only pieces that have
 * begun by `now` are returned, the current one cut to `now`.
 */
export function hourPieces(start: Date, end: Date, now: Date) {
  const pieces: { hour: number; from: Date; to: Date }[] = [];
  const stop = Math.min(end.getTime(), now.getTime());
  for (let hour = 0; start.getTime() + hour * 3_600_000 < stop; hour++) {
    const from = new Date(start.getTime() + hour * 3_600_000);
    const to = new Date(Math.min(from.getTime() + 3_600_000, stop));
    pieces.push({ hour, from, to });
  }
  return pieces;
}

/** "1h 12m", "45m", "2d 3h" */
export function durationText(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
