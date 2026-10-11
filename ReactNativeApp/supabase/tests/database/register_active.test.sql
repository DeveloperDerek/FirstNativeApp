-- step-tracker-register.txt, section 11: NON-ACTIVE ACCOUNTS. An
-- unfinished account (U) and a blocked one (X, blocked after it already
-- had friends and a group) see nothing and do nothing, and nobody sees X.
-- (Terms-not-accepted accounts: register_terms.test.sql.)
begin;
create extension if not exists pgtap with schema extensions;
select plan(83);

-- A active, F active, U unfinished, X blocked later
insert into auth.users (id, email) values
  ('000000a1-0000-0000-0000-000000000000', 'a@test.dev'),
  ('000000f1-0000-0000-0000-000000000000', 'f@test.dev'),
  ('000000b1-0000-0000-0000-000000000000', 'u@test.dev'),
  ('000000c1-0000-0000-0000-000000000000', 'x@test.dev');

update public.profiles
set onboarded_at = now(), sharing_consent_at = now(),
    username = case id when '000000a1-0000-0000-0000-000000000000' then 'ann'
                       when '000000f1-0000-0000-0000-000000000000' then 'fred'
                       when '000000c1-0000-0000-0000-000000000000' then 'xavier'
                       else username end
where id in ('000000a1-0000-0000-0000-000000000000', '000000f1-0000-0000-0000-000000000000',
             '000000c1-0000-0000-0000-000000000000');

-- Everyone (including U and X) has data of every kind
insert into public.friendships (requester_id, addressee_id, status) values
  ('000000a1-0000-0000-0000-000000000000', '000000f1-0000-0000-0000-000000000000', 'accepted'),
  ('000000a1-0000-0000-0000-000000000000', '000000c1-0000-0000-0000-000000000000', 'accepted'),
  ('000000b1-0000-0000-0000-000000000000', '000000f1-0000-0000-0000-000000000000', 'accepted');

insert into public.groups (id, name, owner_id, invite_code) values
  ('000000e1-0000-0000-0000-000000000000', 'Walkers', '000000a1-0000-0000-0000-000000000000', 'walkers1');
insert into public.group_members (group_id, user_id) values
  ('000000e1-0000-0000-0000-000000000000', '000000f1-0000-0000-0000-000000000000'),
  ('000000e1-0000-0000-0000-000000000000', '000000b1-0000-0000-0000-000000000000'),
  ('000000e1-0000-0000-0000-000000000000', '000000c1-0000-0000-0000-000000000000');

insert into public.daily_steps (user_id, day, steps)
select u, current_date, 12000 from unnest(array[
  '000000a1-0000-0000-0000-000000000000', '000000f1-0000-0000-0000-000000000000',
  '000000b1-0000-0000-0000-000000000000', '000000c1-0000-0000-0000-000000000000']::uuid[]) u;

insert into public.wallets (user_id, balance)
select id, 500 from public.profiles
where id in ('000000a1-0000-0000-0000-000000000000', '000000f1-0000-0000-0000-000000000000',
             '000000b1-0000-0000-0000-000000000000', '000000c1-0000-0000-0000-000000000000');
insert into public.coin_transactions (user_id, amount, reason, ref)
select user_id, 500, 'test', 'test' from public.wallets;
insert into public.user_items (user_id, item_id)
select user_id, 'hat_cap_red' from public.wallets;
insert into public.last_seen (user_id)
select user_id from public.wallets;

insert into public.quests (id, group_id, type_id, start_asap, vote_deadline, goal)
values ('000000d1-0000-0000-0000-000000000000', '000000e1-0000-0000-0000-000000000000',
        'sprint', true, now() + interval '1 day', 8000);

-- X is blocked after a birthday correction (6f)
insert into public.profile_private (user_id, age_blocked_at)
values ('000000c1-0000-0000-0000-000000000000', now());

