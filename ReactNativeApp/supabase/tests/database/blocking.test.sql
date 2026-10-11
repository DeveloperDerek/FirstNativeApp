-- step-tracker-safety.txt, sections 2, 3 and 10: blocking. Reads go
-- straight at the tables as each person, not through the app. (Two
-- sessions racing a request against a block: supabase/tests/concurrency.)
-- Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(79);

-- A, B, C active; N active but in no group; U unfinished; X under age.
-- P1-P7: one per friendship state, for the block table in section 3.
insert into auth.users (id, email) values
  ('0000000a-b10c-0000-0000-000000000000', 'a@test.dev'),
  ('0000000b-b10c-0000-0000-000000000000', 'b@test.dev'),
  ('0000000c-b10c-0000-0000-000000000000', 'c@test.dev'),
  ('0000000e-b10c-0000-0000-000000000000', 'n@test.dev'),
  ('0000000d-b10c-0000-0000-000000000000', 'u@test.dev'),
  ('0000000f-b10c-0000-0000-000000000000', 'x@test.dev'),
  ('00000001-b10c-0000-0000-000000000000', 'p1@test.dev'),
  ('00000002-b10c-0000-0000-000000000000', 'p2@test.dev'),
  ('00000003-b10c-0000-0000-000000000000', 'p3@test.dev'),
  ('00000004-b10c-0000-0000-000000000000', 'p4@test.dev'),
  ('00000005-b10c-0000-0000-000000000000', 'p5@test.dev'),
  ('00000006-b10c-0000-0000-000000000000', 'p6@test.dev'),
  ('00000007-b10c-0000-0000-000000000000', 'p7@test.dev');

update public.profiles
set onboarded_at = now(), sharing_consent_at = now(),
    username = 'blk_' || substr(id::text, 8, 1),
    display_name = 'Person ' || substr(id::text, 8, 1)
where id::text like '%-b10c-%' and id <> '0000000d-b10c-0000-0000-000000000000';
insert into public.profile_private (user_id, age_blocked_at)
values ('0000000f-b10c-0000-0000-000000000000', now());

-- Group G: A (owner), B, C, U, X. Group H: C only.
insert into public.groups (id, name, owner_id, invite_code) values
  ('0000006a-b10c-0000-0000-000000000000', 'G', '0000000a-b10c-0000-0000-000000000000', 'blkgrp01'),
  ('0000006b-b10c-0000-0000-000000000000', 'H', '0000000c-b10c-0000-0000-000000000000', 'blkgrp02');
insert into public.group_members (group_id, user_id) values
  ('0000006a-b10c-0000-0000-000000000000', '0000000b-b10c-0000-0000-000000000000'),
  ('0000006a-b10c-0000-0000-000000000000', '0000000c-b10c-0000-0000-000000000000'),
  ('0000006a-b10c-0000-0000-000000000000', '0000000d-b10c-0000-0000-000000000000'),
  ('0000006a-b10c-0000-0000-000000000000', '0000000f-b10c-0000-0000-000000000000');

-- B walked every day from 12 days ago to tomorrow: 2^n steps on day n,
-- so any total says exactly which days it covers. (Skips the step-row
-- trigger, which only accepts recent days.)
set local session_replication_role = replica;
insert into public.daily_steps (user_id, day, steps)
select '0000000b-b10c-0000-0000-000000000000', current_date - 12 + n, (2 ^ n)::int
from generate_series(0, 13) n;
set local session_replication_role = origin;
insert into public.last_seen (user_id) values ('0000000b-b10c-0000-0000-000000000000');

-- Which days a total of B's steps covers
create function pg_temp.days_in(total bigint) returns date[] language sql as $$
  select coalesce(array_agg(current_date - 12 + n order by n), '{}')
  from generate_series(0, 13) n where (total >> n) & 1 = 1
$$;
create function pg_temp.b_total(gid uuid, period text, d date) returns bigint language sql as $$
  select total_steps from public.group_leaderboard(gid, period, d)
  where user_id = '0000000b-b10c-0000-0000-000000000000'
$$;

-- ---------------------------------------------------------------------
-- Before any block: group mates who aren't friends
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '0000000a-b10c-0000-0000-000000000000';

select isnt_empty($$ select 1 from public.profiles where id = '0000000b-b10c-0000-0000-000000000000' $$,
                  'A sees B''s profile');
