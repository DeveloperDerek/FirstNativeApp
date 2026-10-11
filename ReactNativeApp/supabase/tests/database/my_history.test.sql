-- step-tracker-history-reminders.txt, section 5: my_history and
-- my_history_by_month. Run with `supabase test db`.
--
-- Days are counted back from the database's date (T = current_date),
-- which is always "today" somewhere on Earth. The monthly sums use last
-- year (Y), so they don't depend on how far into this year T is.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email)
select ('000000' || lpad(to_hex(n), 2, '0') || '-91a1-0000-0000-000000000000')::uuid,
       'h' || n || '@test.dev'
from generate_series(1, 5) n;
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'hist_' || substr(id::text, 7, 2)
where id::text like '%-91a1-%';
-- U3 doesn't share steps; U4 hasn't finished signing up (not active)
update public.profiles set sharing_consent_at = null where id = '00000003-91a1-0000-0000-000000000000';
update public.profiles set onboarded_at = null where id = '00000004-91a1-0000-0000-000000000000';

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-91a1-0000-0000-000000000000')::uuid
$$;
-- (The step-row check only accepts the last 8 days; off for this test,
-- rolled back at the end.)
alter table public.daily_steps disable trigger daily_steps_check;
create function pg_temp.walk(who integer, on_day date, n integer) returns void language sql as $$
  insert into public.daily_steps (user_id, day, steps) values (pg_temp.u(who), on_day, n)
  on conflict (user_id, day) do update set steps = excluded.steps
$$;
create function pg_temp.as_user(who integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(pg_temp.u(who)::text, ''), true)
$$;
create function pg_temp.y() returns integer language sql as $$
  select extract(year from current_date)::integer - 1
$$;
create function pg_temp.yd(m integer, d integer) returns date language sql as $$
  select make_date(pg_temp.y(), m, d)
$$;

-- ---------------------------------------------------------------------
-- my_history (U1): every day, each with its own goal, steps or null
-- ---------------------------------------------------------------------
-- Goal 10,000 until T-10, then 6,000. T-11 a real 0, T-10 never uploaded,
-- T-9 7,000 (at the new goal).
insert into public.daily_goal_changes (user_id, starts_on, goal)
values (pg_temp.u(1), current_date - 10, 6000);
select pg_temp.walk(1, current_date - 12, 12000);
select pg_temp.walk(1, current_date - 11, 0);
select pg_temp.walk(1, current_date - 9, 7000);
-- Someone else's steps on the same days, which must never show up
select pg_temp.walk(2, d::date, 99999) from generate_series(current_date - 12, current_date, '1 day') d;

select pg_temp.as_user(1);
select is((select array_agg(h.day order by h.day) from public.my_history(current_date - 12, current_date - 8, current_date) h),
          array[current_date - 12, current_date - 11, current_date - 10, current_date - 9, current_date - 8],
          'every day in the range, in order, uploaded or not');
select is((select array_agg(h.goal order by h.day) from public.my_history(current_date - 12, current_date - 8, current_date) h),
          array[10000, 10000, 6000, 6000, 6000], 'each day with the goal it had (a change mid-range shows both)');
select is((select array_agg(h.steps order by h.day) from public.my_history(current_date - 12, current_date - 8, current_date) h),
          array[12000, 0, null, 7000, null]::integer[], 'steps: an uploaded 0 is 0, a day never uploaded is null');
select is((select count(*)::int from public.my_history(current_date - 365, current_date, current_date) h), 366,
          '366 days in one call is fine (a leap year)');
select is((select count(*)::int from public.my_history(current_date, current_date, current_date) h), 1,
          'one day is fine');

-- Ranges and dates
select throws_ok($$ select * from public.my_history(current_date - 366, current_date, current_date) h $$,
                 'BAD_RANGE', '367 days refused');
select throws_ok($$ select * from public.my_history(current_date - 3, current_date - 5, current_date) h $$,
                 'BAD_RANGE', 'from_day after to_day refused');
select throws_ok($$ select * from public.my_history(current_date - 5, current_date + 1, current_date) h $$,
                 'BAD_RANGE', 'to_day after the phone''s today refused');
select throws_ok($$ select * from public.my_history(null, current_date, current_date) h $$,
                 'BAD_RANGE', 'a missing date refused');
select throws_ok($$ select * from public.my_history(current_date - 5, current_date, current_date + 5) h $$,
                 'BAD_DAY', 'a today that is today nowhere refused');

-- Only yours: U2 asking for the same days gets U2's own
select pg_temp.as_user(2);
select is((select array_agg(distinct h.steps) from public.my_history(current_date - 12, current_date - 8, current_date) h),
          array[99999], 'someone else asking sees only their own steps');
select is((select array_agg(h.goal order by h.day) from public.my_history(current_date - 12, current_date - 8, current_date) h),
          array[10000, 10000, 10000, 10000, 10000], '...and their own goals');

-- Not sharing (U3): the goals, every step null, even with rows on the server
insert into public.daily_goal_changes (user_id, starts_on, goal)
values (pg_temp.u(3), current_date - 2, 4000);
select pg_temp.walk(3, current_date - 3, 5000);
select pg_temp.as_user(3);
select is((select array_agg(h.goal order by h.day) from public.my_history(current_date - 3, current_date, current_date) h),
          array[10000, 4000, 4000, 4000], 'not sharing: the goals are still there');