-- ---------------------------------------------------------------------
-- What U and X can and can't do. Same checks for both.
-- ---------------------------------------------------------------------
create function pg_temp.non_active_checks(who text) returns setof text language sql as $f$
  select is_empty($$ select 1 from public.profiles where id <> auth.uid() $$,
                  who || ': no other profiles')
  union all select isnt_empty($$ select 1 from public.profiles where id = auth.uid() $$,
                  who || ': own profile still readable')
  union all select is_empty($$ select 1 from public.friendships $$, who || ': no friendships')
  union all select is_empty($$ select 1 from public.groups $$, who || ': no groups')
  union all select is_empty($$ select 1 from public.group_members $$, who || ': no members')
  union all select is_empty($$ select 1 from public.daily_steps $$, who || ': no steps')
  union all select is_empty($$ select 1 from public.wallets $$, who || ': no wallet')
  union all select is_empty($$ select 1 from public.coin_transactions $$, who || ': no coin history')
  union all select is_empty($$ select 1 from public.user_items $$, who || ': no owned items')
  union all select is_empty($$ select 1 from public.shop_items $$, who || ': no shop')
  union all select is_empty($$ select 1 from public.last_seen $$, who || ': no last seen')
  union all select is_empty($$ select 1 from public.quests $$, who || ': no quests')
  union all select is_empty($$ select 1 from public.quest_types $$, who || ': no quest types')
  union all select is_empty($$ select * from public.friends_leaderboard(current_date, current_date) $$,
                  who || ': friends leaderboard empty')
  union all select is_empty($$ select * from public.group_leaderboard(
                    '000000e1-0000-0000-0000-000000000000', current_date, current_date) $$,
                  who || ': group leaderboard empty')
  union all select throws_ok($$ select * from public.daily_shop() $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': daily_shop refuses')
  union all select throws_ok($$ select public.purchase_item('hat_crown_gold') $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': purchase_item refuses')
  union all select throws_ok($$ select public.claim_daily_rewards() $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': claim_daily_rewards refuses')
  union all select throws_ok($$ select * from public.claim_checkin() $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': claim_checkin refuses')
  union all select throws_ok($$ select * from public.refresh_shop() $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': refresh_shop refuses')
  union all select throws_ok($$ select public.join_group('walkers1') $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': join_group refuses')
  union all select throws_ok($$ select public.mark_seen() $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': mark_seen refuses')
  union all select throws_ok($$ select public.propose_quest(
                    '000000e1-0000-0000-0000-000000000000', 'sprint', null) $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': propose_quest refuses')
  union all select throws_ok($$ select public.vote_quest('000000d1-0000-0000-0000-000000000000', true) $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': vote_quest refuses')
  union all select throws_ok($$ select public.upload_quest_steps(
                    '000000d1-0000-0000-0000-000000000000', '[]') $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': upload_quest_steps refuses')
  union all select throws_ok($$ select public.group_quest('000000e1-0000-0000-0000-000000000000') $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': group_quest refuses')
  union all select throws_ok($$ select * from public.my_quests() $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': my_quests refuses')
  union all select throws_ok($$ select public.mark_quest_seen('000000d1-0000-0000-0000-000000000000') $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': mark_quest_seen refuses')
  union all select throws_ok($$ select public.change_username('new_name_1') $$,
                  'ACCOUNT_NOT_ACTIVE', who || ': change_username refuses')
  union all select throws_ok($$ insert into public.friendships (requester_id, addressee_id)
                    values (auth.uid(), '000000a1-0000-0000-0000-000000000000') $$,
                  '42501', null, who || ': cannot send friend requests')
  union all select throws_ok($$ insert into public.groups (name, owner_id) values ('G', auth.uid()) $$,
                  '42501', null, who || ': cannot create groups')
  union all select throws_ok($$ insert into public.daily_steps (user_id, day, steps)
                    values (auth.uid(), current_date - 1, 100) $$,
                  '42501', null, who || ': cannot upload steps')
$f$;

set local request.jwt.claim.sub = '000000b1-0000-0000-0000-000000000000';
set local role authenticated;
select * from pg_temp.non_active_checks('unfinished');
select is(public.username_available('free_name'), true, 'unfinished: username_available works');

set local request.jwt.claim.sub = '000000c1-0000-0000-0000-000000000000';
select * from pg_temp.non_active_checks('blocked');
select throws_ok($$ select public.username_available('free_name') $$,
                 'AGE_BLOCKED', 'blocked: username_available refuses');
