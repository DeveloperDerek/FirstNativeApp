import { rethrow } from '@/api/register';
import { type LeaderboardRow, myToday, type Period } from '@/api/steps';
import { supabase } from '@/lib/supabase';

export type Group = { id: string; name: string; owner_id: string; invite_code: string };

// CREATE
export async function createGroup(ownerId: string, name: string): Promise<Group> {
  const { data, error } = await supabase
    .from('groups')
    .insert({ name, owner_id: ownerId })
    .select('id, name, owner_id, invite_code')
    .single();
  // The server checks the name (BAD_GROUP_NAME, NAME_NOT_ALLOWED)
  if (error) rethrow(error);
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
  if (error) rethrow(error);
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

// An owner leaving passes the group to its longest-standing member, or
// deletes it if nobody else is in it; the server does that
// (step-tracker-group-owners.txt, Part A)
export async function leaveGroup(groupId: string, userId: string) {
  await removeMember(groupId, userId);
}

export type NextOwner = { user_id: string; username: string; display_name: string | null };

/** Who would take over if you (the owner) left now; null if you're alone. */
export async function nextGroupOwner(groupId: string): Promise<NextOwner | null> {
  const { data, error } = await supabase.rpc('next_group_owner', { gid: groupId });
  if (error) throw error;
  return data;
}

/** Owner only: hand the group to another current member. You stay in it. */
export async function makeGroupOwner(groupId: string, personId: string) {
  const { error } = await supabase.rpc('make_group_owner', { gid: groupId, person: personId });
  if (error) throw error;
}

// Owner only for anyone but yourself (RLS "members leave or kick")
export async function removeMember(groupId: string, userId: string) {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw error;
}

// Compare
// Read through the server's group function, which shows every active
// member of this group (step-tracker-safety.txt, section 2)
export async function groupLeaderboard(groupId: string, period: Period): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('group_leaderboard', {
    gid: groupId,
    period,
    my_today: myToday(),
  });
  if (error) throw error;
  return data;
}
