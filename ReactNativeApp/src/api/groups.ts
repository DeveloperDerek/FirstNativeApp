import type { LeaderboardRow } from '@/api/steps';
import { supabase } from '@/lib/supabase';

export type Group = { id: string; name: string; owner_id: string; invite_code: string };

// CREATE
export async function createGroup(ownerId: string, name: string): Promise<Group> {
  const { data, error } = await supabase
    .from('groups')
    .insert({ name, owner_id: ownerId })
    .select('id, name, owner_id, invite_code')
    .single();
  if (error) throw error;
  return data; // includes invite_code to share
}

// READ
export async function listMyGroups(): Promise<Group[]> {
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, owner_id, invite_code')
    .order('created_at');
  if (error) throw error;
  return data; // RLS returns only groups you belong to
}

export async function getGroup(groupId: string): Promise<Group> {
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, owner_id, invite_code')
    .eq('id', groupId)
    .single();
  if (error) throw error;
  return data;
}

// UPDATE (owner only)
export async function renameGroup(groupId: string, name: string) {
  const { error } = await supabase.from('groups').update({ name }).eq('id', groupId);
  if (error) throw error;
}

// DELETE (owner only)
export async function deleteGroup(groupId: string) {
  const { error } = await supabase.from('groups').delete().eq('id', groupId);
  if (error) throw error;
}

// Join / leave
export async function joinGroup(inviteCode: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_group', { code: inviteCode });
  if (error) throw error;
  return data as string; // group id
}

export async function leaveGroup(groupId: string, userId: string) {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw error;
}

// Compare
export async function groupLeaderboard(
  groupId: string,
  fromDay: string,
  toDay: string
): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('group_leaderboard', {
    gid: groupId,
    from_day: fromDay,
    to_day: toDay,
  });
  if (error) throw error;
  return data;
}
