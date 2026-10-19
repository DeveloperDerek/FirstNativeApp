-- StepTracker: shop purchases on the activity board (step-tracker-
-- activity-board.txt, section 2). An item bought in the shop joins that
-- person's line for the day (still one line per person per day, ACT-2),
-- so kudos on it work as on any other line. The app draws the newest
-- item bought as the line's picture.
--
-- Still no new table. A purchase is the 'purchase' coin row (ref is the
-- item id), on the shop day it was paid (shop_day(): the shop's own time
-- zone, the same day the shop rotated on), while the item is still owned:
-- an item taken out of the game and refunded leaves the board with it.
-- Free starter items, starter pets and grandfathered items have no
-- 'purchase' row, so they never make a line. The price is never sent:
-- the wallet stays private (ACT-6).

-- =====================================================================
-- INTERNAL: the items a person bought on a day
-- =====================================================================
-- Ids, oldest first, or an empty array. Used by activity_line_exists and
-- new_kudos; friends_activity reads the same rows for a whole page.
create function public.bought_on(p_user uuid, p_day date)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(c.ref order by c.created_at, c.ref), '[]'::jsonb)
  from public.coin_transactions c
  where c.user_id = p_user and c.reason = 'purchase' and c.amount < 0
    and (c.created_at at time zone 'America/Los_Angeles')::date = p_day
    and exists (select 1 from public.user_items u
                where u.user_id = c.user_id and u.item_id = c.ref)
$$;

revoke all on function public.bought_on(uuid, date) from public, anon, authenticated;

-- =====================================================================
-- KUDOS: a purchase-only day is a line too
-- =====================================================================
-- As in 20261122000000_kudos.sql, plus the purchases.
create or replace function public.activity_line_exists(p_user uuid, p_day date)
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
      or public.bought_on(p_user, p_day) <> '[]'::jsonb
$$;

-- As in 20261122000000_kudos.sql, plus 'items' on each line so the app
-- can describe a purchase-only day.
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
                 'items', public.bought_on(me, l.day),
                 'givers', l.givers)
               order by l.latest desc, l.day desc), '[]'::jsonb),
      -- Full precision: the app sends it back as it came
      'up_to', max(l.latest))
    from lines l);
end;
$$;

-- =====================================================================
-- THE BOARD: 'items' on every line
-- =====================================================================
-- Body as in 20261122000000_kudos.sql, plus the bought CTE, joined into
-- lines like earned is. A purchase's paid time is part of the order, like
-- a coin row's or an achievement's. Paging is unchanged.
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
  -- The same rows as bought_on, for every person at once
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
           -- greatest() skips the parts a line doesn't have
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

-- create or replace keeps the existing grants on the three replaced
-- functions; restated so this file reads complete
revoke all on function public.activity_line_exists(uuid, date) from public, anon, authenticated;
revoke all on function public.new_kudos(date) from public, anon, authenticated;
revoke all on function public.friends_activity(date, date, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.new_kudos(date) to authenticated;
grant execute on function public.friends_activity(date, date, timestamptz, uuid) to authenticated;