select is_empty($$ select 1 from public.daily_steps where user_id = '0000000b-b10c-0000-0000-000000000000' $$,
                'a group mate who isn''t a friend can''t read steps from the table any more');
select is_empty($$ select 1 from public.last_seen where user_id = '0000000b-b10c-0000-0000-000000000000' $$,
                '...nor last seen');
select is(pg_temp.b_total('0000006a-b10c-0000-0000-000000000000', 'today', current_date), 4096::bigint,
          'the group leaderboard still shows B''s steps for today');

-- ---------------------------------------------------------------------
-- A blocks B (they share group G)
-- ---------------------------------------------------------------------
select lives_ok($$ select public.block_user('0000000b-b10c-0000-0000-000000000000') $$, 'A blocks B');
select lives_ok($$ select public.block_user('0000000b-b10c-0000-0000-000000000000') $$, 'blocking twice does nothing');
select lives_ok($$ select public.block_user(auth.uid()) $$, 'blocking yourself does nothing');
select is((select count(*)::int from public.user_blocks), 1, 'one block row');

select is_empty($$ select 1 from public.profiles where id = '0000000b-b10c-0000-0000-000000000000' $$,
                'A: B''s profile is gone, despite the shared group');
select is_empty($$ select 1 from public.profiles where username = 'blk_b' $$, 'A: search doesn''t find B');
select is(public.can_see('0000000b-b10c-0000-0000-000000000000'), false, 'A: can_see(B) is false');

set local request.jwt.claim.sub = '0000000b-b10c-0000-0000-000000000000';
select is_empty($$ select 1 from public.profiles where id = '0000000a-b10c-0000-0000-000000000000' $$,
                'B: A''s profile is gone too (both ways)');
select is_empty($$ select 1 from public.profiles where username = 'blk_a' $$, 'B: search doesn''t find A');
select is_empty($$ select 1 from public.user_blocks $$, 'B can''t read the block that names B');
select is(public.can_see('0000000a-b10c-0000-0000-000000000000'), false, 'B: can_see(A) is false...');
select is(public.can_see('0000000f-b10c-0000-0000-000000000000'), false, '...the same as for an under-age account');
select is(public.can_see('0000000d-b10c-0000-0000-000000000000'), false, '...an unfinished one');
select is(public.can_see('99999999-0000-0000-0000-000000000000'), false, '...and one that doesn''t exist');

-- A third person sees both as normal
set local request.jwt.claim.sub = '0000000c-b10c-0000-0000-000000000000';
select is((select count(*)::int from public.profiles
           where id in ('0000000a-b10c-0000-0000-000000000000', '0000000b-b10c-0000-0000-000000000000')),
          2, 'C still sees both A and B');
select results_eq($$ select username from public.profiles where username in ('blk_a', 'blk_b') order by 1 $$,
                  $$ values ('blk_a'::text), ('blk_b') $$,
                  'C''s search finds both (so the searches above are real)');

-- ---------------------------------------------------------------------
-- Inside group G they still see each other, through group functions only
-- ---------------------------------------------------------------------
set local request.jwt.claim.sub = '0000000a-b10c-0000-0000-000000000000';
select results_eq(
  $$ select user_id from public.group_leaderboard('0000006a-b10c-0000-0000-000000000000', 'today', current_date)
     order by 1 $$,
  $$ values ('0000000a-b10c-0000-0000-000000000000'::uuid), ('0000000b-b10c-0000-0000-000000000000'::uuid),
            ('0000000c-b10c-0000-0000-000000000000'::uuid) $$,
  'A: the group leaderboard shows B, and leaves out U and X');
select results_eq(
  $$ select (m->>'user_id')::uuid
     from jsonb_array_elements(public.group_quest('0000006a-b10c-0000-0000-000000000000')->'members') m
     order by 1 $$,
  $$ values ('0000000a-b10c-0000-0000-000000000000'::uuid), ('0000000b-b10c-0000-0000-000000000000'::uuid),
            ('0000000c-b10c-0000-0000-000000000000'::uuid) $$,
  'A: group_quest shows B, and leaves out U and X');
select is((public.group_member_card('0000006a-b10c-0000-0000-000000000000',
            '0000000b-b10c-0000-0000-000000000000', current_date)->>'blocked_by_me')::boolean,
          true, 'A: B''s card in the group says A blocked B');
select is((public.group_member_card('0000006a-b10c-0000-0000-000000000000',
            '0000000b-b10c-0000-0000-000000000000', current_date)->>'today_steps')::int,
          4096, 'A: the card shows B''s steps today');
