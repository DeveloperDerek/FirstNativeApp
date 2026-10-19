-- StepTracker: one activity board line per thing done (ACT-2 changed,
-- October 2026; step-tracker-activity-board.txt). Instead of one line
-- per person per day with everything on it, each part is its own line:
--   goal         the day's goal reached (ref '')
--   achievement  one per achievement earned (ref: the achievement id)
--   purchase     one per item bought (ref: the item id)
-- A line is (person, day, kind, ref), and kudos are on a line, so each
-- part has its own kudos.
--
-- The rules for what makes a part are unchanged (activity_board,
-- activity_purchases). The new app reads activity_feed and gives kudos
-- with the line's kind and ref. Older builds keep working: friends_activity
-- still answers one line per day, give_kudos and line_kudos without a kind
-- use the day's first line (the goal, else its first achievement, else
-- its first purchase), and new_kudos keeps the fields they read.

-- =====================================================================
-- THE PARTS
-- =====================================================================
-- Every part of these people's lines from p_from to p_to. No visibility
-- checks: the callers decide who is asked about.
create function public.activity_parts(p_users uuid[], p_from date, p_to date)
returns table (user_id uuid, day date, kind text, ref text, at timestamptz, amount integer)
language sql stable security definer set search_path = ''
as $$
  with switch as (
    select date '2000-01-01' + (select s.value from public.app_settings s
                                where s.key = 'goal_is_coin_target_from') as day
  )
  -- ref is compared as text and only cast behind the reason check, since
  -- other reasons' refs are item ids
  select c.user_id, c.ref::date, 'goal', '', c.created_at, c.amount
  from public.coin_transactions c
  where c.user_id = any(p_users) and c.reason = 'daily_goal'
    and c.ref between to_char(p_from, 'YYYY-MM-DD') and to_char(p_to, 'YYYY-MM-DD')
    and ((select day from switch) is null or c.ref >= to_char((select day from switch), 'YYYY-MM-DD'))
    and exists (select 1 from public.daily_steps s
                where s.user_id = c.user_id
                  and s.day = case when c.reason = 'daily_goal' then c.ref::date end)
  union all
  select a.user_id, a.earned_on, 'achievement', a.achievement_id, a.earned_at, null
  from public.user_achievements a
  where a.user_id = any(p_users) and a.earned_on between p_from and p_to
  union all
  -- On the shop day it was paid, while the item is still owned
  select c.user_id, (c.created_at at time zone 'America/Los_Angeles')::date, 'purchase', c.ref,
         c.created_at, null
  from public.coin_transactions c
  where c.user_id = any(p_users) and c.reason = 'purchase' and c.amount < 0
    and (c.created_at at time zone 'America/Los_Angeles')::date between p_from and p_to
    and exists (select 1 from public.user_items u
                where u.user_id = c.user_id and u.item_id = c.ref)
$$;

-- Is (person, day, kind, ref) a line on the board?
create function public.activity_line_exists(p_user uuid, p_day date, p_kind text, p_ref text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.activity_parts(array[p_user], p_day, p_day) p
                 where p.kind = p_kind and p.ref = p_ref)
$$;

-- The day's first line, for older builds that only know the day: the
-- goal, else the first achievement, else the first purchase
create function public.first_line_of_day(p_user uuid, p_day date)
returns table (kind text, ref text)
language sql stable security definer set search_path = ''
as $$
  select p.kind, p.ref
  from public.activity_parts(array[p_user], p_day, p_day) p
  order by array_position(array['goal', 'achievement', 'purchase'], p.kind), p.at, p.ref
  limit 1
$$;

revoke all on function public.activity_parts(uuid[], date, date) from public, anon, authenticated;
revoke all on function public.activity_line_exists(uuid, date, text, text) from public, anon, authenticated;
revoke all on function public.first_line_of_day(uuid, date) from public, anon, authenticated;

