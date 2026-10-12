-- step-tracker-goals-streaks.txt, section 5: goals, streaks, the daily
-- coin target, and that your own goal pays no coins. Run with
-- `supabase test db`.
--
-- Days are counted back from the database's date (T = current_date),
-- which is always "today" somewhere on Earth.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

insert into auth.users (id, email)
select ('000000' || lpad(to_hex(n), 2, '0') || '-90a1-0000-0000-000000000000')::uuid,
       'g' || n || '@test.dev'
from generate_series(1, 20) n;
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'goal_' || substr(id::text, 7, 2)
where id::text like '%-90a1-%';
-- U14 doesn't share steps
update public.profiles set sharing_consent_at = null where id = '0000000e-90a1-0000-0000-000000000000';

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-90a1-0000-0000-000000000000')::uuid
$$;
-- Steps for a user on days T-from .. T-to (older days skip the step-row
-- trigger, which only accepts the last 8)
-- (The step-row check is off for this test; rolled back at the end.)
alter table public.daily_steps disable trigger daily_steps_check;
create function pg_temp.walk(who integer, d_from integer, d_to integer, n integer)
returns void language sql as $$
  insert into public.daily_steps (user_id, day, steps)
  select pg_temp.u(who), current_date - d, n from generate_series(d_to, d_from) d
  on conflict (user_id, day) do update set steps = excluded.steps
$$;
create function pg_temp.as_user(who integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(who)::text, true)
$$;
create function pg_temp.streak(who integer) returns jsonb language sql as $$
  select public.streak_info(pg_temp.u(who), current_date)
$$;
create function pg_temp.daily_coins(who integer) returns text[] language sql as $$
  select coalesce(array_agg(t.ref order by t.ref), '{}') from public.coin_transactions t
  where t.user_id = pg_temp.u(who) and t.reason = 'daily_goal'
$$;

-- ---------------------------------------------------------------------
-- Goals (U1)
-- ---------------------------------------------------------------------
select pg_temp.as_user(1);
select is(public.goal_on(pg_temp.u(1), current_date - 100), 10000, 'never changed: 10,000 for a past day');
select is(public.goal_on(pg_temp.u(1), current_date + 100), 10000, '...and a future one');
select is(public.set_daily_goal(5000, current_date), current_date + 1, '5,000 accepted, starting the day after the phone''s date');
select is(public.set_daily_goal(20000, current_date), current_date + 1, '20,000 accepted');
select throws_ok($$ select public.set_daily_goal(4500, current_date) $$, 'BAD_GOAL', 'below 5,000 refused');
select throws_ok($$ select public.set_daily_goal(20500, current_date) $$, 'BAD_GOAL', 'above 20,000 refused');
select throws_ok($$ select public.set_daily_goal(7250, current_date) $$, 'BAD_GOAL', 'not a multiple of 500 refused');
select throws_ok($$ select public.set_daily_goal(8000, current_date + 5) $$, 'BAD_DAY',
                 'a date that is today nowhere refused');

-- Two changes on the same day: the later wins, both kept
select public.set_daily_goal(8000, current_date);
select public.set_daily_goal(6000, current_date);
select is(public.goal_on(pg_temp.u(1), current_date + 1), 6000, 'two changes in a day: the later one is the next day''s goal');
select is((select count(*)::int from public.daily_goal_changes where user_id = pg_temp.u(1)), 4,
          'every change is kept');
select is(public.goal_on(pg_temp.u(1), current_date), 10000, 'today keeps the goal it started with');
select is((public.my_goal(current_date)->'upcoming'->>'goal')::int, 6000, 'my_goal shows the change waiting to start');
select is((public.my_goal(current_date)->>'today')::int, 10000, '...and today''s goal');
select is(jsonb_array_length(public.my_goal(current_date)->'recent'), 7, '...and the last 7 days'' goals');

-- Only your own goal can be read or changed
set local role authenticated;
select pg_temp.as_user(2);
select is_empty($$ select 1 from public.daily_goal_changes where user_id = '00000001-90a1-0000-0000-000000000000' $$,
                'someone else''s goals can''t be read');
select throws_ok($$ insert into public.daily_goal_changes (user_id, starts_on, goal)
                    values (auth.uid(), current_date - 30, 3000) $$,
                 '42501', null, 'goals can''t be written directly (e.g. backdated)');
reset role;

