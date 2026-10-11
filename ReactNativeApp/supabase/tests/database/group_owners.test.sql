-- step-tracker-group-owners.txt, Part A and section 5: a group passes to
-- its longest-standing member when the owner goes, by every route.
-- (The owner and the next member leaving at the same moment:
-- supabase/tests/concurrency/group_owner_race.sh.) Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- O owner of several groups; M1, M2 active; I under age (inactive);
-- O2, O3, O4 owners deleted in different ways; N in no group.
insert into auth.users (id, email) values
  ('000000c0-0e50-0000-0000-000000000000', 'o@test.dev'),
  ('000000c1-0e50-0000-0000-000000000000', 'm1@test.dev'),
  ('000000c2-0e50-0000-0000-000000000000', 'm2@test.dev'),
  ('000000c3-0e50-0000-0000-000000000000', 'i@test.dev'),
  ('000000c4-0e50-0000-0000-000000000000', 'o2@test.dev'),
  ('000000c5-0e50-0000-0000-000000000000', 'o3@test.dev'),
  ('000000c6-0e50-0000-0000-000000000000', 'o4@test.dev'),
  ('000000c7-0e50-0000-0000-000000000000', 'n@test.dev');
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'own_' || substr(id::text, 7, 2)
where id::text like '%-0e50-%';
insert into public.profile_private (user_id, age_blocked_at)
values ('000000c3-0e50-0000-0000-000000000000', now());

-- G1: O, then I (inactive), M1, M2 in that order
-- G2: O, then I only.  G3: O alone.  G4: O2 owner, M1.  G5: O3 owner, M2.
-- G6: O4 owner, alone.  G7: M2 owner, M1 and I.  G8: O owner, M1 (old data)
insert into public.groups (id, name, owner_id, invite_code) values
  ('000000d1-0e50-0000-0000-000000000000', 'G1', '000000c0-0e50-0000-0000-000000000000', 'owngrp01'),
  ('000000d2-0e50-0000-0000-000000000000', 'G2', '000000c0-0e50-0000-0000-000000000000', 'owngrp02'),
  ('000000d3-0e50-0000-0000-000000000000', 'G3', '000000c0-0e50-0000-0000-000000000000', 'owngrp03'),
  ('000000d4-0e50-0000-0000-000000000000', 'G4', '000000c4-0e50-0000-0000-000000000000', 'owngrp04'),
  ('000000d5-0e50-0000-0000-000000000000', 'G5', '000000c5-0e50-0000-0000-000000000000', 'owngrp05'),
  ('000000d6-0e50-0000-0000-000000000000', 'G6', '000000c6-0e50-0000-0000-000000000000', 'owngrp06'),
  ('000000d7-0e50-0000-0000-000000000000', 'G7', '000000c2-0e50-0000-0000-000000000000', 'owngrp07'),
  ('000000d8-0e50-0000-0000-000000000000', 'G8', '000000c0-0e50-0000-0000-000000000000', 'owngrp08');
-- Owners joined when their group was made; everyone else joins later, in order
update public.group_members set joined_at = now() - interval '10 days' where group_id::text like '%-0e50-%';
insert into public.group_members (group_id, user_id, joined_at) values
  ('000000d1-0e50-0000-0000-000000000000', '000000c3-0e50-0000-0000-000000000000', now() - interval '9 days'),
  ('000000d1-0e50-0000-0000-000000000000', '000000c1-0e50-0000-0000-000000000000', now() - interval '8 days'),
  ('000000d1-0e50-0000-0000-000000000000', '000000c2-0e50-0000-0000-000000000000', now() - interval '7 days'),
  ('000000d2-0e50-0000-0000-000000000000', '000000c3-0e50-0000-0000-000000000000', now() - interval '9 days'),
  ('000000d4-0e50-0000-0000-000000000000', '000000c1-0e50-0000-0000-000000000000', now() - interval '9 days'),
  ('000000d5-0e50-0000-0000-000000000000', '000000c2-0e50-0000-0000-000000000000', now() - interval '9 days'),
  ('000000d7-0e50-0000-0000-000000000000', '000000c3-0e50-0000-0000-000000000000', now() - interval '9 days'),
  ('000000d7-0e50-0000-0000-000000000000', '000000c1-0e50-0000-0000-000000000000', now() - interval '8 days'),
  ('000000d8-0e50-0000-0000-000000000000', '000000c1-0e50-0000-0000-000000000000', now() - interval '9 days');
-- G1 has a quest, which should carry on
insert into public.quests (id, group_id, type_id, start_asap, vote_deadline, goal)
values ('000000e1-0e50-0000-0000-000000000000', '000000d1-0e50-0000-0000-000000000000',
        'sprint', true, now() + interval '1 day', 8000);
