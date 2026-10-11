-- StepTracker: blocking (step-tracker-safety.txt, section 2 "Security
-- rules" and section 3 "Part A - Block").
--
-- A blocked pair can never read each other through the tables (profiles,
-- daily_steps, last_seen), with no exception for groups. Inside a group
-- they share, they still see each other, but only through group
-- functions that check membership themselves (decision 1). Group mates
-- who aren't friends no longer read each other's step history or last
-- seen from the tables at all: the group screens get what they show from
-- the group functions, inside a fixed window of days.

-- =====================================================================
-- WHO BLOCKED WHOM
-- =====================================================================
-- One row per pair and direction. You can read the rows you made (for
-- Profile > Blocked people), never the rows naming you. Changed only
-- through block_user() / unblock_user().
create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
-- For "has anyone blocked me" lookups in the checks below
create index user_blocks_blocked_idx on public.user_blocks (blocked_id, blocker_id);

alter table public.user_blocks enable row level security;
create policy "blocks read own" on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());
revoke insert, update, delete, truncate on public.user_blocks from anon, authenticated;

-- =====================================================================
-- THE CHECKS
-- =====================================================================

-- INTERNAL. Has either of these two blocked the other? The app can't call
-- it: it would say whether any two people block each other.
create function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks x
    where (x.blocker_id = a and x.blocked_id = b)
       or (x.blocker_id = b and x.blocked_id = a))
$$;

