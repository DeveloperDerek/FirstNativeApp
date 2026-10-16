-- The coin rebalance (step-tracker-decisions.txt, COIN-1 to COIN-4):
-- welcome bonus, check-in, shop refresh, quest coins and prices. Run with
-- `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- U1 is new and shares. U2 shares and has checked in before. U3 doesn't share.
insert into auth.users (id, email)
select ('000000' || lpad(to_hex(n), 2, '0') || '-c014-0000-0000-000000000000')::uuid,
       'cr' || n || '@test.dev'
from generate_series(1, 3) n;
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'coin_' || substr(id::text, 7, 2)
where id::text like '%-c014-%';
update public.profiles set sharing_consent_at = null where id = '00000003-c014-0000-0000-000000000000';
insert into public.wallets (user_id, balance, last_checkin_at)
values ('00000002-c014-0000-0000-000000000000', 50, now() - interval '7 hours');

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-c014-0000-0000-000000000000')::uuid
$$;
create function pg_temp.as_user(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(n)::text, true)
$$;
create function pg_temp.balance(n integer) returns integer language sql as $$
  select balance from public.wallets where user_id = pg_temp.u(n)
$$;

set local role authenticated;

-- WELCOME BONUS (COIN-1)
select pg_temp.as_user(1);
create temp table c1 as select * from public.claim_checkin();
select is((select granted from c1), 310, 'first check-in: 10 + 300 welcome');
select is((select welcome from c1), 300, '...and says how much was the welcome');
select is(pg_temp.balance(1), 310, '...in the wallet');
create temp table c2 as select * from public.claim_checkin();
select is((select granted from c2), 0, 'checking in again straight away pays nothing');
select is((select welcome from c2), 0, '...and no second welcome');

-- Someone who has checked in before gets the check-in only
select pg_temp.as_user(2);
create temp table c3 as select * from public.claim_checkin();
select is((select granted from c3), 10, 'a returning player: 10 coins');
select is((select welcome from c3), 0, '...no welcome bonus');
select is(pg_temp.balance(2), 60, '...in the wallet');

-- Not sharing: nothing, and the welcome waits until they do
select pg_temp.as_user(3);
create temp table c4 as select * from public.claim_checkin();
select is((select granted from c4), 0, 'not sharing: no coins');
select is((select welcome from c4), 0, '...and no welcome');

-- SHOP REFRESH (COIN-2)
select pg_temp.as_user(1);
select is((select granted from public.refresh_shop()), 10, 'a shop refresh pays 10 coins');

-- QUEST COINS (COIN-3)
reset role;
select is(public.quest_step_coins(10000, 8000), 100, '1 coin per 100 steps');
select is(public.quest_step_coins(20000, 8000), 120, '...counting up to 150% of the goal');
select is(public.quest_coins_each(12000, 8000, 2), 72, '2-member Sprint at 150%: 72 each');

-- PRICES (COIN-4)
select is((select price from public.shop_items where id = 'pet_slime'), 1500, 'pet_slime costs 1,500');
select is((select price from public.shop_items where id = 'map_neon'), 3000, 'map_neon costs 3,000');
select is_empty($$ select id from public.shop_items where price % 100 <> 0 $$,
                'every price is a round hundred');

select * from finish();
rollback;