select is((select count(*)::int from public.my_history(current_date - 3, current_date, current_date) h
           where h.steps is not null), 0, 'not sharing: no steps, even ones uploaded before');

-- Not active, signed out
select pg_temp.as_user(4);
select throws_ok($$ select * from public.my_history(current_date - 5, current_date, current_date) h $$,
                 'ACCOUNT_NOT_ACTIVE', 'not active: refused');
select pg_temp.as_user(null);
select throws_ok($$ select * from public.my_history(current_date - 5, current_date, current_date) h $$,
                 'Not signed in', 'signed out: refused');

-- The app's role can call it; anon can't
select ok(has_function_privilege('authenticated', 'public.my_history(date, date, date)', 'execute'),
          'signed-in users can call my_history');
select ok(not has_function_privilege('anon', 'public.my_history(date, date, date)', 'execute'),
          '...anon can''t');

-- ---------------------------------------------------------------------
-- my_history_by_month (U5, last year)
-- ---------------------------------------------------------------------
-- January: only a real 0. March: 1st-10th at 12,000; 11th a 0;
-- 12th-14th missing; goal 5,000 from the 15th; 15th 6,000 (at goal),
-- 16th 4,000 (not). February and April on: nothing.
insert into public.daily_goal_changes (user_id, starts_on, goal)
values (pg_temp.u(5), pg_temp.yd(3, 15), 5000);
select pg_temp.walk(5, pg_temp.yd(1, 31), 0);
select pg_temp.walk(5, d::date, 12000) from generate_series(pg_temp.yd(3, 1), pg_temp.yd(3, 10), '1 day') d;
select pg_temp.walk(5, pg_temp.yd(3, 11), 0);
select pg_temp.walk(5, pg_temp.yd(3, 15), 6000);
select pg_temp.walk(5, pg_temp.yd(3, 16), 4000);
-- The day after the phone's today, this year (e.g. a phone ahead in time)
select pg_temp.walk(5, current_date + 1, 50000);
select pg_temp.walk(5, current_date, 1000);

select pg_temp.as_user(5);
select is((select array_agg(m.month order by m.month) from public.my_history_by_month(pg_temp.y(), current_date) m),
          array[pg_temp.yd(1, 1), pg_temp.yd(3, 1)], 'only months with data, a zero-only month included');
select is((select m.days_with_data from public.my_history_by_month(pg_temp.y(), current_date) m
           where m.month = pg_temp.yd(3, 1)), 13, 'March: 13 days with data (the 0 counts, the 3 missing don''t)');
select is((select m.total_steps from public.my_history_by_month(pg_temp.y(), current_date) m
           where m.month = pg_temp.yd(3, 1)), 130000::bigint, 'March: the total');
select is((select m.days_at_goal from public.my_history_by_month(pg_temp.y(), current_date) m
           where m.month = pg_temp.yd(3, 1)), 11, 'March: days at goal, each by its own goal (10 + the 15th)');
select is((select (m.best_day, m.best_steps)::text from public.my_history_by_month(pg_temp.y(), current_date) m
           where m.month = pg_temp.yd(3, 1)), (pg_temp.yd(3, 1), 12000)::text,
          'March: the best day (the earliest of the 12,000 days)');
select is((select (m.days_with_data, m.total_steps, m.days_at_goal)::text
           from public.my_history_by_month(pg_temp.y(), current_date) m where m.month = pg_temp.yd(1, 1)),
          '(1,0,0)', 'January: one real 0, not at goal');

-- The same month from my_history, day by day
select is((select m.total_steps::numeric / m.days_with_data
           from public.my_history_by_month(pg_temp.y(), current_date) m where m.month = pg_temp.yd(3, 1)),
          (select avg(h.steps) from public.my_history(pg_temp.yd(3, 1), pg_temp.yd(3, 31), current_date) h),
          'March''s average (total / days with data) matches the days from my_history');
select is((select m.days_at_goal from public.my_history_by_month(pg_temp.y(), current_date) m
           where m.month = pg_temp.yd(3, 1)),
          (select count(*)::int from public.my_history(pg_temp.yd(3, 1), pg_temp.yd(3, 31), current_date) h
           where h.steps >= h.goal), '...and so do the days at goal');

-- This year: only up to the phone's today
select is((select sum(m.total_steps) from public.my_history_by_month(pg_temp.y() + 1, current_date) m),
          1000::numeric, 'this year: a day after the phone''s today isn''t counted');

select throws_ok($$ select * from public.my_history_by_month(pg_temp.y() + 2, current_date) m $$,
                 'BAD_RANGE', 'a year after the phone''s today refused');
select throws_ok($$ select * from public.my_history_by_month(null, current_date) m $$,
                 'BAD_RANGE', 'no year refused');
select throws_ok($$ select * from public.my_history_by_month(pg_temp.y(), current_date + 5) m $$,
                 'BAD_DAY', 'a today that is today nowhere refused');

-- Not sharing, not active
select pg_temp.as_user(3);
select is_empty($$ select * from public.my_history_by_month(pg_temp.y() + 1, current_date) m $$,
                'not sharing: no months (the phone reads Health)');
select pg_temp.as_user(4);
select throws_ok($$ select * from public.my_history_by_month(pg_temp.y(), current_date) m $$,
                 'ACCOUNT_NOT_ACTIVE', 'not active: refused');

select * from finish();
rollback;
