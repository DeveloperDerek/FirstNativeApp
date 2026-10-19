-- step-tracker-activity-board.txt, section 13: what shows, who sees
-- what, order and pages. Run with `supabase test db`.
--
-- Days are counted back from the database's date (T = current_date).
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- 1 A: the viewer, 2 F: A's friend, 3 S: a stranger, 4 K: A's friend
-- who blocked A, 5 N: A's friend, not sharing, 6 R: A's former friend,
-- 7 H: A's friend, hidden, 8 P: A's friend with many days (pages)
insert into auth.users (id, email)
select ('000000' || lpad(to_hex(n), 2, '0') || '-ac7b-0000-0000-000000000000')::uuid,
       'act' || n || '@test.dev'
from generate_series(1, 8) n;
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'act_' || substr(id::text, 7, 2)
where id::text like '%-ac7b-%';
update public.profiles set sharing_consent_at = null where id = '00000005-ac7b-0000-0000-000000000000';
insert into public.profile_private (user_id, hidden_at)
values ('00000007-ac7b-0000-0000-000000000000', now());

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-ac7b-0000-0000-000000000000')::uuid
$$;
-- (The step-row check, which only accepts recent days, is off for this
-- test; rolled back at the end.)
alter table public.daily_steps disable trigger daily_steps_check;
-- A goal day: the uploaded day and its coin row, paid at T-ago plus a
-- few minutes (so the order within a day can be set)
create function pg_temp.goal_day(who integer, ago integer, minutes integer, coins integer default 150)
returns void language sql as $$
  insert into public.daily_steps (user_id, day, steps) values (pg_temp.u(who), current_date - ago, 11000);
  insert into public.coin_transactions (user_id, amount, reason, ref, created_at)
  values (pg_temp.u(who), coins, 'daily_goal', (current_date - ago)::text,
          (current_date - ago) + make_interval(mins => minutes));
$$;
create function pg_temp.earn(who integer, what text, ago integer, minutes integer)
returns void language sql as $$
  insert into public.user_achievements (user_id, achievement_id, earned_on, earned_at)
  values (pg_temp.u(who), what, current_date - ago, (current_date - ago) + make_interval(mins => minutes));
$$;
create function pg_temp.as_user(who integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(who)::text, true)
$$;
create function pg_temp.feed() returns jsonb language sql as $$
  select public.friends_activity(current_date)
$$;
create function pg_temp.people(lines jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg(distinct (l->>'user_id')::uuid), '{}') from jsonb_array_elements(lines) l
$$;
create function pg_temp.line(lines jsonb, who integer, ago integer) returns jsonb language sql as $$
  select l from jsonb_array_elements(lines) l
  where (l->>'user_id')::uuid = pg_temp.u(who) and (l->>'day')::date = current_date - ago
$$;