select is_empty($$ select 1 from public.daily_steps where user_id = '0000000b-b10c-0000-0000-000000000000' $$,
                'A: the same steps are still not readable from the table');

set local request.jwt.claim.sub = '0000000b-b10c-0000-0000-000000000000';
select is((public.group_member_card('0000006a-b10c-0000-0000-000000000000',
            '0000000a-b10c-0000-0000-000000000000', current_date)->>'blocked_by_me')::boolean,
          false, 'B: A''s card says nothing (B is the one who was blocked)');
select is((public.group_member_card('0000006a-b10c-0000-0000-000000000000',
            '0000000c-b10c-0000-0000-000000000000', current_date)->>'blocked_by_me')::boolean,
          false, 'B: the same as for any other member');

-- Exact fields, run as the blocked group mate (when the extra rights matter)
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.group_member_card(
     '0000006a-b10c-0000-0000-000000000000', '0000000a-b10c-0000-0000-000000000000', current_date)) k),
  array['avatar', 'blocked_by_me', 'display_name', 'last_seen', 'map_theme', 'today_steps',
        'user_id', 'username', 'week_steps'],
  'group_member_card returns only the approved fields');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     public.group_quest('0000006a-b10c-0000-0000-000000000000')) k),
  array['members', 'next_quest_at', 'quest', 'server_now'],
  'group_quest returns only the approved top-level fields');
select is(
  (select array_agg(distinct k order by k)
   from jsonb_array_elements(public.group_quest('0000006a-b10c-0000-0000-000000000000')->'members') m,
        jsonb_object_keys(m) k),
  array['accepted', 'avatar', 'coins_paid', 'display_name', 'in_group', 'in_party', 'last_seen',
        'sharing', 'steps', 'uploaded_at', 'user_id'],
  'group_quest members have only the approved fields');
select is(pg_get_function_result('public.group_leaderboard(uuid,text,date)'::regprocedure),
          'TABLE(user_id uuid, display_name text, avatar jsonb, total_steps bigint)',
          'group_leaderboard returns only name, character and total');

-- Refused outside the group, and for people not in it
set local request.jwt.claim.sub = '0000000a-b10c-0000-0000-000000000000';
select throws_ok($$ select * from public.group_leaderboard('0000006b-b10c-0000-0000-000000000000', 'today', current_date) $$,
                 'NOT_A_MEMBER', 'a group you''re not in: leaderboard refused');
select throws_ok($$ select public.group_member_card('0000006b-b10c-0000-0000-000000000000',
                    '0000000c-b10c-0000-0000-000000000000', current_date) $$,
                 'NOT_A_MEMBER', 'a group you''re not in: card refused');
select throws_ok($$ select public.group_quest('0000006b-b10c-0000-0000-000000000000') $$,
                 'NOT_A_MEMBER', 'a group you''re not in: quest refused');
select throws_ok($$ select public.group_member_card('0000006a-b10c-0000-0000-000000000000',
                    '0000000e-b10c-0000-0000-000000000000', current_date) $$,
                 'NOT_A_MEMBER', 'someone not in your group: card refused, even naming your group');
select throws_ok($$ select public.group_member_card('0000006a-b10c-0000-0000-000000000000',
                    '0000000d-b10c-0000-0000-000000000000', current_date) $$,
                 'NOT_A_MEMBER', 'an unfinished member: card refused');
select throws_ok($$ select public.group_member_card('0000006a-b10c-0000-0000-000000000000',
                    '0000000f-b10c-0000-0000-000000000000', current_date) $$,
                 'NOT_A_MEMBER', 'an under-age member: card refused');

-- An inactive caller gets nothing from the group functions
set local request.jwt.claim.sub = '0000000f-b10c-0000-0000-000000000000';
select throws_ok($$ select * from public.group_leaderboard('0000006a-b10c-0000-0000-000000000000', 'today', current_date) $$,
                 'ACCOUNT_NOT_ACTIVE', 'under age: leaderboard refused');
select throws_ok($$ select public.group_member_card('0000006a-b10c-0000-0000-000000000000',
                    '0000000a-b10c-0000-0000-000000000000', current_date) $$,
                 'ACCOUNT_NOT_ACTIVE', 'under age: card refused');