-- =====================================================================
-- KUDOS ON A LINE
-- =====================================================================
-- Kudos given so far were on a whole day: they move to that day's first
-- line. One whose day has no line any more was hidden already, and
-- stays hidden on the goal line that isn't there.
alter table public.kudos add column kind text, add column ref text;
update public.kudos k
set (kind, ref) = (select f.kind, f.ref from public.first_line_of_day(k.user_id, k.day) f);
update public.kudos set kind = 'goal', ref = '' where kind is null;
alter table public.kudos
  alter column kind set not null,
  alter column ref set not null,
  add constraint kudos_kind_check check (kind in ('goal', 'achievement', 'purchase')),
  add constraint kudos_goal_ref_check check ((kind = 'goal') = (ref = '')),
  drop constraint kudos_pkey,
  add primary key (giver_id, user_id, day, kind, ref);
drop index public.kudos_line_idx;
create index kudos_line_idx on public.kudos (user_id, day, kind, ref);

-- The owner's new kudos, now with their line (same rules as before)
drop function public.new_kudos_rows(uuid, date);
create function public.new_kudos_rows(p_user uuid, my_today date)
returns table (giver_id uuid, day date, kind text, ref text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select k.giver_id, k.day, k.kind, k.ref, k.created_at
  from public.kudos k
  where k.user_id = p_user
    and k.day between my_today - 29 and my_today + 1
    and k.created_at > coalesce((select n.kudos_seen_at from public.notification_settings n
                                 where n.user_id = p_user), '-infinity')
    and public.kudos_counts(k.giver_id, p_user)
    and public.activity_line_exists(p_user, k.day, k.kind, k.ref)
$$;
revoke all on function public.new_kudos_rows(uuid, date) from public, anon, authenticated;

-- Kudos on (p_user, p_day, p_kind, p_ref): a friend's line on your
-- board. A double tap or two phones give one kudos. Returns the line's
-- count.
create function public.give_kudos(p_user uuid, p_day date, p_kind text, p_ref text, my_today date)
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
  -- Exactly the people activity_feed shows you: a friend you can see who
  -- shares their steps
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
  if p_kind is null or p_ref is null
     or not public.activity_line_exists(p_user, p_day, p_kind, p_ref) then
    raise exception 'NO_SUCH_LINE';
  end if;

  insert into public.kudos (giver_id, user_id, day, kind, ref) values (me, p_user, p_day, p_kind, p_ref)
  on conflict do nothing;

  return (select count(*) from public.kudos k
          where k.user_id = p_user and k.day = p_day and k.kind = p_kind and k.ref = p_ref
            and public.kudos_counts(k.giver_id, p_user));
end;
$$;

-- Older builds: kudos on the day's first line. Returns that line's count.
create or replace function public.give_kudos(p_user uuid, p_day date, my_today date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  first_kind text;
  first_ref text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  select f.kind, f.ref into first_kind, first_ref from public.first_line_of_day(p_user, p_day) f;
  -- The checks (and NO_SUCH_LINE for a day without a line) are the new one's
  return public.give_kudos(p_user, p_day, first_kind, first_ref, my_today);
end;
$$;

-- Who gave kudos on YOUR line, newest first (KUD-4: only your own lines
-- have a list)
create function public.line_kudos(p_day date, p_kind text, p_ref text, my_today date)
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
    where k.user_id = me and k.day = p_day and k.kind = p_kind and k.ref = p_ref
      and public.kudos_counts(k.giver_id, me)
      and public.activity_line_exists(me, p_day, p_kind, p_ref));
end;
$$;

-- Older builds: everyone who gave kudos on any of that day's lines, each
-- once, at their newest
create or replace function public.line_kudos(p_day date, my_today date)
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
             'user_id', g.id,
             'display_name', g.display_name,
             'avatar', g.avatar,
             'created_at', g.created_at)
           order by g.created_at desc, g.id), '[]'::jsonb)
    from (
      select p.id, p.display_name, p.avatar, max(k.created_at) as created_at
      from public.kudos k
      join public.profiles p on p.id = k.giver_id
      where k.user_id = me and k.day = p_day
        and public.kudos_counts(k.giver_id, me)
        and public.activity_line_exists(me, p_day, k.kind, k.ref)
      group by p.id, p.display_name, p.avatar
    ) g);
