-- The daily roll (step-tracker-daily-roll.txt): one free roll for reaching
-- the day's goal, instead of the 150 daily coins. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

-- U1-U4 share steps; U5 doesn't. U1 and U2 are friends.
insert into auth.users (id, email)
select ('000000' || lpad(to_hex(n), 2, '0') || '-0011-0000-0000-000000000000')::uuid, 'roll' || n || '@test.dev'
from generate_series(1, 5) n;
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'roll_' || substr(id::text, 7, 2)
where id::text like '%-0011-0000-%';
update public.profiles set sharing_consent_at = null where id = '00000005-0011-0000-0000-000000000000';

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-0011-0000-0000-000000000000')::uuid
$$;
create function pg_temp.as_user(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(n)::text, true)
$$;
create function pg_temp.today(steps integer) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('day', current_date, 'steps', steps))
$$;
-- The roll's pool for a player: on sale, not an achievement item, not owned
create function pg_temp.pool(p_user uuid) returns table (id text) language sql as $$
  select s.id from public.shop_items s
  where s.active and s.unlocked_by is null and s.price is not null
    and not exists (select 1 from public.user_items u where u.user_id = p_user and u.item_id = s.id)
$$;

insert into public.friendships (requester_id, addressee_id, status)
values (pg_temp.u(1), pg_temp.u(2), 'accepted');
alter table public.daily_steps disable trigger daily_steps_check;

-- ---------------------------------------------------------------------
-- Rarity from the price, and the chances
-- ---------------------------------------------------------------------
select is(array(select public.roll_rarity(p) from unnest(array[300, 400, 500, 700, 800, 1200, 1500, 2000, 2500, 3000]) p),
          array['common', 'common', 'uncommon', 'uncommon', 'rare', 'rare', 'epic', 'epic', 'legendary', 'legendary'],
          'rarity follows the price ladder');

select is(public.roll_outcome(array['common', 'uncommon', 'rare', 'epic', 'legendary'], 0.39), 'coins',
          'under 0.4 is coins');
select is(public.roll_outcome(array['common', 'uncommon', 'rare', 'epic', 'legendary'], 0.4), 'common',
          '0.4 starts the items');
select is(public.roll_outcome(array['common', 'uncommon', 'rare', 'epic', 'legendary'], 0.9999), 'legendary',
          'the top is legendary');
select is(public.roll_outcome('{}', 0.99), 'coins', 'nothing left: coins');
select is(public.roll_outcome(array['legendary'], 0.39), 'coins', 'only legendaries left: coins stay 40%');
select is(public.roll_outcome(array['legendary'], 0.4), 'legendary', '...and the rest is legendary');

create temp table draws as
select public.roll_outcome(array['common', 'uncommon', 'rare', 'epic', 'legendary'], random()) as o
from generate_series(1, 10000);
select ok((select bool_and(abs(100.0 * (select count(*) from draws d where d.o = c.o) / 10000 - c.pct) <= 1.5)
           from (values ('coins', 40), ('common', 31), ('uncommon', 19), ('rare', 6), ('epic', 3), ('legendary', 1)) c(o, pct)),
          '10,000 rolls land within 1.5 points of each chance');
select ok((select abs(100.0 * count(*) filter (where o = 'uncommon') / count(*) - 100.0 * 19 / 29) <= 1.5
           from (select public.roll_outcome(array['uncommon', 'rare', 'epic', 'legendary'], 0.4 + 0.6 * random()) o
                 from generate_series(1, 10000)) x),
          'no commons left: their share goes to the others in proportion');
create temp table amounts as
select public.roll_coin_amount(random()) as a from generate_series(1, 10000);
select ok((select bool_and(abs(100.0 * (select count(*) from amounts m where m.a = c.a) / 10000 - c.pct) <= 2)
           from (values (100, 60), (250, 30), (500, 10)) c(a, pct)),
          'coin amounts land within 2 points of 60/30/10');

