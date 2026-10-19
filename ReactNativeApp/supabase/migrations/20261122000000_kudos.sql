-- StepTracker: kudos on the activity board (step-tracker-kudos.txt). A
-- party popper on a friend's line: one per person per line (person, day), never
-- taken back, no coins, no pushes. The person finds out inside the app:
-- new_kudos in notification_counts (the tab dot) and the "New kudos" list,
-- which is the only thing that marks them seen (KUD-11).
--
-- A kudos is one row. The line itself is still worked out live by
-- friends_activity, so a kudos shows only while its line is on the board,
-- and only while its giver still counts (KUD-5): the line owner's friend,
-- active, sharing, neither blocking the other. Unfriend, block, pause or
-- sharing off hide it; undoing that brings it back (KUD-12).
--
-- Dates: the activity board's window, unchanged (KUD-13). my_today is the
-- caller's phone date, checked with is_today_somewhere; today is day 0,
-- the oldest day my_today - 29, the newest my_today + 1.

create table public.kudos (
  giver_id   uuid not null references public.profiles(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day        date not null,
  created_at timestamptz not null default now(),
  primary key (giver_id, user_id, day),
  check (giver_id <> user_id)
);

create index kudos_line_idx on public.kudos (user_id, day);
create index kudos_new_idx on public.kudos (user_id, created_at);

-- No access from the app at all, not even your own rows: everything goes
-- through the functions below
alter table public.kudos enable row level security;
revoke all on public.kudos from anon, authenticated;

-- "New" is everything after this, per account, so two phones agree.
-- Missing (or no settings row) = never seen.
alter table public.notification_settings add column kudos_seen_at timestamptz;

-- =====================================================================
-- INTERNAL CHECKS
-- =====================================================================

-- Does this kudos still count on the owner's line (KUD-5)? The giver is
-- the owner's friend, active, sharing, and neither has blocked the other.
-- Two people, not the caller: a friend's line is counted the same for
-- everyone who sees it.
create function public.kudos_counts(giver uuid, owner uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_active_user(giver)
     and exists (select 1 from public.profiles p
                 where p.id = giver and p.sharing_consent_at is not null)
     and not public.is_blocked_between(giver, owner)
     and exists (select 1 from public.friendships f
                 where f.status = 'accepted'
                   and ((f.requester_id = giver and f.addressee_id = owner)
                     or (f.requester_id = owner and f.addressee_id = giver)))
$$;

-- Is (person, day) a line on the board? The same rules as
-- friends_activity: the day's 'daily_goal' coin row while the uploaded
-- day still exists and from GOAL-16's switch day on, or an achievement
-- earned that day.
create function public.activity_line_exists(p_user uuid, p_day date)
returns boolean language sql stable security definer set search_path = ''
as $$
  with switch as (
    select date '2000-01-01' + (select s.value from public.app_settings s
                                where s.key = 'goal_is_coin_target_from') as day
  )
  select exists (
           select 1 from public.coin_transactions c
           where c.user_id = p_user and c.reason = 'daily_goal'
             and c.ref = to_char(p_day, 'YYYY-MM-DD')
             and ((select day from switch) is null or p_day >= (select day from switch))
             and exists (select 1 from public.daily_steps s
                         where s.user_id = p_user and s.day = p_day))
      or exists (
           select 1 from public.user_achievements a
           where a.user_id = p_user and a.earned_on = p_day)
$$;

-- The owner's kudos that are new: inside the window for my_today, after
-- their kudos_seen_at, from givers who count, on lines that exist. The
-- tab dot (notification_counts) and the "New kudos" list (new_kudos) both
-- read this, so the dot can never show with nothing in the list.
create function public.new_kudos_rows(p_user uuid, my_today date)
returns table (giver_id uuid, day date, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select k.giver_id, k.day, k.created_at
  from public.kudos k
  where k.user_id = p_user
    and k.day between my_today - 29 and my_today + 1
    and k.created_at > coalesce((select n.kudos_seen_at from public.notification_settings n
                                 where n.user_id = p_user), '-infinity')
    and public.kudos_counts(k.giver_id, p_user)
    and public.activity_line_exists(p_user, k.day)
$$;

revoke all on function public.kudos_counts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.activity_line_exists(uuid, date) from public, anon, authenticated;
revoke all on function public.new_kudos_rows(uuid, date) from public, anon, authenticated;

-- =====================================================================
-- GIVING
-- =====================================================================

-- Kudos on (p_user, p_day): a friend's line on your board. A double tap
-- or two phones give one kudos. Returns the line's count.
create function public.give_kudos(p_user uuid, p_day date, my_today date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.has_sharing_consent() then raise exception 'SHARING_REQUIRED'; end if;
  if not public.is_today_somewhere(my_today, now())
     or p_day is null or p_day not between my_today - 29 and my_today + 1 then
    raise exception 'BAD_DAY';
  end if;
  if p_user = me then raise exception 'SELF'; end if;
  -- Exactly the people friends_activity shows you: a friend you can see
  -- who shares their steps
  if p_user is null
     or not public.can_see(p_user)
     or not exists (select 1 from public.profiles p
                    where p.id = p_user and p.sharing_consent_at is not null)
     or not exists (select 1 from public.friendships f
                    where f.status = 'accepted'
                      and ((f.requester_id = me and f.addressee_id = p_user)
                        or (f.requester_id = p_user and f.addressee_id = me))) then
    raise exception 'CANT_SEE';
  end if;
  if not public.activity_line_exists(p_user, p_day) then raise exception 'NO_SUCH_LINE'; end if;

  insert into public.kudos (giver_id, user_id, day) values (me, p_user, p_day)
  on conflict do nothing;

  return (select count(*) from public.kudos k
          where k.user_id = p_user and k.day = p_day
            and public.kudos_counts(k.giver_id, p_user));
end;
$$;

-- =====================================================================
-- READING YOUR KUDOS
-- =====================================================================

-- Who gave kudos on YOUR line for that day, newest first (KUD-4: only
-- your own lines have a list).
create function public.line_kudos(p_day date, my_today date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.has_sharing_consent() then raise exception 'SHARING_REQUIRED'; end if;
  if not public.is_today_somewhere(my_today, now())
     or p_day is null or p_day not between my_today - 29 and my_today + 1 then
    raise exception 'BAD_DAY';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', p.id,
             'display_name', p.display_name,
             'avatar', p.avatar,
             'created_at', k.created_at)
           order by k.created_at desc, k.giver_id), '[]'::jsonb)
    from public.kudos k
    join public.profiles p on p.id = k.giver_id
    where k.user_id = me and k.day = p_day
      and public.kudos_counts(k.giver_id, me)
      and public.activity_line_exists(me, p_day));
end;
$$;

-- The "New kudos" list: every new kudos on your lines, one entry per
-- line (at most 31: one line a day), newest kudos first, with the line's
-- goal and achievements so the app can describe it, and up_to: the
-- newest created_at in the answer, for mark_kudos_seen. Reading changes
-- nothing; only mark_kudos_seen does.
create function public.new_kudos(my_today date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.has_sharing_consent() then raise exception 'SHARING_REQUIRED'; end if;
  if not public.is_today_somewhere(my_today, now()) then raise exception 'BAD_DAY'; end if;

  return (
    with fresh as (
      select r.giver_id, r.day, r.created_at, p.display_name, p.avatar
      from public.new_kudos_rows(me, my_today) r
      join public.profiles p on p.id = r.giver_id
    ),
    switch as (
      select date '2000-01-01' + (select s.value from public.app_settings s
                                  where s.key = 'goal_is_coin_target_from') as day
    ),
    lines as (
      select f.day,
             max(f.created_at) as latest,
             jsonb_agg(jsonb_build_object(
               'user_id', f.giver_id,
               'display_name', f.display_name,
               'avatar', f.avatar,
               'created_at', f.created_at)
             order by f.created_at desc, f.giver_id) as givers
      from fresh f
      group by f.day
    )
    select jsonb_build_object(
      'lines', coalesce(jsonb_agg(jsonb_build_object(
                 'day', l.day,
                 'goal', exists (
                   select 1 from public.coin_transactions c
                   where c.user_id = me and c.reason = 'daily_goal'
                     and c.ref = to_char(l.day, 'YYYY-MM-DD')
                     and ((select day from switch) is null or l.day >= (select day from switch))
                     and exists (select 1 from public.daily_steps s
                                 where s.user_id = me and s.day = l.day)),
                 'achievements', coalesce((
                   select jsonb_agg(a.achievement_id order by a.earned_at, a.achievement_id)
                   from public.user_achievements a
                   where a.user_id = me and a.earned_on = l.day), '[]'::jsonb),
                 'givers', l.givers)
               order by l.latest desc, l.day desc), '[]'::jsonb),
      -- Full precision: the app sends it back as it came
      'up_to', max(l.latest))
    from lines l);
end;
$$;

-- Records that the "New kudos" list was shown, up to the newest kudos it
-- held: kudos_seen_at moves to p_up_to, never back (a slow call from a
-- second phone) and never past now(). The same p_up_to twice changes
-- nothing, so the app can retry safely.
create function public.mark_kudos_seen(p_up_to timestamptz)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if p_up_to is null then return; end if;
  insert into public.notification_settings (user_id, kudos_seen_at)
  values (me, least(p_up_to, now()))
  on conflict (user_id) do update
    set kudos_seen_at = greatest(coalesce(public.notification_settings.kudos_seen_at, '-infinity'),
                                 excluded.kudos_seen_at);
end;
$$;

-- =====================================================================
-- THE TAB COUNTS: new_kudos
-- =====================================================================
-- Needs the phone's date for the window, so notification_counts takes
-- it now. Without it (an app from before kudos) the answer is exactly
-- as before, with no new_kudos. new_kudos is 0 for an account that isn't
-- active or isn't sharing, like friend_requests, and for a date that
-- isn't today anywhere (the counts never fail over it). The pushes keep
-- reading notification_counts_for, so the app icon number is unchanged.
drop function public.notification_counts();

create function public.notification_counts(my_today date default null)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when public.is_active_account()
    then public.notification_counts_for(auth.uid())
         || case when my_today is null then '{}'::jsonb
            else jsonb_build_object('new_kudos',
                   case when public.has_sharing_consent()
                             and public.is_today_somewhere(my_today, now())
                        then (select count(*) from public.new_kudos_rows(auth.uid(), my_today))
                        else 0 end) end
    else jsonb_build_object('friend_requests', 0, 'quest_votes', 0, 'next_vote_deadline', null)
         || case when my_today is null then '{}'::jsonb
            else jsonb_build_object('new_kudos', 0) end
  end
$$;

-- =====================================================================
-- THE BOARD: kudos, my_kudos and new_kudos on every line
-- =====================================================================
-- Body as in 20261121000000_activity_board.sql, plus the kudos fields in
-- the final select. Order and paging are unchanged.
create or replace function public.friends_activity(
  my_today date,
  before_day date default null,
  before_at timestamptz default null,
  before_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  -- 30 days back, and a day ahead: a friend in a time zone ahead of
  -- yours can already be on your tomorrow
  first_day date := my_today - 29;
  last_day date := my_today + 1;
  -- A coin row meant the goal only from GOAL-16's switch day on
  switch_day date := date '2000-01-01' + (select s.value from public.app_settings s
                                          where s.key = 'goal_is_coin_target_from');
  seen_at timestamptz := coalesce((select n.kudos_seen_at from public.notification_settings n
                                   where n.user_id = auth.uid()), '-infinity');
  result jsonb;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.has_sharing_consent() then raise exception 'SHARING_REQUIRED'; end if;
  if not public.is_today_somewhere(my_today, now()) then raise exception 'BAD_DAY'; end if;
  if (before_day is null) <> (before_at is null) or (before_day is null) <> (before_id is null) then
    raise exception 'BAD_CURSOR';
  end if;

  with people as (
    select p.id, p.display_name, p.avatar
    from public.profiles p
    where p.sharing_consent_at is not null
      and (p.id = me
           or (p.id in (select case when f.requester_id = me then f.addressee_id
                                    else f.requester_id end
                        from public.friendships f
                        where f.status = 'accepted'
                          and (f.requester_id = me or f.addressee_id = me))
               and public.can_see(p.id)))
  ),
  goals as (
    -- ref is compared as text ('YYYY-MM-DD' sorts like the dates) and
    -- only cast behind the reason check, since other reasons' refs are
    -- item ids
    select c.user_id, c.ref::date as day, c.amount, c.created_at as at
    from public.coin_transactions c
    join people on people.id = c.user_id
    where c.reason = 'daily_goal'
      and c.ref between to_char(first_day, 'YYYY-MM-DD') and to_char(last_day, 'YYYY-MM-DD')
      and (switch_day is null or c.ref >= to_char(switch_day, 'YYYY-MM-DD'))
      and exists (select 1 from public.daily_steps s
                  where s.user_id = c.user_id
                    and s.day = case when c.reason = 'daily_goal' then c.ref::date end)
  ),
  earned as (
    select a.user_id, a.earned_on as day,
           jsonb_agg(a.achievement_id order by a.earned_at, a.achievement_id) as ids,
           max(a.earned_at) as at
    from public.user_achievements a
    join people on people.id = a.user_id
    where a.earned_on between first_day and last_day
    group by a.user_id, a.earned_on
  ),
  lines as (
    select coalesce(g.user_id, e.user_id) as user_id,
           coalesce(g.day, e.day) as day,
           g.user_id is not null as goal,
           case when coalesce(g.user_id, e.user_id) = me then g.amount end as coins,
           coalesce(e.ids, '[]'::jsonb) as achievements,
           greatest(g.at, e.at) as at
    from goals g
    full join earned e on e.user_id = g.user_id and e.day = g.day
  ),
  page as (
    select l.*, people.display_name, people.avatar
    from lines l
    join people on people.id = l.user_id
    where before_day is null
       or (l.day, l.at, l.user_id) < (before_day, before_at, before_id)
    order by l.day desc, l.at desc, l.user_id desc
    limit 20
  ),
  -- The kudos on each line of the page, from givers who still count
  claps as (
    select page.user_id, page.day,
           count(k.giver_id) filter (where public.kudos_counts(k.giver_id, page.user_id)) as kudos,
           bool_or(k.giver_id = me) as mine,
           count(k.giver_id) filter (where page.user_id = me and k.created_at > seen_at
                                       and public.kudos_counts(k.giver_id, me)) as fresh
    from page
    left join public.kudos k on k.user_id = page.user_id and k.day = page.day
    group by page.user_id, page.day
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', page.day,
           'at', page.at,
           'user_id', page.user_id,
           'display_name', page.display_name,
           'avatar', page.avatar,
           'goal', page.goal,
           'coins', page.coins,
           'achievements', page.achievements,
           'kudos', claps.kudos,
           'my_kudos', coalesce(claps.mine, false),
           'new_kudos', case when page.user_id = me then claps.fresh end)
         order by page.day desc, page.at desc, page.user_id desc), '[]'::jsonb)
  into result
  from page
  join claps on claps.user_id = page.user_id and claps.day = page.day;
  return result;
end;
$$;

-- =====================================================================
-- CLEANUP (KUD-10)
-- =====================================================================
-- Lines older than 30 days aren't on the board; kudos are kept 35 days
-- (by the line's day) and then deleted.
select cron.schedule('delete-old-kudos', '45 3 * * *',
  $$ delete from public.kudos where day < current_date - 35 $$);

-- =====================================================================
-- PERMISSIONS
-- =====================================================================
revoke all on function public.give_kudos(uuid, date, date) from public, anon, authenticated;
revoke all on function public.line_kudos(date, date) from public, anon, authenticated;
revoke all on function public.new_kudos(date) from public, anon, authenticated;
revoke all on function public.mark_kudos_seen(timestamptz) from public, anon, authenticated;
revoke all on function public.notification_counts(date) from public, anon, authenticated;
revoke all on function public.friends_activity(date, date, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.give_kudos(uuid, date, date) to authenticated;
grant execute on function public.line_kudos(date, date) to authenticated;
grant execute on function public.new_kudos(date) to authenticated;
grant execute on function public.mark_kudos_seen(timestamptz) to authenticated;
grant execute on function public.notification_counts(date) to authenticated;
grant execute on function public.friends_activity(date, date, timestamptz, uuid) to authenticated;
