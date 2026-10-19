-- step-tracker-activity-board.txt, section 2: shop purchases on the
-- board. Run with `supabase test db`.
--
-- Days are counted back from the database's date (T = current_date).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- 1 A: the viewer, 2 F: A's friend, 3 S: a stranger
insert into auth.users (id, email)
select ('000000' || lpad(to_hex(n), 2, '0') || '-b0f7-0000-0000-000000000000')::uuid,
       'buy' || n || '@test.dev'
from generate_series(1, 3) n;
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'buy_' || substr(id::text, 7, 2)
where id::text like '%-b0f7-%';

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-b0f7-0000-0000-000000000000')::uuid
$$;
alter table public.daily_steps disable trigger daily_steps_check;
-- An item bought on the shop day T-ago, at that hour in the shop's time
-- zone: the owned item and its 'purchase' coin row
create function pg_temp.buy(who integer, item text, ago integer, hour integer)
returns void language sql as $$
  insert into public.user_items (user_id, item_id) values (pg_temp.u(who), item);
  insert into public.coin_transactions (user_id, amount, reason, ref, created_at)
  values (pg_temp.u(who), -(select price from public.shop_items where id = item), 'purchase', item,
          ((current_date - ago)::timestamp + make_interval(hours => hour)) at time zone 'America/Los_Angeles');
$$;
create function pg_temp.goal_day(who integer, ago integer)
returns void language sql as $$
  insert into public.daily_steps (user_id, day, steps) values (pg_temp.u(who), current_date - ago, 11000);
  insert into public.coin_transactions (user_id, amount, reason, ref, created_at)
  values (pg_temp.u(who), 150, 'daily_goal', (current_date - ago)::text,
          ((current_date - ago)::timestamp + interval '8 hours') at time zone 'America/Los_Angeles');
$$;
create function pg_temp.as_user(who integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(who)::text, true)
$$;
create function pg_temp.line(lines jsonb, who integer, ago integer) returns jsonb language sql as $$
  select l from jsonb_array_elements(lines) l
  where (l->>'user_id')::uuid = pg_temp.u(who) and (l->>'day')::date = current_date - ago
$$;

update public.app_settings set value = (current_date - 20) - date '2000-01-01'
where key = 'goal_is_coin_target_from';
insert into public.friendships (requester_id, addressee_id, status)
values (pg_temp.u(1), pg_temp.u(2), 'accepted');

-- F: a purchase alone on T-1; the goal on T-2 and two purchases later that
-- day; on T-3 an item since taken out of the game (refunded, no longer
-- owned); on T-4 a free item given without a purchase; on T-5 a purchase
-- at 11pm in the shop's time zone (already the next day in UTC)
select pg_temp.buy(2, 'cape_red', 1, 12);
select pg_temp.goal_day(2, 2);
select pg_temp.buy(2, 'bottom_pants_black', 2, 13);
select pg_temp.buy(2, 'bottom_pants_white', 2, 14);
select pg_temp.buy(2, 'bottom_skirt_plaid', 3, 12);
delete from public.user_items where user_id = pg_temp.u(2) and item_id = 'bottom_skirt_plaid';
insert into public.user_items (user_id, item_id) values (pg_temp.u(2), 'bottom_track_red');
select pg_temp.buy(2, 'bottom_cargo_khaki', 5, 23);
-- A buys today; S, a stranger, buys yesterday
select pg_temp.buy(1, 'cape_red', 0, 9);
select pg_temp.buy(3, 'cape_red', 1, 12);

set local role authenticated;
select pg_temp.as_user(1);
create temp table a_feed on commit drop as select public.friends_activity(current_date) as f;
reset role;

select is(pg_temp.line((select f from a_feed), 2, 1)->'items', '["cape_red"]'::jsonb,
          'a purchase on its own makes a line');
select is((pg_temp.line((select f from a_feed), 2, 1)->>'goal')::boolean, false, '...without the goal');
select is(pg_temp.line((select f from a_feed), 2, 2)->'items', '["bottom_pants_black", "bottom_pants_white"]'::jsonb,
          'purchases join the goal''s line for that day, oldest first');
select is((pg_temp.line((select f from a_feed), 2, 2)->>'goal')::boolean, true, '...one line, with the goal');
select is((pg_temp.line((select f from a_feed), 2, 2)->>'at')::timestamptz,
          ((current_date - 2)::timestamp + interval '14 hours') at time zone 'America/Los_Angeles',
          'the line''s time is its latest part: the last purchase');
select is(pg_temp.line((select f from a_feed), 2, 3), null, 'an item no longer owned (refunded) makes no line');
select is(pg_temp.line((select f from a_feed), 2, 4), null, 'an item given free, with no purchase, makes no line');
select is(pg_temp.line((select f from a_feed), 2, 5)->'items', '["bottom_cargo_khaki"]'::jsonb,
          'a purchase is on the shop''s day, not the UTC day');
select is(pg_temp.line((select f from a_feed), 1, 0)->'items', '["cape_red"]'::jsonb, 'your own purchases show');
select is(pg_temp.line((select f from a_feed), 1, 0)->'coins', 'null'::jsonb,
          '...with no coins: a purchase isn''t a payout');
select is((select count(*)::integer from jsonb_array_elements((select f from a_feed)) l
           where (l->>'user_id')::uuid = pg_temp.u(3)), 0, 'a stranger''s purchase never shows');
select ok((select f from a_feed)::text not like '%-1200%' and (select f from a_feed)::text not like '%price%',
          'no price anywhere in the answer');
select is(pg_temp.line((select f from a_feed), 2, 0), null, 'a goal-free, purchase-free day still has no line');

-- Kudos on a purchase-only line, and F's "New kudos" list describes it
set local role authenticated;
select pg_temp.as_user(1);
select is(public.give_kudos(pg_temp.u(2), current_date - 1, current_date), 1,
          'kudos on a purchase-only line');
select throws_ok($$ select public.give_kudos(pg_temp.u(2), current_date - 3, current_date) $$,
                 'NO_SUCH_LINE', 'none on a refunded purchase');
select pg_temp.as_user(2);
select is((select l->'items' from jsonb_array_elements(public.new_kudos(current_date)->'lines') l
           where (l->>'day')::date = current_date - 1),
          '["cape_red"]'::jsonb, 'the "New kudos" list has the line''s items');
reset role;

select * from finish();
rollback;