-- M1's phone, for the new-owner push
insert into public.push_devices (token, user_id, platform)
values ('ExponentPushToken[m1]', '000000c1-0e50-0000-0000-000000000000', 'ios');

create function pg_temp.owner_of(gid uuid) returns uuid language sql as $$
  select owner_id from public.groups where id = gid
$$;

-- ---------------------------------------------------------------------
-- What the owner is told, then leaving
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '000000c0-0e50-0000-0000-000000000000';
select is(public.next_group_owner('000000d1-0e50-0000-0000-000000000000')->>'username', 'own_c1',
          'G1: the next owner would be M1 (the longest-standing ACTIVE member, not I)');
select is(public.next_group_owner('000000d3-0e50-0000-0000-000000000000'), null,
          'G3: nobody (O is alone)');
select throws_ok($$ select public.next_group_owner('000000d4-0e50-0000-0000-000000000000') $$,
                 'NOT_THE_OWNER', 'only the owner can ask');

delete from public.group_members
where group_id = '000000d1-0e50-0000-0000-000000000000' and user_id = auth.uid();
reset role;
select is(pg_temp.owner_of('000000d1-0e50-0000-0000-000000000000'), '000000c1-0e50-0000-0000-000000000000'::uuid,
          'O leaves G1: M1 becomes the owner');
select is((select count(*)::int from public.group_members where group_id = '000000d1-0e50-0000-0000-000000000000'),
          3, 'G1 keeps its other members');
select isnt_empty($$ select 1 from public.quests where group_id = '000000d1-0e50-0000-0000-000000000000' $$,
                  'G1 keeps its quest');
select is((select invite_code from public.groups where id = '000000d1-0e50-0000-0000-000000000000'),
          'owngrp01', 'G1 keeps its invite code');
select isnt_empty($$ select 1 from public.push_sends where 'ExponentPushToken[m1]' = any (tokens) $$,
                  'M1 gets the new-owner push');

set local role authenticated;
delete from public.group_members
where group_id = '000000d2-0e50-0000-0000-000000000000' and user_id = auth.uid();
reset role;
select is(pg_temp.owner_of('000000d2-0e50-0000-0000-000000000000'), '000000c3-0e50-0000-0000-000000000000'::uuid,
          'O leaves G2 with only an inactive member: I becomes the owner');

set local role authenticated;
delete from public.group_members
where group_id = '000000d3-0e50-0000-0000-000000000000' and user_id = auth.uid();
reset role;
select is_empty($$ select 1 from public.groups where id = '000000d3-0e50-0000-0000-000000000000' $$,
                'O leaves G3 alone: the group is deleted');

-- ---------------------------------------------------------------------
-- Accounts deleted, by each route
-- ---------------------------------------------------------------------
delete from auth.users where id = '000000c4-0e50-0000-0000-000000000000';
select is(pg_temp.owner_of('000000d4-0e50-0000-0000-000000000000'), '000000c1-0e50-0000-0000-000000000000'::uuid,
          'O2 deletes their account: G4 passes to M1');

-- O3 deleted by an admin (the setting admin_delete uses)
select set_config('steptracker.deleted_by', 'admin:00000000-0000-0000-0000-000000000000', true);
delete from auth.users where id = '000000c5-0e50-0000-0000-000000000000';
select set_config('steptracker.deleted_by', '', true);
select is(pg_temp.owner_of('000000d5-0e50-0000-0000-000000000000'), '000000c2-0e50-0000-0000-000000000000'::uuid,
          'O3 deleted by an admin: G5 passes to M2');

-- O4 deleted by the under-age job, alone in G6
insert into public.profile_private (user_id, age_blocked_at)
values ('000000c6-0e50-0000-0000-000000000000', now() - interval '2 hours');
select ok(public.delete_blocked_accounts() >= 1, 'the under-age job deletes O4');
select is_empty($$ select 1 from public.groups where id = '000000d6-0e50-0000-0000-000000000000' $$,
                '...and G6, where O4 was alone, is deleted');
select isnt_empty($$ select 1 from public.groups where id = '000000d1-0e50-0000-0000-000000000000' $$,
                  'groups the deleted people weren''t owners of are untouched');

-- ---------------------------------------------------------------------
-- Handing over on purpose
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '000000c1-0e50-0000-0000-000000000000';
select throws_ok($$ select public.make_group_owner('000000d7-0e50-0000-0000-000000000000',
                    '000000c1-0e50-0000-0000-000000000000') $$,
                 'NOT_THE_OWNER', 'only the owner can hand a group over');
set local request.jwt.claim.sub = '000000c2-0e50-0000-0000-000000000000';
select throws_ok($$ select public.make_group_owner('000000d7-0e50-0000-0000-000000000000',
                    '000000c7-0e50-0000-0000-000000000000') $$,
                 'NOT_A_MEMBER', 'not to someone outside the group');
