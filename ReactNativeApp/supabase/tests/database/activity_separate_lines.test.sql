-- step-tracker-activity-board.txt (ACT-2 changed): one line per thing
-- done, kudos per line, older builds still served. Run with
-- `supabase test db`.
--
-- Days are counted back from the database's date (T = current_date).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- 1 A: the viewer, 2 F: A's friend
insert into auth.users (id, email)
select ('000000' || lpad(to_hex(n), 2, '0') || '-5e9a-0000-0000-000000000000')::uuid,
       'sep' || n || '@test.dev'
from generate_series(1, 2) n;
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'sep_' || substr(id::text, 7, 2)
where id::text like '%-5e9a-%';

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-5e9a-0000-0000-000000000000')::uuid
$$;
create function pg_temp.at(ago integer, hour integer) returns timestamptz language sql as $$
  select ((current_date - ago)::timestamp + make_interval(hours => hour)) at time zone 'America/Los_Angeles'
$$;
alter table public.daily_steps disable trigger daily_steps_check;
create function pg_temp.as_user(who integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(who)::text, true)
$$;

update public.app_settings set value = (current_date - 20) - date '2000-01-01'
where key = 'goal_is_coin_target_from';
insert into public.friendships (requester_id, addressee_id, status)
values (pg_temp.u(1), pg_temp.u(2), 'accepted');

-- F on T-1: the goal (8am), two achievements at the same moment (9am),
-- and two purchases (noon, 1pm). 25 days back on T-2..T-26: a goal
-- each, for paging.
insert into public.daily_steps (user_id, day, steps) values (pg_temp.u(2), current_date - 1, 11000);
insert into public.coin_transactions (user_id, amount, reason, ref, created_at)
values (pg_temp.u(2), 150, 'daily_goal', (current_date - 1)::text, pg_temp.at(1, 8));
insert into public.user_achievements (user_id, achievement_id, earned_on, earned_at)
values (pg_temp.u(2), 'first_10k', current_date - 1, pg_temp.at(1, 9)),
       (pg_temp.u(2), 'streak_7', current_date - 1, pg_temp.at(1, 9));
insert into public.user_items (user_id, item_id) values (pg_temp.u(2), 'cape_red'), (pg_temp.u(2), 'hat_cap_red');
insert into public.coin_transactions (user_id, amount, reason, ref, created_at)
values (pg_temp.u(2), -1200, 'purchase', 'cape_red', pg_temp.at(1, 12)),
       (pg_temp.u(2), -500, 'purchase', 'hat_cap_red', pg_temp.at(1, 13));
insert into public.daily_steps (user_id, day, steps)
select pg_temp.u(2), current_date - d, 11000 from generate_series(2, 19) d;
insert into public.coin_transactions (user_id, amount, reason, ref, created_at)
select pg_temp.u(2), 150, 'daily_goal', (current_date - d)::text, pg_temp.at(d, 8) from generate_series(2, 19) d;

set local role authenticated;
select pg_temp.as_user(1);
create temp table day1 on commit drop as
select l from jsonb_array_elements(public.activity_feed(current_date)) l
where (l->>'day')::date = current_date - 1;
reset role;

select is((select count(*)::integer from day1), 5, 'five things on one day: five lines');
select is((select array_agg(l->>'kind' || ':' || (l->>'ref') order by ord) from
             (select l, row_number() over () as ord from day1) x),
          array['purchase:hat_cap_red', 'purchase:cape_red', 'achievement:streak_7',
                'achievement:first_10k', 'goal:'],
          'newest first; two achievements at the same moment in a fixed order');
select is((select l->'items' from day1 where l->>'ref' = 'cape_red'), '["cape_red"]'::jsonb,
          'a purchase line has just its item');
select is((select l->'achievements' from day1 where l->>'ref' = 'streak_7'), '["streak_7"]'::jsonb,
          'an achievement line has just its achievement');
select is((select (l->>'goal')::boolean from day1 where l->>'kind' = 'goal'), true, 'the goal line');
select is((select count(*)::integer from day1 where (l->>'goal')::boolean), 1, '...and only it has the goal');

-- Pages: 18 goal days + 5 lines = 23, so two pages with no line twice
set local role authenticated;
select pg_temp.as_user(1);
create temp table pages on commit drop as
with p1 as (select public.activity_feed(current_date) as f),
     last as (select (select f from p1)->19 as l)
select l from jsonb_array_elements((select f from p1)) l
union all
select l from jsonb_array_elements(public.activity_feed(current_date,
  ((select l from last)->>'day')::date, ((select l from last)->>'at')::timestamptz,
  ((select l from last)->>'user_id')::uuid, (select l from last)->>'kind', (select l from last)->>'ref')) l;
select throws_ok($$ select public.activity_feed(current_date, current_date, now(), pg_temp.u(2)) $$,
                 'BAD_CURSOR', 'a cursor without kind and ref is refused');
reset role;
select is((select count(*)::integer from pages), 23, 'two pages hold every line');
select is((select count(distinct (l->>'day') || (l->>'kind') || (l->>'ref'))::integer from pages), 23,
          '...each once');

-- Kudos per line
set local role authenticated;
select pg_temp.as_user(1);
select is(public.give_kudos(pg_temp.u(2), current_date - 1, 'purchase', 'cape_red', current_date), 1,
          'kudos on one purchase');
select is((select (l->>'kudos')::integer from jsonb_array_elements(public.activity_feed(current_date)) l
           where l->>'ref' = 'hat_cap_red'), 0, '...not on the other one that day');
select throws_ok($$ select public.give_kudos(pg_temp.u(2), current_date - 1, 'purchase', 'pet_snail', current_date) $$,
                 'NO_SUCH_LINE', 'none on an item they didn''t buy');
select throws_ok($$ select public.give_kudos(pg_temp.u(2), current_date - 1, 'achievement', 'big_day', current_date) $$,
                 'NO_SUCH_LINE', 'none on an achievement they didn''t earn');
-- An older build: kudos on the day, which goes on its goal line
select is(public.give_kudos(pg_temp.u(2), current_date - 1, current_date), 1, 'an older build''s kudos');
select is((select (l->>'kudos')::integer from jsonb_array_elements(public.activity_feed(current_date)) l
           where (l->>'day')::date = current_date - 1 and l->>'kind' = 'goal'), 1,
          '...lands on that day''s goal line');
select is((select (l->>'kudos')::integer from jsonb_array_elements(public.friends_activity(current_date)) l
           where (l->>'day')::date = current_date - 1), 1,
          'an older build''s board counts A once for the day, though on two of its lines');

-- F's own lists
select pg_temp.as_user(2);
select is((select jsonb_agg(g->>'user_id') from jsonb_array_elements(
             public.line_kudos(current_date - 1, 'purchase', 'cape_red', current_date)) g),
          jsonb_build_array(pg_temp.u(1)), 'who gave kudos on that one line');
reset role;

select * from finish();
rollback;
