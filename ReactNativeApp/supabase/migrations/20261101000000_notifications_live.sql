-- StepTracker: tab bar notifications, Phase 2 (step-tracker-notifications.txt,
-- section 3). Live badge updates while the app is open, and a Groups badge
-- for quests waiting for your vote.
--
-- FRIEND REQUESTS END IN A STATUS, NOT A DELETE
-- Live delete events are not checked against the privacy rules and can't
-- be filtered to "requests sent to me", so a cancelled request would never
-- reach the person it was sent to. Every ending is now an ordinary update:
--
--   pending  -> accepted   (the person it was sent to)
--   pending  -> declined   (the person it was sent to)
--   pending  -> cancelled  (the sender)
--   accepted -> removed    (either friend: "Remove friend")
--
-- Nothing the app does deletes a friendship any more. Old rows stay as
-- history; only pending and accepted rows mean anything (is_friend() has
-- always looked at accepted only).

alter table public.friendships drop constraint friendships_status_check;
alter table public.friendships add constraint friendships_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'removed'));

-- When the request was answered, cancelled or the friendship removed
alter table public.friendships add column responded_at timestamptz;

-- One LIVE row per pair, regardless of who sent it. Declined, cancelled
-- and removed rows don't count, so either person can send a new request.
-- Two people sending each other a request at once still get only one.
drop index public.friendships_pair_idx;
create unique index friendships_pair_idx on public.friendships (
  least(requester_id, addressee_id),
  greatest(requester_id, addressee_id)
) where status in ('pending', 'accepted');

-- Who may make which change. A trigger rather than one policy per change:
-- Postgres combines permissive policies with OR, so separate policies
-- would let one person's "using" pair with another's "with check" (for
-- example accepted -> declined). Only status is updatable (column grant).
create function public.friendship_status_change()
returns trigger language plpgsql set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if new.status is distinct from old.status then
    -- Server-side jobs (no signed-in user) are not limited
    if uid is not null and not (
         (old.status = 'pending' and new.status in ('accepted', 'declined')
          and uid = old.addressee_id)
      or (old.status = 'pending' and new.status = 'cancelled'
          and uid = old.requester_id)
      or (old.status = 'accepted' and new.status = 'removed'
          and uid in (old.requester_id, old.addressee_id))) then
      raise exception 'FRIENDSHIP_CHANGE_NOT_ALLOWED' using errcode = '42501';
    end if;
    new.responded_at := now();
  end if;
  return new;
end;
$$;

create trigger friendships_status_change
  before update on public.friendships
  for each row execute function public.friendship_status_change();

-- Reading stays "your own rows, with an active other person". Ended rows
-- have to stay readable to the two people in them: a live update is only
-- delivered to someone who can read the row as it is AFTER the change, so
-- hiding cancelled rows would hide the cancel from the person it was sent
-- to. They show nothing new: each person already knew about the request.
drop policy "friendships accept" on public.friendships;
create policy "friendships update" on public.friendships
  for update to authenticated
  using (auth.uid() in (requester_id, addressee_id)
         and (select public.is_active_account()))
  with check (auth.uid() in (requester_id, addressee_id));

-- No deleting from the app. Rows go only when an account is deleted.
drop policy "friendships remove" on public.friendships;
revoke delete on public.friendships from authenticated;

-- Live updates. The app listens for inserts and updates to requests sent
-- to it (filter addressee_id = me); the privacy rules above decide who
-- receives each one.
--
-- What is still exposed (tested with three accounts on local Supabase):
-- deleting an ACCOUNT deletes its friendship rows, and any signed-in user
-- who listens for deletes on this table hears each one, with only the
-- row's random id ({"id": "..."}): no people, no status. The app doesn't
-- listen for deletes. Inserts and updates reach only the two people in
-- the row, even when someone else asks for "addressee_id = them".
alter publication supabase_realtime add table public.friendships;

-- =====================================================================
-- COUNTS: friend requests, and quests waiting for your vote
-- =====================================================================
-- quest_votes: quests in your groups still voting, with the vote deadline
-- still in the future (nothing moves a quest on when its deadline passes,
-- so "voting" alone is not trusted), that you haven't voted on.
-- next_vote_deadline: the soonest of those deadlines, so the app can ask
-- again the moment it passes. Both tabs need sharing (no Requests or
-- quest card without it), and a non-active account sees nothing (6f).
create or replace function public.notification_counts()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  with live as (
    select public.is_active_account() and public.has_sharing_consent() as ok
  ),
  waiting as (
    select q.vote_deadline
    from public.quests q
    where (select ok from live)
      and q.status = 'voting'
      and q.vote_deadline > now()
      and exists (select 1 from public.group_members m
                  where m.group_id = q.group_id and m.user_id = auth.uid())
      and not exists (select 1 from public.quest_votes v
                      where v.quest_id = q.id and v.user_id = auth.uid())
  )
  select jsonb_build_object(
    'friend_requests', case when (select ok from live) then (
      select count(*) from public.friendships f
      where f.addressee_id = auth.uid() and f.status = 'pending')
    else 0 end,
    'quest_votes', (select count(*) from waiting),
    'next_vote_deadline', (select min(vote_deadline) from waiting))
$$;