end;
$$;

-- The "New kudos" list: one entry per line with new kudos, newest kudos
-- first. Each entry keeps the fields older builds read (goal,
-- achievements, items: here just that line's one part) plus kind and
-- ref. up_to and marking seen are unchanged.
create or replace function public.new_kudos(my_today date)
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
    with lines as (
      select r.day, r.kind, r.ref,
             max(r.created_at) as latest,
             jsonb_agg(jsonb_build_object(
               'user_id', r.giver_id,
               'display_name', p.display_name,
               'avatar', p.avatar,
               'created_at', r.created_at)
             order by r.created_at desc, r.giver_id) as givers
      from public.new_kudos_rows(me, my_today) r
      join public.profiles p on p.id = r.giver_id
      group by r.day, r.kind, r.ref
    )
    select jsonb_build_object(
      'lines', coalesce(jsonb_agg(jsonb_build_object(
                 'day', l.day,
                 'kind', l.kind,
                 'ref', l.ref,
                 'goal', l.kind = 'goal',
                 'achievements', case when l.kind = 'achievement' then jsonb_build_array(l.ref)
                                      else '[]'::jsonb end,
                 'items', case when l.kind = 'purchase' then jsonb_build_array(l.ref)
                               else '[]'::jsonb end,
                 'givers', l.givers)
               order by l.latest desc, l.day desc, l.kind, l.ref), '[]'::jsonb),
      -- Full precision: the app sends it back as it came
      'up_to', max(l.latest))
    from lines l);
end;
$$;

-- =====================================================================
-- THE BOARD: activity_feed
-- =====================================================================
-- Yours and your friends' lines (the same people as friends_activity),
-- 20 a page, newest first. Ordered by day, the time the part happened,
-- the person, then kind and ref (two achievements can share a time); the
-- next page is everything after the last line shown, given as all five
-- (or none for the first page). Each line: day, at, user_id,
-- display_name, avatar, kind, ref, coins (your goal lines only), and for
-- the words and picture goal, achievements and items (that one part),
-- then its kudos.
create function public.activity_feed(
  my_today date,
  before_day date default null,
  before_at timestamptz default null,
  before_id uuid default null,
  before_kind text default null,
  before_ref text default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  seen_at timestamptz := coalesce((select n.kudos_seen_at from public.notification_settings n
                                   where n.user_id = auth.uid()), '-infinity');
  result jsonb;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.has_sharing_consent() then raise exception 'SHARING_REQUIRED'; end if;
  if not public.is_today_somewhere(my_today, now()) then raise exception 'BAD_DAY'; end if;
  if (before_day is null) <> (before_at is null) or (before_day is null) <> (before_id is null)
     or (before_day is null) <> (before_kind is null) or (before_day is null) <> (before_ref is null) then
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
  page as (
    select l.*, people.display_name, people.avatar
    from public.activity_parts((select array_agg(id) from people), my_today - 29, my_today + 1) l
    join people on people.id = l.user_id
    where before_day is null
       or (l.day, l.at, l.user_id, l.kind, l.ref) < (before_day, before_at, before_id, before_kind, before_ref)
    order by l.day desc, l.at desc, l.user_id desc, l.kind desc, l.ref desc
    limit 20
  ),
  claps as (
    select page.user_id, page.day, page.kind, page.ref,
           count(k.giver_id) filter (where public.kudos_counts(k.giver_id, page.user_id)) as kudos,
           bool_or(k.giver_id = me) as mine,
           count(k.giver_id) filter (where page.user_id = me and k.created_at > seen_at
                                       and public.kudos_counts(k.giver_id, me)) as fresh
    from page
    left join public.kudos k on k.user_id = page.user_id and k.day = page.day
                            and k.kind = page.kind and k.ref = page.ref
    group by page.user_id, page.day, page.kind, page.ref
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', page.day,
           'at', page.at,
           'user_id', page.user_id,
           'display_name', page.display_name,
           'avatar', page.avatar,
           'kind', page.kind,
           'ref', page.ref,
           'goal', page.kind = 'goal',
           'coins', case when page.user_id = me then page.amount end,
           'achievements', case when page.kind = 'achievement' then jsonb_build_array(page.ref)
                                else '[]'::jsonb end,
           'items', case when page.kind = 'purchase' then jsonb_build_array(page.ref)
                         else '[]'::jsonb end,
           'kudos', claps.kudos,
           'my_kudos', coalesce(claps.mine, false),
           'new_kudos', case when page.user_id = me then claps.fresh end)
         order by page.day desc, page.at desc, page.user_id desc, page.kind desc, page.ref desc),
         '[]'::jsonb)
  into result
  from page
  join claps on claps.user_id = page.user_id and claps.day = page.day
            and claps.kind = page.kind and claps.ref = page.ref;
  return result;
