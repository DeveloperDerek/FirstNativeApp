-- StepTracker: the activity board in Friends (step-tracker-activity-
-- board.txt). One line per person per day: the goal reached (the day's
-- 'daily_goal' coin row, while the uploaded day still exists) and the
-- achievements earned that day. Yours and your friends', newest first,
-- 30 days back.
--
-- No new table. The lines are read from coin_transactions, daily_steps
-- and user_achievements at the moment they're asked for, under the same
-- rules as player_achievements (yourself, or a friend you can see) plus
-- step sharing. So nothing can be counted twice, and an unfriend, a
-- block, a pause or sharing turned off takes effect on the next load.
-- Coins and achievements keep their own rules: paid coins and earned
-- achievements are never taken back, so their lines stay too.

-- before_day, before_at, before_id: the last line of the page already
-- shown (all three, or none for the first page). Lines are ordered by
-- day, then the time the line's latest part arrived, then the person,
-- all newest first; the next page is everything after that position, so
-- nothing is skipped or repeated when new lines arrive between pages.
create function public.friends_activity(
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
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', page.day,
           'at', page.at,
           'user_id', page.user_id,
           'display_name', page.display_name,
           'avatar', page.avatar,
           'goal', page.goal,
           'coins', page.coins,
           'achievements', page.achievements)
         order by page.day desc, page.at desc, page.user_id desc), '[]'::jsonb)
  into result
  from page;
  return result;
end;
$$;

revoke all on function public.friends_activity(date, date, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.friends_activity(date, date, timestamptz, uuid) to authenticated;
