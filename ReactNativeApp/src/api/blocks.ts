import { supabase } from '@/lib/supabase';

// Blocking (step-tracker-safety.txt, Part A). The server ends any
// friendship or request between you, and hides you from each other
// everywhere except inside a group you share. The other person isn't told.

export type BlockedPerson = {
  user_id: string;
  username: string;
  display_name: string | null;
  /** Raw JSON from the database; run it through normalizeAvatar() before drawing. */
  avatar: unknown;
  blocked_at: string;
};

export async function blockUser(personId: string) {
  const { error } = await supabase.rpc('block_user', { person: personId });
  if (error) throw error;
}

/** Lifts your block only; the old friendship doesn't come back. */
export async function unblockUser(personId: string) {
  const { error } = await supabase.rpc('unblock_user', { person: personId });
  if (error) throw error;
}

/** The people you blocked, newest first. */
export async function listBlocked(): Promise<BlockedPerson[]> {
  const { data, error } = await supabase.rpc('my_blocks');
  if (error) throw error;
  return data;
}