select throws_ok($$ select public.make_group_owner('000000d7-0e50-0000-0000-000000000000',
                    '000000c3-0e50-0000-0000-000000000000') $$,
                 'NOT_A_MEMBER', 'not to an inactive member');
select throws_ok($$ select public.make_group_owner('000000d7-0e50-0000-0000-000000000000', auth.uid()) $$,
                 'NOT_A_MEMBER', 'not to yourself');
select lives_ok($$ select public.make_group_owner('000000d7-0e50-0000-0000-000000000000',
                   '000000c1-0e50-0000-0000-000000000000') $$, 'M2 hands G7 to M1');
reset role;
select is(pg_temp.owner_of('000000d7-0e50-0000-0000-000000000000'), '000000c1-0e50-0000-0000-000000000000'::uuid,
          'M1 owns G7');
select isnt_empty($$ select 1 from public.group_members where group_id = '000000d7-0e50-0000-0000-000000000000'
                    and user_id = '000000c2-0e50-0000-0000-000000000000' $$,
                  'M2 stays in G7 as a member');

-- Nobody changes owner_id from the app directly
set local role authenticated;
set local request.jwt.claim.sub = '000000c1-0e50-0000-0000-000000000000';
select throws_ok($$ update public.groups set owner_id = '000000c2-0e50-0000-0000-000000000000'
                    where id = '000000d7-0e50-0000-0000-000000000000' $$,
                 '42501', null, 'the owner can''t set owner_id directly');
set local request.jwt.claim.sub = '000000c2-0e50-0000-0000-000000000000';
update public.groups set owner_id = auth.uid() where id = '000000d7-0e50-0000-0000-000000000000';
reset role;
select is(pg_temp.owner_of('000000d7-0e50-0000-0000-000000000000'), '000000c1-0e50-0000-0000-000000000000'::uuid,
          'a member can''t take a group over by writing owner_id');

-- The owner's membership removed directly (as an older app would): the same
delete from public.group_members
where group_id = '000000d7-0e50-0000-0000-000000000000' and user_id = '000000c1-0e50-0000-0000-000000000000';
select is(pg_temp.owner_of('000000d7-0e50-0000-0000-000000000000'), '000000c2-0e50-0000-0000-000000000000'::uuid,
          'the owner''s row deleted directly: G7 passes on (to M2)');

-- ---------------------------------------------------------------------
-- Old data: an owner who isn't a member (the migration's fix)
-- ---------------------------------------------------------------------
set local session_replication_role = replica; -- as before the triggers existed
delete from public.group_members
where group_id = '000000d8-0e50-0000-0000-000000000000' and user_id = '000000c0-0e50-0000-0000-000000000000';
set local session_replication_role = origin;
select is(public.pass_group_on('000000d8-0e50-0000-0000-000000000000', '000000c0-0e50-0000-0000-000000000000'),
          '000000c1-0e50-0000-0000-000000000000'::uuid, 'an owner who had left: the fix passes G8 to M1');

-- ---------------------------------------------------------------------
-- Always an owner who is in the group
-- ---------------------------------------------------------------------
select is_empty($$ select g.id from public.groups g where g.id::text like '%-0e50-%'
                   and not exists (select 1 from public.group_members m
                                   where m.group_id = g.id and m.user_id = g.owner_id) $$,
                'every group''s owner is one of its members');

-- Who may call what
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('next_owner_of', 'push_new_owner', 'pass_group_on', 'on_member_removed',
                            'pass_groups_on_account_delete')
          and (has_function_privilege('anon', p.oid, 'execute')
               or has_function_privilege('authenticated', p.oid, 'execute'))
        order by 1),
  '{}'::text[], 'the handover helpers can''t be called from the app');
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('next_group_owner', 'make_group_owner')
          and has_function_privilege('anon', p.oid, 'execute')),
  '{}'::text[], 'next_group_owner and make_group_owner can''t be called signed out');
select is(pg_get_constraintdef((select oid from pg_constraint where conname = 'groups_owner_id_fkey')),
          'FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE RESTRICT',
          'a group never goes with its owner''s account by itself');

-- M1 owns G1, G4 and G8 now; deleting M1 passes each on or deletes it
delete from auth.users where id = '000000c1-0e50-0000-0000-000000000000';
select is(pg_temp.owner_of('000000d1-0e50-0000-0000-000000000000'), '000000c2-0e50-0000-0000-000000000000'::uuid,
          'an owner of several groups deleted: G1 passes to M2...');
select is_empty($$ select 1 from public.groups where id in ('000000d4-0e50-0000-0000-000000000000',
                                                            '000000d8-0e50-0000-0000-000000000000') $$,
                '...and G4 and G8, where nobody else was left, are deleted');

select * from finish();
rollback;
