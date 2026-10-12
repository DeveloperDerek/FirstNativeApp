-- step-tracker-goals-streaks.txt, section 5: goals, streaks, the streak
-- bonuses and their edge cases. (Two phones claiming at once:
-- supabase/tests/concurrency/streak_race.sh.) Run with `supabase test db`.
--
-- Days are counted back from the database's date (T = current_date),
-- which is always "today" somewhere on Earth.
begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

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
create function pg_temp.bonuses(who integer, which text) returns text[] language sql as $$
  select coalesce(array_agg(t.ref order by t.ref), '{}') from public.coin_transactions t
  where t.user_id = pg_temp.u(who) and t.reason = which
$$;
-- Milestones reached on or after this day pay (the launch day)
create function pg_temp.launch(days_ago integer) returns void language sql as $$
  update public.app_settings set value = to_char(current_date - days_ago, 'YYYYMMDD')::integer
  where key = 'streak_bonus_from'
$$;
select pg_temp.launch(200); -- long ago, until the launch tests

-- ---------------------------------------------------------------------
-- Goals (U1)
-- ---------------------------------------------------------------------
select pg_temp.as_user(1);
select is(public.goal_on(pg_temp.u(1), current_date - 100), 10000, 'never changed: 10,000 for a past day');
select is(public.goal_on(pg_temp.u(1), current_date + 100), 10000, '...and a future one');
select is(public.set_daily_goal(3000, current_date), current_date + 1, '3,000 accepted, starting the day after the phone''s date');
select is(public.set_daily_goal(25000, current_date), current_date + 1, '25,000 accepted');
select throws_ok($$ select public.set_daily_goal(2500, current_date) $$, 'BAD_GOAL', 'below 3,000 refused');
select throws_ok($$ select public.set_daily_goal(25500, current_date) $$, 'BAD_GOAL', 'above 25,000 refused');
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
select is(public.claim_daily_rewards(), 0, 'not sharing: no coins, no bonus');

-- Late upload: a missing day restores the run
select pg_temp.walk(2, 6, 6, 12000);
select is((pg_temp.streak(2)->>'best')::int, 9, 'the missing day uploaded late joins the runs: best becomes 9');

-- ---------------------------------------------------------------------
-- Bonuses
-- ---------------------------------------------------------------------
-- U3: 7 days at 10,000+ ending today: daily coins and the 7-day bonus
select pg_temp.walk(3, 6, 0, 12000);
select pg_temp.as_user(3);
select is(public.claim_daily_rewards(), 700 + 200, '7 days: 7 x 100 daily coins + the 200 bonus');
select is(pg_temp.bonuses(3, 'streak_7'), array[current_date::text], 'recorded with the day it reached 7');
select is(public.claim_daily_rewards(), 0, 'claiming again pays nothing');

-- U4: personal goal 7,500 met for 7 days, never 10,000
insert into public.daily_goal_changes (user_id, starts_on, goal)
values (pg_temp.u(4), current_date - 30, 7500);
select pg_temp.walk(4, 6, 0, 8000);
select pg_temp.as_user(4);
select is(public.claim_daily_rewards(), 200, 'a 7,500 goal met 7 days: the bonus, and no daily coins');
select is(pg_temp.bonuses(4, 'daily_goal'), '{}'::text[], 'daily coins still need 10,000');

-- U5: 30 days, then 100: 7 and 30 pay, 100 doesn't
select pg_temp.walk(5, 99, 0, 12000);
select pg_temp.as_user(5);
select is(public.claim_daily_rewards() - 800, 200 + 1000, '100 days in a row: 200 + 1,000 (plus 8 days of daily coins)');
select is(pg_temp.bonuses(5, 'streak_7'), array[(current_date - 93)::text], 'the 7-day bonus, once for the run');
select is(pg_temp.bonuses(5, 'streak_30'), array[(current_date - 70)::text], 'the 30-day bonus, once');
-- (Its achievement reward items are in the coin history too, at 0 coins)
select is((select count(*)::int from public.coin_transactions where user_id = pg_temp.u(5)
           and reason not in ('daily_goal', 'streak_7', 'streak_30', 'achievement')), 0, 'nothing at 100 days');

-- U6: a run, a break, a new run: each pays its 7
select pg_temp.walk(6, 20, 14, 12000);
select pg_temp.walk(6, 6, 0, 12000);
select pg_temp.as_user(6);
select public.claim_daily_rewards();
select is(pg_temp.bonuses(6, 'streak_7'), array[(current_date - 14)::text, current_date::text],
          'a streak that breaks and builds to 7 again pays again');

-- ---------------------------------------------------------------------
-- Late uploads
-- ---------------------------------------------------------------------
-- U7: days 10-8, a gap on 7, then 6-0 (paid). Day 7 arrives: no more.
select pg_temp.walk(7, 10, 8, 12000);
select pg_temp.walk(7, 6, 0, 12000);
select pg_temp.as_user(7);
select public.claim_daily_rewards();
select is(pg_temp.bonuses(7, 'streak_7'), array[current_date::text], 'the second run paid its 7');
select pg_temp.walk(7, 7, 7, 12000);
select is(public.claim_daily_rewards(), 100,
          'the late day joins them into 11: its daily coins only, no second 7-day bonus');