-- ---------------------------------------------------------------------
-- Streaks (U2)
-- ---------------------------------------------------------------------
select pg_temp.walk(2, 5, 1, 12000);  -- 5 days ending yesterday
select pg_temp.walk(2, 9, 7, 12000);  -- an older run of 3 (day 6 missing)
select pg_temp.walk(2, 10, 10, 9000); -- not at goal
select is((pg_temp.streak(2)->>'current')::int, 5, '5 days ending yesterday: a 5-day streak');
select is((pg_temp.streak(2)->>'today_done')::boolean, false, '...today not reached yet (at risk)');
select pg_temp.walk(2, 0, 0, 11000);
select is((pg_temp.streak(2)->>'current')::int, 6, 'reaching today makes it 6');
select is((pg_temp.streak(2)->>'best')::int, 6, 'best is 6 (the missed day 6 split the runs; day 10 wasn''t at goal)');
select pg_temp.walk(2, 0, 0, 500);
select is((pg_temp.streak(2)->>'current')::int, 5, 'today below goal: back to yesterday''s 5, still alive');

-- A past day is judged by the goal you had then
select pg_temp.as_user(2);
select public.set_daily_goal(13000, current_date);
select is((pg_temp.streak(2)->>'current')::int, 5, 'raising the goal (from tomorrow) doesn''t change past days');

-- Not sharing
select pg_temp.as_user(14);
select is(public.my_streak(current_date), '{"sharing": false}'::jsonb, 'not sharing: no streak');
select is(public.claim_daily_rewards(), 0, 'not sharing: no coins');

-- Late upload: a missing day restores the run
select pg_temp.walk(2, 6, 6, 12000);
select is((pg_temp.streak(2)->>'best')::int, 9, 'the missing day uploaded late joins the runs: best becomes 9');

-- ---------------------------------------------------------------------
-- Your own goal pays no coins (GOAL-6): streaks are shown, never paid
-- ---------------------------------------------------------------------
-- U3: 7 days at 12,000 ending today: the daily coins only
select pg_temp.walk(3, 6, 0, 12000);
select pg_temp.as_user(3);
select is(public.claim_daily_rewards(), 700, '7 days in a row: 7 x 100 daily coins, no streak bonus');
select is((pg_temp.streak(3)->>'current')::int, 7, '...and the streak is still 7');
select is(public.claim_daily_rewards(), 0, 'claiming again pays nothing');

-- U4: personal goal 5,000 met for 7 days, never the coin target (7,000+)
insert into public.daily_goal_changes (user_id, starts_on, goal)
values (pg_temp.u(4), current_date - 30, 5000);
select pg_temp.walk(4, 6, 0, 6500);
select pg_temp.as_user(4);
select is(public.claim_daily_rewards(), 0, 'a 5,000 goal met 7 days: no coins at all');
select is((pg_temp.streak(4)->>'current')::int, 7, '...but a 7-day streak');

-- U5: 100 days in a row: no bonus at 7, 30 or 100
select pg_temp.walk(5, 99, 0, 12000);
select pg_temp.as_user(5);
select is(public.claim_daily_rewards(), 800, '100 days in a row: only the 8 days of daily coins in the window');
-- (Its achievement reward items are in the coin history too, at 0 coins)
select is((select count(*)::int from public.coin_transactions where user_id = pg_temp.u(5)
           and reason not in ('daily_goal', 'achievement')), 0, 'no streak coins of any kind');

-- ---------------------------------------------------------------------
-- The daily coin target: 7,000 to 10,000, per player and day (GOAL-2)
-- ---------------------------------------------------------------------
select is(array(select distinct public.coin_steps_on(pg_temp.u(n), current_date - d)
                 from generate_series(1, 20) n, generate_series(0, 60) d order by 1),
          array[7000, 7500, 8000, 8500, 9000, 9500, 10000],
          'every target is 7,000 to 10,000 in 500s, and each one comes up');
select ok((select count(distinct public.coin_steps_on(pg_temp.u(17), current_date - d))
           from generate_series(0, 30) d) > 1, 'one player''s target changes from day to day');
select is((public.my_goal(current_date)->>'coin_steps')::int, public.coin_steps_on(pg_temp.u(5), current_date),
          'my_goal shows today''s target');
