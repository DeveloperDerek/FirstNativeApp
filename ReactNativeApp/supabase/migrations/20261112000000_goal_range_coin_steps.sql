-- StepTracker: a narrower goal range, a daily coin target that is
-- different for each player each day, and no coins for your own goal
-- (step-tracker-decisions.txt, GOAL-1, GOAL-2 and GOAL-6).
--
-- Goals: 5,000 to 20,000 in 500s (was 3,000 to 25,000). Past changes are
-- kept as they were; anyone whose goal is outside the new range moves to
-- the nearest end of it from tomorrow.
--
-- Daily coins: each player's target for a day is 7,000 to 10,000 steps in
-- 500s, picked at random but fixed for that player and day (worked out
-- from the two, so it never changes once shown). The shared step track
-- still runs 0 to 10,000.
--
-- Streaks: still worked out from your own goal and shown as before, but
-- they no longer pay coins (the 7- and 30-day bonuses are gone). Bonuses
-- already paid stay paid. Your own goal earns no coins at all; only the
-- coin target does. The streak achievements' reward items are unchanged.

-- =====================================================================
-- GOAL RANGE (GOAL-1)
-- =====================================================================
insert into public.daily_goal_changes (user_id, starts_on, goal)
select p.id, current_date + 1,
       least(20000, greatest(5000, public.goal_on(p.id, current_date + 1)))
from public.profiles p
where public.goal_on(p.id, current_date + 1) not between 5000 and 20000;

-- As in 20261108000000_goals_streaks.sql, with the new range
create or replace function public.set_daily_goal_at(p_goal integer, my_today date, p_now timestamptz)
returns date language plpgsql security definer set search_path = ''
as $$
declare starts date;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if p_goal is null or p_goal not between 5000 and 20000 or p_goal % 500 <> 0 then
    raise exception 'BAD_GOAL';
  end if;
  if not public.is_today_somewhere(my_today, p_now) then raise exception 'BAD_DAY'; end if;
  starts := my_today + 1;
  insert into public.daily_goal_changes (user_id, starts_on, goal, chosen_at)
  values (auth.uid(), starts, p_goal, p_now);
  return starts;
end;
$$;

-- =====================================================================
-- DAILY COIN TARGET (GOAL-2)
-- =====================================================================
-- INTERNAL. Steps a player needs on a day for the daily coins: one of
-- 7,000, 7,500 ... 10,000. The day goes in as a day number, which (unlike
-- date text) doesn't depend on the DateStyle setting.
create function public.coin_steps_on(p_user uuid, p_day date)
returns integer language sql immutable set search_path = ''
as $$
  select 7000 + 500 * (((hashtextextended(p_user::text || ':' || (p_day - date '2000-01-01')::text, 0)
                         % 7) + 7) % 7)::integer
$$;

-- As in 20261108000000_goals_streaks.sql, plus today's coin target
create or replace function public.my_goal(my_today date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.is_today_somewhere(my_today, now()) then raise exception 'BAD_DAY'; end if;
  return jsonb_build_object(
    'today', public.goal_on(uid, my_today),
    'coin_steps', public.coin_steps_on(uid, my_today),
    'upcoming', (select jsonb_build_object('goal', c.goal, 'starts_on', c.starts_on)
                 from public.daily_goal_changes c
                 where c.user_id = uid and c.starts_on > my_today
                 order by c.starts_on desc, c.chosen_at desc, c.id desc
                 limit 1),
    'recent', (select jsonb_agg(jsonb_build_object('day', d::date,
                                                   'goal', public.goal_on(uid, d::date))
                                order by d)
               from generate_series(my_today - 6, my_today, '1 day') d));
end;
$$;

-- As in 20261110000000_achievements.sql, with each day's own coin target
-- in place of 10,000, and without the streak bonuses. Still one claim at
-- a time per person, so the achievements check sees every upload.
create or replace function public.claim_daily_rewards()
returns integer                    -- coins granted by this call
language plpgsql security definer set search_path = ''
as $$
declare
  uid         uuid := auth.uid();
  reward      constant integer := 100;     -- coins per day
  window_days constant integer := 7;       -- how far back to pay
  daily       integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  perform pg_advisory_xact_lock(hashtextextended('coins:' || uid::text, 0));

  with paid as (
    insert into public.coin_transactions (user_id, amount, reason, ref)
    select uid, reward, 'daily_goal', s.day::text
    from public.daily_steps s
    where s.user_id = uid
      and s.steps >= public.coin_steps_on(uid, s.day)
      and s.day >= current_date - window_days
      and s.day <= current_date + 1        -- no future days
    on conflict (user_id, reason, ref) do nothing
    returning amount
  )
  select coalesce(sum(amount), 0) into daily from paid;

  if daily > 0 then
    insert into public.wallets (user_id, balance)
    values (uid, daily)
    on conflict (user_id)
    do update set balance = public.wallets.balance + excluded.balance;
  end if;

  perform public.award_achievements(uid);

  return daily;
end;
$$;

revoke all on function public.coin_steps_on(uuid, date) from public, anon, authenticated;

-- The launch day for streak bonuses: nothing uses it now
drop function public.streak_bonus_from();
delete from public.app_settings where key = 'streak_bonus_from';
