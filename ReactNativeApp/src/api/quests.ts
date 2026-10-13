import { supabase } from '@/lib/supabase';

// Group quests. The app only calls the database functions in
// supabase/migrations/*_group_quests.sql and *_quests_without_voting.sql;
// the database decides the party, progress, success and payment.

export type QuestStatus = 'active' | 'completed' | 'failed' | 'cancelled';

export type QuestMember = {
  user_id: string;
  display_name: string | null;
  /** Raw JSON from the database; run it through normalizeAvatar() before drawing. */
  avatar: unknown;
  sharing: boolean;
  in_party: boolean;
  /** false = left the group (their steps still count) */
  in_group: boolean;
  steps: number;
  uploaded_at: string | null;
  coins_paid: number | null;
  last_seen: string | null;
};

export type Quest = {
  id: string;
  type_id: string;
  proposer_id: string | null;
  status: QuestStatus;
  /** Started straight away rather than at a set time */
  start_asap: boolean;
  starts_at: string | null;
  ends_at: string | null;
  grace_ends_at: string | null;
  goal: number;
  party_size: number | null;
  total_steps: number;
  completed_at: string | null;
  cancelled_at: string | null;
  settled_at: string | null;
  step_coins: number | null;
  multiplier: number | null;
  coins_each: number | null;
};

export type GroupQuest = {
  /** The current quest, or the latest result; null = none to show. */
  quest: Quest | null;
  /**
   * The group's members, plus anyone in the quest's party who has left.
   * Most steps first. Without a quest, just the group.
   */
  members: QuestMember[];
  /** When the group may start another (cooldown), if it has had a quest. */
  nextQuestAt: Date | null;
  /** Server clock minus phone clock, so countdowns follow the server. */
  clockOffset: number;
};

/** Also moves the quest forward (starts it, ends it, pays it) if it is time. */
export async function getGroupQuest(groupId: string): Promise<GroupQuest> {
  const { data, error } = await supabase.rpc('group_quest', { gid: groupId });
  if (error) throw new Error(questErrorMessage(error));
  const result = data as {
    quest: Quest | null;
    members: QuestMember[];
    next_quest_at: string | null;
    server_now: string;
  };
  return {
    quest: result.quest,
    members: result.members,
    nextQuestAt: result.next_quest_at ? new Date(result.next_quest_at) : null,
    clockOffset: new Date(result.server_now).getTime() - Date.now(),
  };
}

/**
 * Starts a quest for the group: no vote, it is locked in at once for
 * every member sharing steps. startsAt = null means right now.
 */
export async function proposeQuest(groupId: string, typeId: string, startsAt: Date | null) {
  const { data, error } = await supabase.rpc('propose_quest', {
    gid: groupId,
    p_type: typeId,
    p_starts_at: startsAt?.toISOString() ?? null,
  });
  if (error) throw new Error(questErrorMessage(error));
  return data as string;
}

/** Replaces this member's hourly steps for the quest. Returns the group total. */
export async function uploadQuestSteps(questId: string, hours: { hour: number; steps: number }[]) {
  const { data, error } = await supabase.rpc('upload_quest_steps', { qid: questId, p_hours: hours });
  if (error) throw new Error(questErrorMessage(error));
  return data as number;
}

export type MyQuest = {
  quest_id: string;
  group_id: string;
  group_name: string;
  type_id: string;
  status: QuestStatus;
  proposer_name: string | null;
  in_party: boolean;
  starts_at: string | null;
  ends_at: string | null;
  goal: number;
  total_steps: number;
  settled_at: string | null;
  coins_paid: number | null;
  result_seen: boolean;
};

/** Quests across all my groups that need me: running quests and unseen results. */
export async function listMyQuests(): Promise<MyQuest[]> {
  const { data, error } = await supabase.rpc('my_quests');
  if (error) throw new Error(questErrorMessage(error));
  return data as MyQuest[];
}

/** Stops the result banner for this quest. */
export async function markQuestSeen(questId: string) {
  const { error } = await supabase.rpc('mark_quest_seen', { qid: questId });
  if (error) throw error;
}

const MESSAGES: Record<string, string> = {
  GROUP_TOO_SMALL: 'Quests need at least 2 people in the group with step sharing on.',
  QUEST_IN_PROGRESS: 'This group already has a quest going.',
  QUEST_COOLDOWN: 'The group is resting after its last quest. Try again soon.',
  BAD_START_TIME: 'Pick a start time within the next 24 hours.',
  UNKNOWN_QUEST: 'That quest is not available.',
  SHARING_REQUIRED: 'Turn on step sharing to take part in quests.',
  NOT_A_MEMBER: 'You are not in this group.',
  NOT_IN_PARTY: 'You are not in this quest.',
  QUEST_NOT_OPEN: 'This quest is not taking steps right now.',
  TOO_MANY_STEPS: 'Some of your steps look impossible (over 15,000 in an hour).',
  BAD_STEPS: 'Your quest steps could not be read.',
};

function questErrorMessage(e: unknown): string {
  const message = (e as { message?: string } | null)?.message ?? '';
  const key = Object.keys(MESSAGES).find((k) => message.includes(k));
  return key ? MESSAGES[key] : message || 'Something went wrong with the quest.';
}
