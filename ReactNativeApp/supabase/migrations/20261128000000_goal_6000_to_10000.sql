-- The daily goal (the target for the daily roll) is 6,000 to 10,000 steps
-- in 500s, nine values, different for each player each day (step-tracker-
-- decisions.txt, GOAL-17). It was 7,000 to 10,000 (GOAL-2). Every caller
-- reads it through coin_steps_on (goal_on, my_goal, claim_daily_rewards,
-- the daily roll), so Today, History, streaks and the roll all follow.
--
-- The new range starts on a switch day. A different range picks a
-- different number for the same day, which can be higher than the old
-- one, so changing a day that already started could undo a goal someone
-- had reached, a roll they'd earned or a streak. The switch is two days
-- after the server's date: a phone far ahead of UTC can already be on
-- the server's tomorrow, and no phone is on the day after. Days before
-- it keep their old target. The switch day is a setting (days since
-- 2000-01-01); without it, every day keeps the old range.

insert into public.app_settings (key, value)
values ('goal_6000_from', (current_date + 2) - date '2000-01-01');

-- INTERNAL. Steps a player needs on a day for the daily roll. Now reads
-- the switch day, so it is stable rather than immutable.
create or replace function public.coin_steps_on(p_user uuid, p_day date)
returns integer language sql stable set search_path = ''
as $$
  select case
    when (p_day - date '2000-01-01') >= (select s.value from public.app_settings s
                                         where s.key = 'goal_6000_from')
      then 6000 + 500 * (((hashtextextended(p_user::text || ':' || (p_day - date '2000-01-01')::text, 0)
                           % 9) + 9) % 9)::integer
    else 7000 + 500 * (((hashtextextended(p_user::text || ':' || (p_day - date '2000-01-01')::text, 0)
                         % 7) + 7) % 7)::integer
  end
$$;
revoke all on function public.coin_steps_on(uuid, date) from public, anon, authenticated;
