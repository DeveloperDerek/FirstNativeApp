-- StepTracker: longer History, server side
-- (step-tracker-history-reminders.txt, part A, "In the database").
--
-- Only your own history: the person always comes from the sign-in, never
-- from an argument. Steps only when you share them; the goals for every
-- day either way, so non-sharers' Health steps can be judged by the goal
-- each day had.
--
-- A day with data is an uploaded day, 0 included (the phone uploads every
-- one of the last 7 days, zeros too). A day never uploaded is missing:
-- null steps here, and left out of the monthly sums (decision 10).

-- Every day from from_day to to_day, with the goal that applied that day
-- and its uploaded steps (null when not uploaded, or not sharing). At most
-- 366 days per call; to_day no later than the phone's today.
create function public.my_history(from_day date, to_day date, my_today date)
returns table (day date, goal integer, steps integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sharing boolean;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.is_today_somewhere(my_today, now()) then raise exception 'BAD_DAY'; end if;
  if from_day is null or to_day is null or from_day > to_day or to_day > my_today
     or to_day - from_day + 1 > 366 then
    raise exception 'BAD_RANGE';
  end if;
  sharing := public.has_sharing_consent();

  return query
    select d::date, public.goal_on(uid, d::date),
           case when sharing then s.steps end
    from generate_series(from_day, to_day, '1 day') d
    left join public.daily_steps s on s.user_id = uid and s.day = d::date
    order by d;
end;
$$;

-- The Year view for sharers: one row per month of the year that has any
-- uploaded days (up to the phone's today), with the days with data, their
-- total, the days at goal (each day by its own goal), and the month's best
-- day (the earliest, if two tie). The monthly average is total_steps /
-- days_with_data, the same rule as the Month view. Not sharing: no rows
-- (the phone reads Health, with goals from my_history).
create function public.my_history_by_month(p_year integer, my_today date)
returns table (month date, days_with_data integer, total_steps bigint, days_at_goal integer,
               best_day date, best_steps integer)
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.is_today_somewhere(my_today, now()) then raise exception 'BAD_DAY'; end if;
  if p_year is null or p_year < 2000 or p_year > extract(year from my_today) then
    raise exception 'BAD_RANGE';
  end if;
  if not public.has_sharing_consent() then return; end if;

  return query
    select date_trunc('month', s.day)::date,
           count(*)::integer,
           sum(s.steps)::bigint,
           count(*) filter (where s.steps >= public.goal_on(uid, s.day))::integer,
           (array_agg(s.day order by s.steps desc, s.day))[1],
           max(s.steps)
    from public.daily_steps s
    where s.user_id = uid
      and s.day between make_date(p_year, 1, 1) and least(make_date(p_year, 12, 31), my_today)
    group by 1
    order by 1;
end;
$$;

revoke all on function public.my_history(date, date, date) from public, anon;
revoke all on function public.my_history_by_month(integer, date) from public, anon;
grant execute on function public.my_history(date, date, date) to authenticated;
grant execute on function public.my_history_by_month(integer, date) to authenticated;