end;
$$;

-- =====================================================================
-- OLDER BUILDS: friends_activity, one line per day
-- =====================================================================
-- Body as in 20261123000000_activity_purchases.sql; only the kudos
-- change: a giver counts once per day, however many of its lines they
-- gave kudos on.
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
  first_day date := my_today - 29;
  last_day date := my_today + 1;
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
  bought as (
    select c.user_id, (c.created_at at time zone 'America/Los_Angeles')::date as day,
           jsonb_agg(c.ref order by c.created_at, c.ref) as ids,
           max(c.created_at) as at
    from public.coin_transactions c
    join people on people.id = c.user_id
    where c.reason = 'purchase' and c.amount < 0
      and (c.created_at at time zone 'America/Los_Angeles')::date between first_day and last_day
      and exists (select 1 from public.user_items u
                  where u.user_id = c.user_id and u.item_id = c.ref)
    group by 1, 2
  ),
  lines as (
    select coalesce(g.user_id, e.user_id, b.user_id) as user_id,
           coalesce(g.day, e.day, b.day) as day,
           g.user_id is not null as goal,
           case when coalesce(g.user_id, e.user_id, b.user_id) = me then g.amount end as coins,
           coalesce(e.ids, '[]'::jsonb) as achievements,
           coalesce(b.ids, '[]'::jsonb) as items,
           greatest(g.at, e.at, b.at) as at
    from goals g
    full join earned e on e.user_id = g.user_id and e.day = g.day
    full join bought b on b.user_id = coalesce(g.user_id, e.user_id)
                      and b.day = coalesce(g.day, e.day)
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
  claps as (
    select page.user_id, page.day,
           count(distinct k.giver_id) filter (where public.kudos_counts(k.giver_id, page.user_id)) as kudos,
           bool_or(k.giver_id = me) as mine,
           count(distinct k.giver_id) filter (where page.user_id = me and k.created_at > seen_at
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
           'items', page.items,
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
-- PERMISSIONS
-- =====================================================================
revoke all on function public.activity_feed(date, date, timestamptz, uuid, text, text) from public, anon, authenticated;
revoke all on function public.give_kudos(uuid, date, text, text, date) from public, anon, authenticated;
revoke all on function public.give_kudos(uuid, date, date) from public, anon, authenticated;
revoke all on function public.line_kudos(date, text, text, date) from public, anon, authenticated;
revoke all on function public.line_kudos(date, date) from public, anon, authenticated;
revoke all on function public.new_kudos(date) from public, anon, authenticated;
revoke all on function public.friends_activity(date, date, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.activity_feed(date, date, timestamptz, uuid, text, text) to authenticated;
grant execute on function public.give_kudos(uuid, date, text, text, date) to authenticated;
grant execute on function public.give_kudos(uuid, date, date) to authenticated;
grant execute on function public.line_kudos(date, text, text, date) to authenticated;
grant execute on function public.line_kudos(date, date) to authenticated;
grant execute on function public.new_kudos(date) to authenticated;
grant execute on function public.friends_activity(date, date, timestamptz, uuid) to authenticated;
