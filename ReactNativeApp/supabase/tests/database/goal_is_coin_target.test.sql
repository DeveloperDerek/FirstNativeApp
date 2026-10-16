-- step-tracker-decisions.txt, GOAL-16: the daily goal is each player's
-- daily coin target (coin_steps_on) from the switch day on; days before
-- it keep the goal they had. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email)
select ('000000' || lpad(to_hex(n), 2, '0') || '-c01a-0000-0000-000000000000')::uuid, 'ct' || n || '@test.dev'
from generate_series(1, 3) n;
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'target_' || substr(id::text, 7, 2)
where id::text like '%-c01a-%';

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-c01a-0000-0000-000000000000')::uuid
$$;
alter table public.daily_steps disable trigger daily_steps_check;

-- The switch: 10 days ago, so there are days on both sides of it
update public.app_settings set value = (current_date - 10) - date '2000-01-01'
where key = 'goal_is_coin_target_from';
-- U1 had a personal goal of 6,000 from long before
insert into public.daily_goal_changes (user_id, starts_on, goal)
values (pg_temp.u(1), current_date - 100, 6000);

-- ---------------------------------------------------------------------
-- The goal for a day
-- ---------------------------------------------------------------------
select is(public.goal_on(pg_temp.u(1), current_date - 11), 6000, 'before the switch: the goal they had');
select is(public.goal_on(pg_temp.u(2), current_date - 11), 10000, '...10,000 for someone who never picked one');
select is(public.goal_on(pg_temp.u(1), current_date - 10), public.coin_steps_on(pg_temp.u(1), current_date - 10),
          'from the switch day: the coin target');
select is(public.goal_on(pg_temp.u(2), current_date), public.coin_steps_on(pg_temp.u(2), current_date),
          '...today too');
select ok((select bool_and(public.goal_on(pg_temp.u(n), current_date - d) between 7000 and 10000
                           and public.goal_on(pg_temp.u(n), current_date - d) % 500 = 0)
           from generate_series(1, 3) n, generate_series(0, 9) d),
          'every goal since the switch is 7,000 to 10,000 in 500s');
select ok((select count(distinct public.goal_on(pg_temp.u(3), current_date - d)) > 1 from generate_series(0, 9) d),
          'it changes from day to day');

-- my_goal: today's goal and the coin target are the same number
select set_config('request.jwt.claim.sub', pg_temp.u(2)::text, true);
select is((public.my_goal(current_date)->>'today')::int, (public.my_goal(current_date)->>'coin_steps')::int,
          'my_goal: today''s goal is the coin target');

-- ---------------------------------------------------------------------
-- Streaks and History follow it
-- ---------------------------------------------------------------------
-- U2 walks exactly each day's target for the last 5 days; U3 one step short today
insert into public.daily_steps (user_id, day, steps)
select pg_temp.u(2), current_date - d, public.coin_steps_on(pg_temp.u(2), current_date - d)
from generate_series(0, 4) d;
insert into public.daily_steps (user_id, day, steps)
select pg_temp.u(3), current_date - d,
       public.coin_steps_on(pg_temp.u(3), current_date - d) - case when d = 0 then 1 else 0 end
from generate_series(0, 4) d;
select is((public.streak_info(pg_temp.u(2), current_date)->>'current')::int, 5,
          'exactly the target, 5 days running: a 5-day streak');
select is((public.streak_info(pg_temp.u(3), current_date)->>'today_done')::boolean, false,
          'one step short of today''s target: today isn''t done');
select is((public.streak_info(pg_temp.u(3), current_date)->>'current')::int, 4,
          '...and the streak is the 4 days before it');
select is((select count(*)::int from public.my_history(current_date - 4, current_date, current_date) h
           where h.steps >= h.goal), 5, 'History: all 5 days at goal');
select is((select h.goal from public.my_history(current_date, current_date, current_date) h),
          public.coin_steps_on(pg_temp.u(2), current_date), 'History: today''s goal is the target');

select * from finish();
rollback;