-- U17: exactly the target yesterday, one step short today
select pg_temp.walk(17, 1, 1, public.coin_steps_on(pg_temp.u(17), current_date - 1));
select pg_temp.walk(17, 0, 0, public.coin_steps_on(pg_temp.u(17), current_date) - 1);
select pg_temp.as_user(17);
select is(public.claim_daily_rewards(), 100, 'the target pays; a step short doesn''t');
select is(pg_temp.daily_coins(17), array[(current_date - 1)::text], '...for the day that reached it');

-- ---------------------------------------------------------------------
-- What a tampered phone can do, and its limit (decision 14)
-- ---------------------------------------------------------------------
-- At 11:00 UTC on 10 Oct 2026, three dates are "today" somewhere: 9, 10, 11.
select pg_temp.as_user(12);
select is(public.set_daily_goal_at(5000, '2026-10-09', '2026-10-10 11:00+00'), '2026-10-10'::date,
          'sending the earliest valid date makes the goal start on 10 Oct: a day under way (UTC''s today, UTC+14''s yesterday)');
select throws_ok($$ select public.set_daily_goal_at(5000, '2026-10-08', '2026-10-10 11:00+00') $$, 'BAD_DAY',
                 'a date before every time zone''s today is refused');
select throws_ok($$ select public.set_daily_goal_at(5000, '2026-10-12', '2026-10-10 11:00+00') $$, 'BAD_DAY',
                 'a date after every time zone''s today is refused');

-- U12 (tampered: a lower goal applied on the day it would have missed)
-- vs U13 (honest: 5,000 from the start), same steps
select pg_temp.walk(12, 9, 0, 12000);
select pg_temp.walk(13, 9, 0, 12000);
select pg_temp.walk(12, 4, 4, 5500);   -- a weak day
select pg_temp.walk(13, 4, 4, 5500);
delete from public.daily_goal_changes where user_id = pg_temp.u(12);
insert into public.daily_goal_changes (user_id, starts_on, goal, chosen_at) values
  (pg_temp.u(12), current_date - 4, 5000, now()),            -- lowered for the weak day
  (pg_temp.u(12), current_date - 3, 10000, now() + interval '1 second');
insert into public.daily_goal_changes (user_id, starts_on, goal)
values (pg_temp.u(13), current_date - 100, 5000);
select is((pg_temp.streak(12)->>'current')::int, 10, 'the tampered goal rescues the weak day: a 10-day streak');
select ok((pg_temp.streak(13)->>'current')::int >= (pg_temp.streak(12)->>'current')::int
          and (pg_temp.streak(13)->>'best')::int >= (pg_temp.streak(12)->>'best')::int,
          'the honest 5,000 player''s streak is at least as long');
select pg_temp.as_user(12);
create temp table tampered as select public.claim_daily_rewards() as coins;
select pg_temp.as_user(13);
select is(public.claim_daily_rewards(), (select coins from tampered),
          '...and the goal makes no difference to coins');

-- ---------------------------------------------------------------------
-- The player card
-- ---------------------------------------------------------------------
insert into public.friendships (requester_id, addressee_id, status)
values (pg_temp.u(15), pg_temp.u(3), 'accepted');
set local role authenticated;
select pg_temp.as_user(15);
select is(public.player_streak(pg_temp.u(3), current_date), 7, 'a friend sees your streak');
select is(public.player_streak(pg_temp.u(4), current_date), null::int, 'someone who isn''t a friend doesn''t');
select is(public.player_streak(pg_temp.u(14), current_date), null::int, 'nor anyone not sharing steps');
reset role;

-- ---------------------------------------------------------------------
-- Unchanged: the suspicious-steps view ignores personal goals
-- ---------------------------------------------------------------------
select pg_temp.walk(16, 9, 0, 40000);
create temp table before_goal as
  select * from public.suspicious_steps where user_id = pg_temp.u(16);
insert into public.daily_goal_changes (user_id, starts_on, goal)
values (pg_temp.u(16), current_date - 50, 3000);
select results_eq($$ select * from public.suspicious_steps where user_id = '00000010-90a1-0000-0000-000000000000' $$,
                  $$ select * from before_goal $$,
                  'the suspicious-steps view gives the same answer with a 3,000 goal');

-- Who may call what
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('is_today_somewhere', 'goal_on', 'set_daily_goal_at', 'goal_runs',
                            'streak_info', 'coin_steps_on')
          and (has_function_privilege('anon', p.oid, 'execute')
               or has_function_privilege('authenticated', p.oid, 'execute'))
        order by 1),
  '{}'::text[], 'internal helpers can''t be called from the app');

select * from finish();
rollback;