-- ---------------------------------------------------------------------
-- Off until the switch day is set
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(1);
select is((select (public.sync_day(current_date, pg_temp.today(20000)) ->> 'earned')::int), 150,
          'before the switch: a goal day pays 150 coins');
select is((select public.sync_day(current_date, '[]') -> 'roll'), 'null'::jsonb, '...and there is no roll');
select throws_ok($$ select * from public.roll_daily_prize(current_date) $$, 'ROLL_OFF', 'the roll is off');
reset role;

-- The switch: today. Yesterday stays a 150-coin day.
delete from public.coin_transactions where user_id = pg_temp.u(1);
update public.wallets set balance = 0 where user_id = pg_temp.u(1);
insert into public.app_settings (key, value) values ('daily_roll_from', current_date - date '2000-01-01');
insert into public.daily_steps (user_id, day, steps) values (pg_temp.u(2), current_date - 1, 20000);

-- ---------------------------------------------------------------------
-- Earning the roll
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(2);
select is((select public.sync_day(current_date, '[]') -> 'roll'), '{"state": "locked"}'::jsonb,
          'goal not reached: locked');
select throws_ok($$ select * from public.roll_daily_prize(current_date) $$, 'GOAL_NOT_REACHED',
                 'no goal row: no roll');
select is((select (public.sync_day(current_date, pg_temp.today(3000)) ->> 'earned')::int), 150,
          'the day before the switch still pays 150');

select pg_temp.as_user(1);
select is((select (public.sync_day(current_date, pg_temp.today(20000)) ->> 'earned')::int), 0,
          'from the switch day a goal day pays no coins');
select is((select amount from public.coin_transactions
           where user_id = pg_temp.u(1) and reason = 'daily_goal' and ref = current_date::text), 0,
          '...but its daily_goal row is written, at 0');
select is((select public.sync_day(current_date, '[]') -> 'roll'), '{"state": "ready"}'::jsonb,
          'goal reached: ready');

select throws_ok($$ select * from public.roll_daily_prize(current_date - 3) $$, 'BAD_DAY',
                 'a day that is not today anywhere');
select pg_temp.as_user(5);
select throws_ok($$ select * from public.roll_daily_prize(current_date) $$, 'NO_SHARING',
                 'not sharing: no roll');
select is(public.my_roll(current_date), null, '...and no roll state');

-- ---------------------------------------------------------------------
-- The roll
-- ---------------------------------------------------------------------
select pg_temp.as_user(1);
create temp table pool_before as select * from pg_temp.pool(pg_temp.u(1));
create temp table r1 as select * from public.roll_daily_prize(current_date);
select ok((select new from r1), 'the first roll is new');
select ok((select (item_id is null and rarity = 'coins' and coins in (100, 250, 500))
                  or (item_id in (select * from pool_before) and coins = 0)
           from r1),
          'the prize is coins, or an item from the pool');
select is((select count(*)::int from public.daily_rolls where user_id = pg_temp.u(1)), 1, 'it is saved');
select is((select amount from public.coin_transactions
           where user_id = pg_temp.u(1) and reason = 'roll' and ref = current_date::text),
          (select coins from r1), 'one roll row in the coin history, with the coins (0 for an item)');
select ok((select item_id is null or exists (select 1 from public.user_items u
                                             where u.user_id = pg_temp.u(1) and u.item_id = r1.item_id)
           from r1), 'a won item is owned');
select is((select balance from public.wallets where user_id = pg_temp.u(1)), (select coins from r1),
          'coins won are in the wallet');

create temp table r2 as select * from public.roll_daily_prize(current_date);
select ok(not (select new from r2), 'rolling again is not new');
select ok((select (r1.item_id is not distinct from r2.item_id) and r1.coins = r2.coins from r1, r2),
          '...and gives the same prize');
select is((select count(*)::int from public.coin_transactions where user_id = pg_temp.u(1) and reason = 'roll'), 1,
          '...with no second payout');

