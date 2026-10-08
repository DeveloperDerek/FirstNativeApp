import type { LeaderboardRow } from '@/api/steps';
import { supabase } from '@/lib/supabase';

export type PublicProfile = {
  id: string;
  username: string;
  display_name: string | null;
  /** Raw JSON from the database; run it through normalizeAvatar() before drawing. */
  avatar: unknown;
};

export type Friendship = {
  id: string;
  status: 'pending' | 'accepted';
  requester_id: string;
  addressee_id: string;
  requester: PublicProfile;
  addressee: PublicProfile;
};

// Search users to add
export async function searchUsers(query: string, myId: string): Promise<PublicProfile[]> {
  // Strip characters that have meaning in a LIKE pattern.
  const term = query.trim().replace(/[%_\\]/g, '');
  if (!term) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar')
    .ilike('username', `%${term}%`)
    .neq('id', myId)
    .limit(20);
  if (error) throw error;
  return data;
}

// CREATE - send request
export async function sendFriendRequest(myId: string, otherId: string) {
  const { error } = await supabase
    .from('friendships')
    .insert({ requester_id: myId, addressee_id: otherId });
  if (error?.code === '23505') throw new Error('You already have a request with this person.');
  if (error) throw error;
}

// READ - friends and pending requests
export async function listFriendships(): Promise<Friendship[]> {
  const { data, error } = await supabase.from('friendships').select(`
      id, status, requester_id, addressee_id,
      requester:profiles!friendships_requester_id_fkey(id, username, display_name, avatar),
      addressee:profiles!friendships_addressee_id_fkey(id, username, display_name, avatar)
    `);
  if (error) throw error;
  return data as unknown as Friendship[];
}

// UPDATE - accept
export async function acceptFriendRequest(friendshipId: string) {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('id', friendshipId);
  if (error) throw error;
}

// DELETE - decline, cancel, or unfriend
export async function removeFriendship(friendshipId: string) {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
}

// Compare
export async function friendsLeaderboard(fromDay: string, toDay: string): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('friends_leaderboard', {
    from_day: fromDay,
    to_day: toDay,
  });
  if (error) throw error;
  return data;
}