-- The goal is the coin target from 20 days back (GOAL-16's switch day)
update public.app_settings set value = (current_date - 20) - date '2000-01-01'
where key = 'goal_is_coin_target_from';

-- A's friends: F, K, N, H, P; R was a friend; S never
insert into public.friendships (requester_id, addressee_id, status)
select pg_temp.u(1), pg_temp.u(n), 'accepted' from unnest(array[2, 4, 5, 7, 8]) n;
insert into public.user_blocks (blocker_id, blocked_id) values (pg_temp.u(4), pg_temp.u(1));

-- Everyone but A reached the goal yesterday
select pg_temp.goal_day(n, 1, 60) from generate_series(2, 7) n;

-- ---------------------------------------------------------------------
-- What shows
-- ---------------------------------------------------------------------
-- A: goal at T-0 with First 10K the same day, and A week in a row on T-2
-- without the goal
select pg_temp.goal_day(1, 0, 30);
select pg_temp.earn(1, 'first_10k', 0, 31);
select pg_temp.earn(1, 'streak_7', 2, 10);
-- F: goal at T-3 corrected below the goal afterwards (the coin row stays),
-- goal at T-4 whose day was then deleted, with Big day earned that day,
-- and a goal at T-25, before the switch day
select pg_temp.goal_day(2, 3, 10);
update public.daily_steps set steps = 4000 where user_id = pg_temp.u(2) and day = current_date - 3;
select pg_temp.goal_day(2, 4, 10);
select pg_temp.earn(2, 'big_day', 4, 20);
delete from public.daily_steps where user_id = pg_temp.u(2) and day = current_date - 4;
select pg_temp.goal_day(2, 25, 10);
-- Other coins for F that aren't the goal: never a line
insert into public.coin_transactions (user_id, amount, reason, ref)
values (pg_temp.u(2), 300, 'checkin', 'welcome');

set local role authenticated;
select pg_temp.as_user(1);
create temp table a_feed on commit drop as select pg_temp.feed() as f;
reset role;

select is(pg_temp.line((select f from a_feed), 1, 0)->'achievements', '["first_10k"]'::jsonb,
          'A goal day and an achievement the same day: one line with both');
select is((pg_temp.line((select f from a_feed), 1, 0)->>'goal')::boolean, true, '...marked as the goal');
select is((pg_temp.line((select f from a_feed), 1, 0)->>'coins')::integer, 150, 'your own line has the coins');
select is((pg_temp.line((select f from a_feed), 2, 1)->'coins'), 'null'::jsonb, 'a friend''s line has none');
select is((select count(*)::integer from jsonb_array_elements((select f from a_feed)) l
           where l ? 'steps'), 0, 'no step counts in any line');
select is((pg_temp.line((select f from a_feed), 1, 2)->>'goal')::boolean, false,
          'an achievement without the goal: a line of its own, no goal');
select is((pg_temp.line((select f from a_feed), 2, 3)->>'goal')::boolean, true,
          'a day corrected below the goal keeps its line (the coins stay)');
select is(pg_temp.line((select f from a_feed), 2, 4) - 'at' - 'avatar' - 'display_name'
            - 'kudos' - 'my_kudos' - 'new_kudos',
          jsonb_build_object('day', current_date - 4, 'user_id', pg_temp.u(2), 'goal', false,
                             'coins', null, 'achievements', '["big_day"]'::jsonb,
                             'items', '[]'::jsonb),
          'a deleted day loses its goal and keeps its achievement');
select is(pg_temp.line((select f from a_feed), 2, 25), null, 'a day before the switch day: no line');
select is((select count(*)::integer from jsonb_array_elements((select f from a_feed)) l
           where (l->>'user_id')::uuid = pg_temp.u(2)), 3, 'F has three lines (T-1, T-3, T-4)');

-- ---------------------------------------------------------------------
-- Who sees what
-- ---------------------------------------------------------------------
select is(pg_temp.people((select f from a_feed)) @> array[pg_temp.u(1), pg_temp.u(2)], true,
          'A sees themself and a friend');
select is(pg_temp.u(3) = any(pg_temp.people((select f from a_feed))), false, 'not a stranger');
select is(pg_temp.u(4) = any(pg_temp.people((select f from a_feed))), false, 'not a friend who blocked A');
select is(pg_temp.u(5) = any(pg_temp.people((select f from a_feed))), false, 'not a friend who doesn''t share');
select is(pg_temp.u(6) = any(pg_temp.people((select f from a_feed))), false, 'not a former friend');
select is(pg_temp.u(7) = any(pg_temp.people((select f from a_feed))), false, 'not a hidden friend');

set local role authenticated;
select pg_temp.as_user(7);
select throws_ok($$ select pg_temp.feed() $$, 'ACCOUNT_NOT_ACTIVE', 'a hidden caller is refused');
select pg_temp.as_user(5);
select throws_ok($$ select pg_temp.feed() $$, 'SHARING_REQUIRED', 'a caller who doesn''t share is refused');
select pg_temp.as_user(1);
select throws_ok($$ select public.friends_activity(current_date + 5) $$, 'BAD_DAY',
                 'a date that isn''t today anywhere is refused');
select throws_ok($$ select public.friends_activity(current_date, current_date, null, null) $$, 'BAD_CURSOR',
                 'half a position is refused');
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$ select pg_temp.feed() $$, 'Not signed in', 'signed out is refused');
reset role;

select is((select bool_and(not has_function_privilege('anon', 'public.friends_activity(date, date, timestamptz, uuid)', 'execute'))
           and has_function_privilege('authenticated', 'public.friends_activity(date, date, timestamptz, uuid)', 'execute')),
          true, 'callable by signed-in users only');
select is((select prosecdef and proconfig @> array['search_path=""']
           from pg_proc where oid = 'public.friends_activity(date, date, timestamptz, uuid)'::regprocedure),
          true, 'security definer with an empty search_path');

-- ---------------------------------------------------------------------
-- Order and pages
-- ---------------------------------------------------------------------
-- P: a goal every day for 30 days (T-0 to T-29) and one 31 days back,
-- paid at minute 45: on T-1 after F (minute 60 is later, so F first)
select pg_temp.goal_day(8, d, 45) from generate_series(0, 29) d;
select pg_temp.goal_day(8, 31, 45);
-- (The switch day moves back, so only the 30 days decide here)
update public.app_settings set value = (current_date - 40) - date '2000-01-01'
where key = 'goal_is_coin_target_from';

set local role authenticated;
select pg_temp.as_user(1);
create temp table pages on commit drop as
with recursive walk(n, page) as (
  select 1, public.friends_activity(current_date)
  union all
  select n + 1, public.friends_activity(current_date,
                  (page->-1->>'day')::date, (page->-1->>'at')::timestamptz, (page->-1->>'user_id')::uuid)
  from walk where jsonb_array_length(page) > 0 and n < 10
)
select n, l, ord from walk, jsonb_array_elements(page) with ordinality as e(l, ord);
reset role;

select is((select count(*)::integer from pages where n = 1), 20, 'a page is 20 lines');
select is((select count(*)::integer from pages), (select count(distinct (l->>'user_id', l->>'day'))::integer from pages),
          'paging: every line exactly once');
select is((select count(*)::integer from pages where (l->>'user_id')::uuid = pg_temp.u(8)), 30,
          'nothing older than 30 days');
select is((select array_agg(l->>'user_id' order by n, ord) from pages where (l->>'day')::date = current_date - 1),
          array[pg_temp.u(2)::text, pg_temp.u(8)::text],
          'within a day, the latest first');
select is((select bool_and(prev_day >= (l->>'day')::date)
           from (select l, lag((l->>'day')::date) over (order by n, ord) as prev_day from pages) x
           where prev_day is not null),
          true, 'newest day first, across pages');

select * from finish();
rollback;