select is((select public.sync_day(current_date, '[]') -> 'roll' ->> 'state'), 'rolled', 'sync_day: rolled');
select is((select public.sync_day(current_date, '[]') -> 'roll' -> 'seen'), 'false'::jsonb, '...not seen yet');
select public.mark_roll_seen(current_date);
select is((select public.sync_day(current_date, '[]') -> 'roll' -> 'seen'), 'true'::jsonb, '...seen once shown');

-- ---------------------------------------------------------------------
-- The pool
-- ---------------------------------------------------------------------
reset role;
select ok((select item_id is null or rarity = public.roll_rarity((select price from public.shop_items where id = r1.item_id))
           from r1), 'an item comes with its rarity');
-- U3 owns everything it could win: always coins
insert into public.user_items (user_id, item_id) select pg_temp.u(3), id from pg_temp.pool(pg_temp.u(3));
-- U4 owns everything but one common item; one more item is retired
create temp table last_one as
select p.id from pg_temp.pool(pg_temp.u(4)) p
join public.shop_items s on s.id = p.id where public.roll_rarity(s.price) = 'common' order by id limit 1;
create temp table retired as
select id from pg_temp.pool(pg_temp.u(4)) where id <> (select id from last_one) order by id limit 1;
insert into public.user_items (user_id, item_id)
select pg_temp.u(4), id from pg_temp.pool(pg_temp.u(4))
where id not in (select id from last_one) and id not in (select id from retired);
update public.shop_items set active = false where id = (select id from retired);
grant select on last_one, retired to authenticated;
insert into public.daily_steps (user_id, day, steps) values (pg_temp.u(3), current_date, 20000), (pg_temp.u(4), current_date, 20000);

set local role authenticated;
select pg_temp.as_user(3);
select public.claim_daily_rewards();
select is((select rarity from public.roll_daily_prize(current_date)), 'coins', 'nothing left to win: coins');
select pg_temp.as_user(4);
select public.claim_daily_rewards();
select ok((select item_id is null or item_id = (select id from last_one) from public.roll_daily_prize(current_date)),
          'only the last item or coins: never owned, never retired');

-- ---------------------------------------------------------------------
-- The board and privacy
-- ---------------------------------------------------------------------
select pg_temp.as_user(1);
select is((select (l ->> 'prize_item') from jsonb_array_elements(public.activity_feed(current_date)) l
           where l ->> 'user_id' = pg_temp.u(1)::text and l ->> 'kind' = 'goal' and l ->> 'day' = current_date::text),
          (select item_id from r1), 'your goal line has the item won');
select is((select (l ->> 'prize_coins')::int from jsonb_array_elements(public.activity_feed(current_date)) l
           where l ->> 'user_id' = pg_temp.u(1)::text and l ->> 'kind' = 'goal' and l ->> 'day' = current_date::text),
          nullif((select coins from r1), 0), '...or the coins won');
select pg_temp.as_user(2);
select is((select (l ->> 'prize_item') from jsonb_array_elements(public.activity_feed(current_date)) l
           where l ->> 'user_id' = pg_temp.u(1)::text and l ->> 'kind' = 'goal' and l ->> 'day' = current_date::text),
          (select item_id from r1), 'a friend sees the item won');
select ok((select bool_and(l -> 'prize_coins' = 'null'::jsonb) from jsonb_array_elements(public.activity_feed(current_date)) l
           where l ->> 'user_id' = pg_temp.u(1)::text),
          '...but never the coins');
select is((select count(*)::int from public.daily_rolls where user_id = pg_temp.u(1)), 0,
          'other players can''t read your rolls');
reset role;

select ok(not has_function_privilege('anon', 'public.roll_daily_prize(date)', 'execute'),
          'signed-out callers can''t roll');
select ok(not has_function_privilege('authenticated', 'public.roll_outcome(text[], double precision)', 'execute'),
          'the chances are internal');

select * from finish();
rollback;