select is_empty($$ select 1 from public.profiles where id = '0000000a-b10c-0000-0000-000000000000' $$,
                'under age: reads nobody else''s profile');

-- ---------------------------------------------------------------------
-- Periods and the window
-- ---------------------------------------------------------------------
set local request.jwt.claim.sub = '0000000a-b10c-0000-0000-000000000000';
select throws_ok($$ select * from public.group_leaderboard('0000006a-b10c-0000-0000-000000000000', 'month', current_date) $$,
                 'BAD_PERIOD', 'a period other than today / week is refused');
select throws_ok($$ select * from public.friends_leaderboard('year', current_date) $$,
                 'BAD_PERIOD', '...for friends too');
select throws_ok(format($$ select * from public.group_leaderboard('0000006a-b10c-0000-0000-000000000000', 'week', %L) $$,
                        (now() at time zone 'Etc/GMT+12')::date - 1),
                 'BAD_DAY', 'a date that is today nowhere (too early) is refused');
select throws_ok(format($$ select * from public.group_leaderboard('0000006a-b10c-0000-0000-000000000000', 'week', %L) $$,
                        (now() at time zone 'Etc/GMT-14')::date + 1),
                 'BAD_DAY', 'a date that is today nowhere (too late) is refused');
select throws_ok($$ select * from public.group_leaderboard('0000006a-b10c-0000-0000-000000000000', current_date - 30, current_date) $$,
                 'BAD_PERIOD', 'the old date call: any range but a day or a week is refused');
select is((select total_steps from public.group_leaderboard('0000006a-b10c-0000-0000-000000000000', current_date - 6, current_date)
           where user_id = '0000000b-b10c-0000-0000-000000000000'),
          pg_temp.b_total('0000006a-b10c-0000-0000-000000000000', 'week', current_date),
          'the old date call for 7 days is the week');

-- Every accepted my_today, both periods, all answers together
select is(
  (select bool_and(cardinality(pg_temp.days_in(pg_temp.b_total('0000006a-b10c-0000-0000-000000000000', 'week', d::date))) = 7)
   from generate_series((now() at time zone 'Etc/GMT+12')::date,
                        (now() at time zone 'Etc/GMT-14')::date, '1 day') d),
  true, 'each week answer is exactly 7 days');
select ok(
  (with seen as (
     select distinct unnest(pg_temp.days_in(pg_temp.b_total('0000006a-b10c-0000-0000-000000000000', p, d::date))) seen_day
     from generate_series((now() at time zone 'Etc/GMT+12')::date,
                          (now() at time zone 'Etc/GMT-14')::date, '1 day') d,
          unnest(array['today', 'week']) p)
   select count(*) <= 9
      and min(seen_day) >= (now() at time zone 'Etc/GMT+12')::date - 6
      and max(seen_day) <= (now() at time zone 'Etc/GMT-14')::date
   from seen),
  'all answers together stay inside the window (8-9 days, never older)');

-- The same at fixed moments, with two and with three valid dates
reset role;
create function pg_temp.window_days(at timestamptz) returns int language sql as $$
  select count(distinct seen_day)::int from (
    select generate_series(w.from_day, w.to_day, '1 day')::date seen_day
    from generate_series((at at time zone 'Etc/GMT+12')::date,
                         (at at time zone 'Etc/GMT-14')::date, '1 day') d,
         unnest(array['today', 'week']) p,
         public.step_period_at(p, d::date, at) w) x
$$;
select is(pg_temp.window_days('2026-10-10 15:00+00'), 8, 'two valid dates: 8 days in all');
select is(pg_temp.window_days('2026-10-10 11:00+00'), 9, 'three valid dates: 9 days in all');
select throws_ok($$ select * from public.step_period_at('week', '2026-10-12', '2026-10-10 11:00+00') $$,
                 'BAD_DAY', 'at that moment, the day after the three is refused');
select throws_ok($$ select * from public.step_period_at('week', '2026-10-08', '2026-10-10 11:00+00') $$,
                 'BAD_DAY', '...and the day before');

