-- The daily goal is each player's daily coin target (step-tracker-
-- decisions.txt, GOAL-16): 7,000 to 10,000 steps in 500s, different for
-- each player each day, the same number that pays the daily coins
-- (coin_steps_on). Today, History, streaks and goal reminders all follow
-- it, because they all read the goal through goal_on.
--
-- It starts today. The server's date is "today" somewhere and can be a
-- day ahead of a phone behind UTC, so the switch counts from the day
-- before it, which covers every phone's today. That can also move a
-- yesterday in UTC+ places; the target is never above 10,000, so a day
-- can only become easier to reach, never harder (the personal goals that
-- were higher stopped with GOAL-15).
--
-- Days before the switch keep the goal they had (10,000, or a personal
-- goal from before GOAL-15), so History and streaks don't change looking
-- back. The switch day is a setting (days since 2000-01-01); without it,
-- goal_on works as before.

insert into public.app_settings (key, value)
values ('goal_is_coin_target_from', (current_date - 1) - date '2000-01-01');

-- INTERNAL. The goal that applied to a day
create or replace function public.goal_on(p_user uuid, p_day date)
returns integer language sql stable security definer set search_path = ''
as $$
  select case
    when p_day >= date '2000-01-01' + (select s.value from public.app_settings s
                                       where s.key = 'goal_is_coin_target_from')
      then public.coin_steps_on(p_user, p_day)
    else coalesce((
      select c.goal from public.daily_goal_changes c
      where c.user_id = p_user and c.starts_on <= p_day
      order by c.starts_on desc, c.chosen_at desc, c.id desc
      limit 1), 10000)
  end
$$;
revoke all on function public.goal_on(uuid, date) from public, anon, authenticated;