-- For the read rules, so callable by every signed-in person: true only if
-- the caller is active, that person is active, and neither has blocked
-- the other. It is always about the caller (auth.uid(), never an
-- argument) and one person, and answers false alike for a block, a
-- paused or unfinished account and a deleted one, so it never says why.
create function public.can_see(person uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_active_account()
     and public.is_active_user(person)
     and not exists (
       select 1 from public.user_blocks x
       where (x.blocker_id = auth.uid() and x.blocked_id = person)
          or (x.blocker_id = person and x.blocked_id = auth.uid()))
$$;

-- INTERNAL. Requests and blocks between the same two people take this
-- lock first, so they can't race, even when no friendship row exists to
-- lock. The two ids in a fixed order: A+B and B+A are the same lock.
-- Held until the transaction ends.
create function public.lock_pair(a uuid, b uuid)
returns void language sql volatile set search_path = ''
as $$
  select pg_advisory_xact_lock(
    hashtextextended('pair:' || least(a, b)::text || ':' || greatest(a, b)::text, 0))
$$;

-- =====================================================================
-- BLOCK, UNBLOCK, AND YOUR LIST
-- =====================================================================

-- Blocks someone and ends any friendship or request between you:
--   accepted -> removed, your request -> cancelled, theirs -> declined.
-- Blocking yourself, someone unknown, or someone already blocked does
-- nothing. Never says anything to the other person.
create function public.block_user(person uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if person is null or person = uid
     or not exists (select 1 from public.profiles p where p.id = person) then
    return;
  end if;

  perform public.lock_pair(uid, person);
  insert into public.user_blocks (blocker_id, blocked_id)
  values (uid, person)
  on conflict do nothing;

  -- Statuses the friendship rules allow the blocker to set
  -- (friendship_status_change checks them as this user)
  update public.friendships f
  set status = case when f.status = 'accepted' then 'removed'
                    when f.requester_id = uid then 'cancelled'
                    else 'declined' end
  where f.status in ('pending', 'accepted')
    and ((f.requester_id = uid and f.addressee_id = person)
      or (f.requester_id = person and f.addressee_id = uid));
end;
$$;

-- Lifts YOUR block only; theirs, if any, stays. The old friendship does
-- not come back.
create function public.unblock_user(person uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  perform public.lock_pair(uid, person);
  delete from public.user_blocks where blocker_id = uid and blocked_id = person;
end;
$$;

-- The people YOU blocked, for Profile > Blocked people (the profiles
-- table no longer shows them to you). Never who blocked you.
create function public.my_blocks()
returns table (user_id uuid, username text, display_name text, avatar jsonb,
               blocked_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  return query
    select p.id, p.username, p.display_name, p.avatar, b.created_at
    from public.user_blocks b
    join public.profiles p on p.id = b.blocked_id
    where b.blocker_id = auth.uid()
    order by b.created_at desc;
end;
$$;

-- =====================================================================
-- READ RULES: blocked pairs never read each other from the tables
-- =====================================================================
-- Your own row always (the app needs it to pick the screen); anyone else
-- only through can_see. Steps and last seen: yourself or a friend only.
-- "Shares a group" is gone: group screens read through the group
-- functions below.
alter policy "profiles read" on public.profiles
  using (id = auth.uid()
         or ((select public.is_active_account()) and public.can_see(id)));

alter policy "steps read" on public.daily_steps
  using ((select public.is_active_account())
         and (user_id = auth.uid()
              or (public.is_friend(user_id) and public.can_see(user_id))));

alter policy "last seen read" on public.last_seen
  using ((select public.is_active_account())
         and (user_id = auth.uid()
              or (public.is_friend(user_id) and public.can_see(user_id))));

-- No request to someone you can't see. The refusal is the same as for an
-- account that doesn't exist, so it reveals nothing.
alter policy "friendships request" on public.friendships
  with check (requester_id = auth.uid()
              and status = 'pending'
              and (select public.is_active_account())
              and public.can_see(addressee_id));

-- The same check again after taking the pair lock, reading the blocks
-- fresh (a trigger function gets a new snapshot for each statement), so
-- a block saved a moment earlier is seen. Whichever of the two gets the
-- lock second sees what the first did.
create function public.friend_request_block_check()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.lock_pair(new.requester_id, new.addressee_id);
  if exists (
    select 1 from public.user_blocks x
    where (x.blocker_id = new.requester_id and x.blocked_id = new.addressee_id)
       or (x.blocker_id = new.addressee_id and x.blocked_id = new.requester_id)
  ) then
    raise exception 'new row violates row-level security policy for table "friendships"'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger friendships_block_check
  before insert on public.friendships
  for each row execute function public.friend_request_block_check();

-- =====================================================================
-- PERIODS AND THE WINDOW
-- =====================================================================
-- Leaderboards take a period, never dates. my_today is the phone's local
-- date; it must be "today" somewhere on Earth at p_now (UTC-12 to UTC+14).
-- 'today' is that day; 'week' the 7 days ending on it. Every answer lies
-- in ONE window worked out from the clock alone: from the UTC-12 date
-- minus 6 days to the UTC+14 date (8 days, or 9 for about 2 hours a
-- day), so no combination of calls can reach further back (decision 19).
create function public.step_period_at(
  p_period text, p_my_today date, p_now timestamptz,
  out from_day date, out to_day date)
language plpgsql immutable set search_path = ''
as $$
declare
  earliest date := (p_now at time zone 'Etc/GMT+12')::date; -- POSIX names: this is UTC-12
  latest   date := (p_now at time zone 'Etc/GMT-14')::date; -- and this is UTC+14
begin
  if p_period is null or p_period not in ('today', 'week') then
    raise exception 'BAD_PERIOD';
  end if;
  if p_my_today is null or p_my_today < earliest or p_my_today > latest then
    raise exception 'BAD_DAY';
  end if;
  to_day   := p_my_today;
  from_day := case p_period when 'today' then p_my_today else p_my_today - 6 end;
  -- The window's start. Always true after the check above; kept so the
  -- limit doesn't depend on that reasoning.
  from_day := greatest(from_day, earliest - 6);
end;
$$;

-- With extra rights so step_period_at (which takes any clock) stays
-- internal; this one always uses the real clock.
create function public.step_period(
  p_period text, p_my_today date,
  out from_day date, out to_day date)
language sql stable security definer set search_path = ''
as $$ select * from public.step_period_at(p_period, p_my_today, now()) $$;

-- =====================================================================
-- LEADERBOARDS BY PERIOD
-- =====================================================================

-- Group screens and Today in group mode. Runs with extra rights so it can
-- show a group mate you've blocked (or who blocked you), under the
-- contract in section 2: caller signed in and active, a member of THIS
-- group; inactive people left out as everywhere; only name, character
-- and the period's total.
create function public.group_leaderboard(gid uuid, period text, my_today date)
returns table (user_id uuid, display_name text, avatar jsonb, total_steps bigint)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare d record;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.is_group_member(gid) then raise exception 'NOT_A_MEMBER'; end if;
  select * into d from public.step_period(period, my_today);

  return query
    select p.id, p.display_name, p.avatar, coalesce(sum(s.steps), 0)::bigint
    from public.group_members m
    join public.profiles p on p.id = m.user_id
    left join public.daily_steps s
      on s.user_id = m.user_id and s.day between d.from_day and d.to_day
    where m.group_id = gid and public.is_active_user(m.user_id)
    group by p.id, p.display_name, p.avatar
    order by 4 desc;
end;
$$;

-- Friends: you and your friends, read as the caller (the table rules
-- apply). The same periods, for consistency.
create function public.friends_leaderboard(period text, my_today date)
returns table (user_id uuid, display_name text, avatar jsonb, total_steps bigint)
language sql stable set search_path = ''
as $$
  with d as (select * from public.step_period(period, my_today))
  select p.id, p.display_name, p.avatar, coalesce(sum(s.steps), 0)::bigint
  from d, public.profiles p
  left join public.daily_steps s
    on s.user_id = p.id and s.day between (select from_day from d) and (select to_day from d)
  where (p.id = auth.uid() or public.is_friend(p.id))
    and (select public.is_active_account())
  group by p.id, p.display_name, p.avatar
  order by 4 desc
$$;

-- App builds from before this migration ask with dates. They only ever
-- asked for one day or seven days ending today, so those map onto the
-- periods; anything else is refused (BAD_PERIOD). Each checks the caller
-- is active itself too, like every function the app can call. Drop these
-- once no older build is in use.
create or replace function public.group_leaderboard(gid uuid, from_day date, to_day date)
returns table (user_id uuid, display_name text, avatar jsonb, total_steps bigint)
language sql stable set search_path = ''
as $$
  select * from public.group_leaderboard(
    gid,
    case when to_day = from_day then 'today' when to_day - from_day = 6 then 'week' end,
    to_day)
  where public.is_active_account()
$$;

create or replace function public.friends_leaderboard(from_day date, to_day date)
returns table (user_id uuid, display_name text, avatar jsonb, total_steps bigint)
language sql stable set search_path = ''
as $$
  select * from public.friends_leaderboard(
    case when to_day = from_day then 'today' when to_day - from_day = 6 then 'week' end,
    to_day)
  where public.is_active_account()
$$;

-- =====================================================================
-- THE PLAYER CARD OPENED FROM A GROUP
-- =====================================================================
-- Same contract, and the person must be a current member of this same
-- group (so it can't look up anyone by naming a group you're in).
-- blocked_by_me is the caller's own block only, for the note on the card;
-- the person who was blocked gets false, as for any member.
create function public.group_member_card(gid uuid, person uuid, my_today date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  d record;
  p public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.is_group_member(gid) then raise exception 'NOT_A_MEMBER'; end if;
  if not exists (select 1 from public.group_members m
                 where m.group_id = gid and m.user_id = person)
     or not public.is_active_user(person) then
    raise exception 'NOT_A_MEMBER';
  end if;
  select * into d from public.step_period('week', my_today);
  select * into p from public.profiles where id = person;

  return jsonb_build_object(
    'user_id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar', p.avatar,
    'map_theme', p.map_theme,
    'today_steps', (select coalesce(sum(s.steps), 0) from public.daily_steps s
                    where s.user_id = person and s.day = d.to_day),
    'week_steps', (select coalesce(sum(s.steps), 0) from public.daily_steps s
                   where s.user_id = person and s.day between d.from_day and d.to_day),
    'last_seen', (select l.seen_at from public.last_seen l where l.user_id = person),
    'blocked_by_me', exists (select 1 from public.user_blocks b
                             where b.blocker_id = auth.uid() and b.blocked_id = person));
end;
$$;

-- =====================================================================
-- COUNTS AND PUSHES: nothing because of a blocked person
-- =====================================================================
-- Blocking ends pending requests, so these filters are a second line.
-- Bodies as in 20261102000000_push_notifications.sql, plus the marked
-- lines.
create or replace function public.notification_counts_for(p_user uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with live as (
    select public.is_active_user(p_user)
       and exists (select 1 from public.profiles p
                   where p.id = p_user and p.sharing_consent_at is not null) as ok
  ),
  waiting as (
    select q.vote_deadline
    from public.quests q
    where (select ok from live)
      and q.status = 'voting'
      and q.vote_deadline > now()
      and exists (select 1 from public.group_members m
                  where m.group_id = q.group_id and m.user_id = p_user)
      and not exists (select 1 from public.quest_votes v
                      where v.quest_id = q.id and v.user_id = p_user)
  )
  select jsonb_build_object(
    'friend_requests', case when (select ok from live) then (
      select count(*) from public.friendships f
      where f.addressee_id = p_user and f.status = 'pending'
        and public.is_active_user(f.requester_id)
        -- not from someone blocked either way
        and not public.is_blocked_between(f.requester_id, p_user))
    else 0 end,
    'quest_votes', (select count(*) from waiting),
    'next_vote_deadline', (select min(vote_deadline) from waiting))
$$;

create or replace function public.push_friend_request(fid uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  f       public.friendships%rowtype;
  sender  text;
  total   integer;
  counts  jsonb;
  tokens  text[];
  req     bigint;
begin
  select * into f from public.friendships where id = fid;
  if not found or f.status <> 'pending' then return; end if;
  -- Never between a blocked pair
  if public.is_blocked_between(f.requester_id, f.addressee_id) then return; end if;

  -- Both still active, and the recipient could see the request (the same
  -- rules as their Requests section, which needs sharing turned on)
  counts := public.notification_counts_for(f.addressee_id);
  if not public.is_active_user(f.requester_id)
     or (counts->>'friend_requests')::int = 0 then
    return;
  end if;
  if not coalesce((select push_enabled from public.notification_settings
                   where user_id = f.addressee_id), true) then
    return;
  end if;

  select array_agg(token order by token) into tokens
  from public.push_devices where user_id = f.addressee_id;
  if tokens is null then return; end if;

  select username into sender from public.profiles where id = f.requester_id;
  total := (counts->>'friend_requests')::int + (counts->>'quest_votes')::int;

  select net.http_post(
    url     := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
    body    := (select jsonb_agg(jsonb_build_object(
                  'to', t,
                  'title', 'New friend request',
                  'body', '@' || sender || ' wants to be friends',
                  'sound', 'default',
                  'badge', total,
                  -- Tapping it opens the Friends tab
                  'data', jsonb_build_object('url', '/friends')) order by t)
                from unnest(tokens) t))
  into req;

  insert into public.push_sends (request_id, tokens) values (req, tokens);
end;
$$;

-- =====================================================================
-- PERMISSIONS
-- =====================================================================
-- Internal: nobody from the app
revoke all on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;
revoke all on function public.lock_pair(uuid, uuid) from public, anon, authenticated;
revoke all on function public.friend_request_block_check() from public, anon, authenticated;
revoke all on function public.step_period_at(text, date, timestamptz) from public, anon, authenticated;

-- The app: signed-in people only, never signed out
revoke all on function public.can_see(uuid) from public, anon;
revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
revoke all on function public.my_blocks() from public, anon;
revoke all on function public.step_period(text, date) from public, anon;
revoke all on function public.group_leaderboard(uuid, text, date) from public, anon;
revoke all on function public.group_leaderboard(uuid, date, date) from public, anon;
revoke all on function public.friends_leaderboard(text, date) from public, anon;
revoke all on function public.friends_leaderboard(date, date) from public, anon;
revoke all on function public.group_member_card(uuid, uuid, date) from public, anon;
grant execute on function public.can_see(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.my_blocks() to authenticated;
-- step_period runs as the caller inside friends_leaderboard; it is only
-- date arithmetic
grant execute on function public.step_period(text, date) to authenticated;
grant execute on function public.group_leaderboard(uuid, text, date) to authenticated;
grant execute on function public.group_leaderboard(uuid, date, date) to authenticated;
grant execute on function public.friends_leaderboard(text, date) to authenticated;
grant execute on function public.friends_leaderboard(date, date) to authenticated;
grant execute on function public.group_member_card(uuid, uuid, date) to authenticated;
