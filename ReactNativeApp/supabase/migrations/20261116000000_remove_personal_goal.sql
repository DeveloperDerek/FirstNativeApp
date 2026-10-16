-- Personal goals are removed (step-tracker-decisions.txt, GOAL-15): the
-- daily goal is 10,000 for everyone again. Today, History, streaks and
-- goal reminders all follow it, as they did before goals could be picked.
--
-- Past days keep the goal that applied to them (daily_goal_changes stays,
-- read by goal_on), so History and streaks don't change looking back.
-- From tomorrow everyone is at 10,000; today keeps its goal, like any
-- goal change did.

-- Changes still waiting to start never will
delete from public.daily_goal_changes where starts_on > current_date + 1;

-- Everyone not already headed for 10,000 goes back to it from tomorrow.
-- (The server's date; this row is chosen last, so it wins over any other
-- change for the same day.)
insert into public.daily_goal_changes (user_id, starts_on, goal)
select u.user_id, current_date + 1, 10000
from (select distinct user_id from public.daily_goal_changes) u
where public.goal_on(u.user_id, current_date + 1) <> 10000;

-- People can't pick a goal any more. set_daily_goal_at stays: it is
-- internal (never granted to the app) and the tests use it to give past
-- days a goal other than 10,000.
drop function public.set_daily_goal(integer, date);
