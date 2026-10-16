-- 20261119000000_starter_pets.sql: every new account starts with the dog
-- (the cat is free for everyone), recorded at 0 coins. And the sunflower
-- and surfboard are gone (20261118000000_remove_sunflower_surfboard.sql).
-- Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values ('000000a1-57a7-0000-0000-000000000000', 'starter@test.dev');

select ok(exists (select 1 from public.user_items
                  where user_id = '000000a1-57a7-0000-0000-000000000000' and item_id = 'pet_dog'),
          'a new account owns the dog');
select is((select amount from public.coin_transactions
           where user_id = '000000a1-57a7-0000-0000-000000000000' and reason = 'starter' and ref = 'pet_dog'),
          0, '...recorded in its coin history at 0 coins');
select is((select count(*)::int from public.coin_transactions
           where user_id = '000000a1-57a7-0000-0000-000000000000'),
          1, 'and nothing else in it');
select ok(not exists (select 1 from public.shop_items where id = 'pet_cat'),
          'the cat needs no grant: it is free for everyone');
select ok(exists (select 1 from public.shop_items where id = 'pet_dog'),
          'the dog stays in the shop for older accounts');
select is((select count(*)::int from public.shop_items where id in ('hand_sunflower', 'hand_surfboard')),
          0, 'the sunflower and surfboard are gone from the shop');

select * from finish();
rollback;