-- U8: two runs both paid (15-9 and 7-1), then day 8 joins them
select pg_temp.walk(8, 15, 9, 12000);
select pg_temp.walk(8, 7, 1, 12000);
select pg_temp.as_user(8);
select public.claim_daily_rewards();
select is(array_length(pg_temp.bonuses(8, 'streak_7'), 1), 2, 'both runs paid their 7');
select pg_temp.walk(8, 8, 8, 12000);
select is(public.claim_daily_rewards(), 0,
          'joined by day 8: nothing more (day 8 is outside the daily-coin window)');
select is(array_length(pg_temp.bonuses(8, 'streak_7'), 1), 2, 'both earlier payments are kept (no claw-back)');

-- ---------------------------------------------------------------------
-- The launch cutoff: the day the milestone was reached counts
-- ---------------------------------------------------------------------
select pg_temp.launch(3);
-- U9: a run already 12 long at launch: shown, not paid
select pg_temp.walk(9, 11, 0, 12000);
select is((pg_temp.streak(9)->>'current')::int, 12, 'a 12-day run at launch is shown');
select pg_temp.as_user(9);
select is(public.claim_daily_rewards() - 800, 0, '...but its 7 (reached before launch) pays nothing');

-- U10: days 12-7 and 5; day 6 arrives late, showing 7 reached on day 6 (before launch)
select pg_temp.walk(10, 12, 7, 12000);
select pg_temp.walk(10, 5, 5, 12000);
select pg_temp.walk(10, 6, 6, 12000);
select pg_temp.as_user(10);
select is(pg_temp.bonuses(10, 'streak_7'), '{}'::text[], 'nothing before claiming');
select public.claim_daily_rewards();
select is(pg_temp.bonuses(10, 'streak_7'), '{}'::text[], 'a late upload revealing a milestone before launch pays nothing');

-- U11: days 6-4 and 2-0; day 3 arrives late: 7 reached today (after launch)
select pg_temp.walk(11, 6, 4, 12000);
select pg_temp.walk(11, 2, 0, 12000);
select pg_temp.as_user(11);
select public.claim_daily_rewards();
select is(pg_temp.bonuses(11, 'streak_7'), '{}'::text[], 'no run of 7 yet');
select pg_temp.walk(11, 3, 3, 12000);
select public.claim_daily_rewards();
select is(pg_temp.bonuses(11, 'streak_7'), array[current_date::text], 'a late upload revealing a milestone after launch pays');
select pg_temp.launch(200);

-- ---------------------------------------------------------------------
-- What a tampered phone can do, and its limit (decision 14)
-- ---------------------------------------------------------------------
-- At 11:00 UTC on 10 Oct 2026, three dates are "today" somewhere: 9, 10, 11.
select pg_temp.as_user(12);
select is(public.set_daily_goal_at(3000, '2026-10-09', '2026-10-10 11:00+00'), '2026-10-10'::date,
          'sending the earliest valid date makes the goal start on 10 Oct: a day under way (UTC''s today, UTC+14''s yesterday)');
select throws_ok($$ select public.set_daily_goal_at(3000, '2026-10-08', '2026-10-10 11:00+00') $$, 'BAD_DAY',
                 'a date before every time zone''s today is refused');
select throws_ok($$ select public.set_daily_goal_at(3000, '2026-10-12', '2026-10-10 11:00+00') $$, 'BAD_DAY',
                 'a date after every time zone''s today is refused');

-- U12 (tampered: a lower goal applied on the days it would have missed)
-- vs U13 (honest: 3,000 from the start), same steps
select pg_temp.walk(12, 9, 0, 12000);
select pg_temp.walk(13, 9, 0, 12000);
select pg_temp.walk(12, 4, 4, 3500);   -- a weak day
select pg_temp.walk(13, 4, 4, 3500);
delete from public.daily_goal_changes where user_id = pg_temp.u(12);
insert into public.daily_goal_changes (user_id, starts_on, goal, chosen_at) values
  (pg_temp.u(12), current_date - 4, 3000, now()),            -- lowered for the weak day
  (pg_temp.u(12), current_date - 3, 10000, now() + interval '1 second');
insert into public.daily_goal_changes (user_id, starts_on, goal)
values (pg_temp.u(13), current_date - 100, 3000);
select is((pg_temp.streak(12)->>'current')::int, 10, 'the tampered goal rescues the weak day: a 10-day streak');
select ok((pg_temp.streak(13)->>'current')::int >= (pg_temp.streak(12)->>'current')::int
          and (pg_temp.streak(13)->>'best')::int >= (pg_temp.streak(12)->>'best')::int,
          'the honest 3,000 player''s streak is at least as long');
select pg_temp.as_user(12);
create temp table tampered as select public.claim_daily_rewards() - 800 as bonus;
select pg_temp.as_user(13);
select ok(public.claim_daily_rewards() - 800 >= (select bonus from tampered),
          '...and earns at least the same bonuses');

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
                            'streak_info', 'streak_bonus_from')
          and (has_function_privilege('anon', p.oid, 'execute')
               or has_function_privilege('authenticated', p.oid, 'execute'))
        order by 1),
  '{}'::text[], 'internal helpers can''t be called from the app');

select * from finish();
rollback;