select throws_ok($$ select public.complete_signup('free_name', 'X', '1990-01-01') $$,
                 'AGE_BLOCKED', 'blocked: complete_signup refuses');

-- ---------------------------------------------------------------------
-- A (active) doesn't see X or U anywhere, even though X was a friend
-- ---------------------------------------------------------------------
set local request.jwt.claim.sub = '000000a1-0000-0000-0000-000000000000';

select results_eq(
  -- only this test's people, so other rows in a dev database don't matter
  $$ select username from public.profiles where username ilike '%'
       and id in ('000000a1-0000-0000-0000-000000000000', '000000f1-0000-0000-0000-000000000000',
                  '000000b1-0000-0000-0000-000000000000', '000000c1-0000-0000-0000-000000000000')
     order by 1 $$,
  $$ values ('ann'::text), ('fred'::text) $$,
  'search finds only active people');
select is_empty(
  $$ select 1 from public.profiles where id = '000000c1-0000-0000-0000-000000000000' $$,
  'the player card for X loads nothing');
select results_eq(
  $$ select count(*)::int from public.friendships $$, $$ values (1) $$,
  'the friendship with X is hidden');
select results_eq(
  $$ select user_id from public.group_members order by 1 $$,
  $$ values ('000000a1-0000-0000-0000-000000000000'::uuid), ('000000f1-0000-0000-0000-000000000000'::uuid) $$,
  'group members leave out X and U');
select results_eq(
  $$ select user_id from public.group_leaderboard(
       '000000e1-0000-0000-0000-000000000000', current_date, current_date) order by 1 $$,
  $$ values ('000000a1-0000-0000-0000-000000000000'::uuid), ('000000f1-0000-0000-0000-000000000000'::uuid) $$,
  'the group leaderboard leaves out X and U');
select results_eq(
  $$ select user_id from public.friends_leaderboard(current_date, current_date) order by 1 $$,
  $$ values ('000000a1-0000-0000-0000-000000000000'::uuid), ('000000f1-0000-0000-0000-000000000000'::uuid) $$,
  'the friends leaderboard leaves out X');
select is_empty(
  $$ select 1 from public.daily_steps where user_id = '000000c1-0000-0000-0000-000000000000' $$,
  'X''s steps are hidden');
select is_empty(
  $$ select 1 from public.last_seen where user_id = '000000c1-0000-0000-0000-000000000000' $$,
  'X''s last seen is hidden');
select is(
  (select array_agg(m->>'user_id' order by m->>'user_id')
   from jsonb_array_elements(public.group_quest('000000e1-0000-0000-0000-000000000000') -> 'members') m),
  array['000000a1-0000-0000-0000-000000000000', '000000f1-0000-0000-0000-000000000000'],
  'quest members leave out X and U');
select is(
  (select waiting_for from public.my_quests()
   where quest_id = '000000d1-0000-0000-0000-000000000000'),
  -- display names come from the emails: a@ and f@
  array['a', 'f'],
  'the quest waits only for active members who have not voted');
select throws_ok(
  $$ insert into public.friendships (requester_id, addressee_id)
     values (auth.uid(), '000000b1-0000-0000-0000-000000000000') $$,
  '42501', null, 'nobody can send a friend request to a non-active account');

-- Active accounts still work as before
select lives_ok($$ select * from public.daily_shop() $$, 'active: daily_shop works');
select lives_ok($$ select public.mark_seen() $$, 'active: mark_seen works');
select is(public.vote_quest('000000d1-0000-0000-0000-000000000000', true), 'voting',
          'active: voting works (F still has to answer)');

set local request.jwt.claim.sub = '000000f1-0000-0000-0000-000000000000';
select is(public.vote_quest('000000d1-0000-0000-0000-000000000000', true), 'active',
          'the quest starts once every ACTIVE member has accepted');
reset role;
select is((select party_size from public.quests where id = '000000d1-0000-0000-0000-000000000000'),
          2, 'the party is the active members');

select * from finish();
rollback;