-- ---------------------------------------------------------------------
-- Blocks and friendships: every state (section 3)
-- ---------------------------------------------------------------------
insert into public.friendships (requester_id, addressee_id, status) values
  ('0000000a-b10c-0000-0000-000000000000', '00000001-b10c-0000-0000-000000000000', 'accepted'),
  ('0000000a-b10c-0000-0000-000000000000', '00000002-b10c-0000-0000-000000000000', 'pending'),
  ('00000003-b10c-0000-0000-000000000000', '0000000a-b10c-0000-0000-000000000000', 'pending'),
  ('0000000a-b10c-0000-0000-000000000000', '00000004-b10c-0000-0000-000000000000', 'declined'),
  ('0000000a-b10c-0000-0000-000000000000', '00000005-b10c-0000-0000-000000000000', 'cancelled'),
  ('0000000a-b10c-0000-0000-000000000000', '00000006-b10c-0000-0000-000000000000', 'removed');

set local role authenticated;
set local request.jwt.claim.sub = '0000000a-b10c-0000-0000-000000000000';
select is((public.notification_counts()->>'friend_requests')::int, 1, 'A has one request waiting (from P3)');
select lives_ok($$ select public.block_user(p) from unnest(array[
                  '00000001-b10c-0000-0000-000000000000', '00000002-b10c-0000-0000-000000000000',
                  '00000003-b10c-0000-0000-000000000000', '00000004-b10c-0000-0000-000000000000',
                  '00000005-b10c-0000-0000-000000000000', '00000006-b10c-0000-0000-000000000000',
                  '00000007-b10c-0000-0000-000000000000']::uuid[]) p $$,
                'A blocks P1-P7');
reset role;
select results_eq(
  $$ select substr(case when requester_id = '0000000a-b10c-0000-0000-000000000000'
                        then addressee_id else requester_id end::text, 1, 8), status
     from public.friendships
     where '0000000a-b10c-0000-0000-000000000000' in (requester_id, addressee_id)
       and (case when requester_id = '0000000a-b10c-0000-0000-000000000000'
                 then addressee_id else requester_id end)::text ~ '^0000000[1-6]-b10c-'
     order by 1 $$,
  $$ values ('00000001', 'removed'), ('00000002', 'cancelled'), ('00000003', 'declined'),
            ('00000004', 'declined'), ('00000005', 'cancelled'), ('00000006', 'removed') $$,
  'accepted -> removed; A''s request -> cancelled; theirs -> declined; ended ones unchanged');
select is_empty($$ select 1 from public.friendships where '00000007-b10c-0000-0000-000000000000' in (requester_id, addressee_id) $$,
                'no friendship: none made');

set local role authenticated;
select is((public.notification_counts()->>'friend_requests')::int, 0, 'A''s request badge drops to 0');

-- Neither can send a request; the refusal is the one for a missing account
select throws_ok($$ insert into public.friendships (requester_id, addressee_id)
                    values (auth.uid(), '0000000b-b10c-0000-0000-000000000000') $$,
                 '42501', 'new row violates row-level security policy for table "friendships"',
                 'A can''t send B a request');
set local request.jwt.claim.sub = '0000000b-b10c-0000-0000-000000000000';
select throws_ok($$ insert into public.friendships (requester_id, addressee_id)
                    values (auth.uid(), '0000000a-b10c-0000-0000-000000000000') $$,
                 '42501', 'new row violates row-level security policy for table "friendships"',
                 'B can''t send A a request');
select throws_ok($$ insert into public.friendships (requester_id, addressee_id)
                    values (auth.uid(), '99999999-0000-0000-0000-000000000000') $$,
                 '42501', 'new row violates row-level security policy for table "friendships"',
                 'the same error as for an account that doesn''t exist');

-- A request that got past the rules anyway (written directly) is not
-- counted and not pushed
reset role;
set local session_replication_role = replica;
insert into public.friendships (id, requester_id, addressee_id, status) values
  ('000000ff-b10c-0000-0000-000000000000', '0000000b-b10c-0000-0000-000000000000',
   '0000000a-b10c-0000-0000-000000000000', 'pending');
set local session_replication_role = origin;
select is((public.notification_counts_for('0000000a-b10c-0000-0000-000000000000')->>'friend_requests')::int, 0,
          'a request between a blocked pair is never counted');
-- A has a phone that would get the push if the block weren't checked
insert into public.push_devices (token, user_id, platform)
values ('ExponentPushToken[blocktest]', '0000000a-b10c-0000-0000-000000000000', 'ios');
select lives_ok($$ select public.push_friend_request('000000ff-b10c-0000-0000-000000000000') $$,
                'push for it runs');
select is_empty($$ select 1 from public.push_sends where 'ExponentPushToken[blocktest]' = any (tokens) $$,
                'and sends nothing');
delete from public.friendships where id = '000000ff-b10c-0000-0000-000000000000';

-- ---------------------------------------------------------------------
-- Unblocking, and blocks both ways
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '0000000a-b10c-0000-0000-000000000000';
select lives_ok($$ select public.unblock_user('0000000b-b10c-0000-0000-000000000000') $$, 'A unblocks B');
select isnt_empty($$ select 1 from public.profiles where id = '0000000b-b10c-0000-0000-000000000000' $$,
                  'A sees B again');
select is(public.is_friend('0000000b-b10c-0000-0000-000000000000'), false, 'but they aren''t friends');
set local request.jwt.claim.sub = '0000000b-b10c-0000-0000-000000000000';
select lives_ok($$ insert into public.friendships (requester_id, addressee_id)
                   values (auth.uid(), '0000000a-b10c-0000-0000-000000000000') $$,
                'B can send A a request again');

select lives_ok($$ select public.block_user('0000000a-b10c-0000-0000-000000000000') $$, 'now B blocks A');
set local request.jwt.claim.sub = '0000000a-b10c-0000-0000-000000000000';
select lives_ok($$ select public.block_user('0000000b-b10c-0000-0000-000000000000') $$, 'and A blocks B');
select lives_ok($$ select public.unblock_user('0000000b-b10c-0000-0000-000000000000') $$, 'A unblocks');
select is(public.can_see('0000000b-b10c-0000-0000-000000000000'), false, 'B''s block still holds');
select is_empty($$ select 1 from public.friendships
                   where status in ('pending', 'accepted')
                     and '0000000a-b10c-0000-0000-000000000000' in (requester_id, addressee_id)
                     and '0000000b-b10c-0000-0000-000000000000' in (requester_id, addressee_id) $$,
                'B''s block ended B''s new request');

-- my_blocks: your own list only
select results_eq($$ select user_id from public.my_blocks() order by 1 $$,
                  $$ select unnest(array[
                       '00000001-b10c-0000-0000-000000000000', '00000002-b10c-0000-0000-000000000000',
                       '00000003-b10c-0000-0000-000000000000', '00000004-b10c-0000-0000-000000000000',
                       '00000005-b10c-0000-0000-000000000000', '00000006-b10c-0000-0000-000000000000',
                       '00000007-b10c-0000-0000-000000000000']::uuid[]) order by 1 $$,
                  'A''s list: the seven A blocked, not B (who blocked A)');
set local request.jwt.claim.sub = '0000000b-b10c-0000-0000-000000000000';
select results_eq($$ select username from public.my_blocks() $$, $$ values ('blk_a'::text) $$,
                  'B''s list shows A''s username, though B can''t read A''s profile');

-- ---------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------
reset role;
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('is_blocked_between', 'lock_pair', 'step_period_at', 'friend_request_block_check')
          and (has_function_privilege('anon', p.oid, 'execute')
               or has_function_privilege('authenticated', p.oid, 'execute'))
        order by 1),
  '{}'::text[], 'internal block helpers can''t be called from the app');
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('can_see', 'block_user', 'unblock_user', 'my_blocks', 'step_period',
                            'group_leaderboard', 'friends_leaderboard', 'group_member_card')
          and has_function_privilege('anon', p.oid, 'execute')
        order by 1),
  '{}'::text[], 'the new app functions can''t be called signed out');
select is(
  array(select distinct p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('can_see', 'block_user', 'unblock_user', 'my_blocks', 'step_period',
                            'group_leaderboard', 'friends_leaderboard', 'group_member_card')
          and has_function_privilege('authenticated', p.oid, 'execute')
        order by 1),
  array['block_user', 'can_see', 'friends_leaderboard', 'group_leaderboard', 'group_member_card',
        'my_blocks', 'step_period', 'unblock_user'],
  'and they can be called signed in');
set local role authenticated;
select throws_ok($$ select public.is_blocked_between('0000000a-b10c-0000-0000-000000000000',
                    '0000000b-b10c-0000-0000-000000000000') $$,
                 '42501', null, 'is_blocked_between is refused from the app');
reset role;

-- Deleting an account deletes its blocks
delete from auth.users where id = '00000001-b10c-0000-0000-000000000000';
select is((select count(*)::int from public.user_blocks
           where '00000001-b10c-0000-0000-000000000000' in (blocker_id, blocked_id)), 0,
          'deleting an account deletes its block rows');

select * from finish();
rollback;
