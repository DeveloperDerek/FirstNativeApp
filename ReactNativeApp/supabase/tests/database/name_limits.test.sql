-- step-tracker-safety.txt, sections 6 and 10: the word list, and every
-- route that saves a name. (The character rules are tested against the
-- app in name_rules.generated.test.sql.) Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- ---------------------------------------------------------------------
-- Words
-- ---------------------------------------------------------------------
create function pg_temp.problem(p_name text, p_kind text) returns text
language sql as $$ select (public.name_check(p_name, p_kind)).problem $$;

select is(public.name_flat('013457$@!'), 'oieastsai', 'each swap, one by one');
select is(pg_temp.problem('Shit', 'display'), 'NAME_NOT_ALLOWED', 'a listed word');
select is(pg_temp.problem('Sh1t', 'display'), 'NAME_NOT_ALLOWED', 'number swaps undone');
select is(pg_temp.problem('$H!T', 'display'), 'NAME_NOT_ALLOWED', 'symbol swaps undone');
select is(pg_temp.problem('s h i t', 'display'), 'NAME_NOT_ALLOWED', 'spread out with spaces');
select is(pg_temp.problem('s.h.i.t', 'display'), 'NAME_NOT_ALLOWED', 'spread out with dots');
select is(pg_temp.problem(U&'SH\00CDT', 'display'), 'NAME_NOT_ALLOWED', 'accent typed as one character');
select is(pg_temp.problem(U&'SHI\0301T', 'display'), 'NAME_NOT_ALLOWED', 'accent typed as two characters');
select is(pg_temp.problem('big shit fan', 'display'), 'NAME_NOT_ALLOWED', 'whole word among others');
select is(pg_temp.problem('Fuckwalkers', 'display'), 'NAME_NOT_ALLOWED', '"contains" word inside another');

select is(pg_temp.problem('Yamashita', 'display'), null, 'Yamashita passes (shit is whole-word only)');
select is(pg_temp.problem('Matsushita Kenji', 'display'), null, 'Matsushita passes');
select is(pg_temp.problem('Scunthorpe Striders', 'display'), null, 'Scunthorpe passes');
select is(pg_temp.problem('Nazira', 'display'), null, 'Nazira passes');
select is(pg_temp.problem('Pornthip', 'display'), null, 'Pornthip passes');
select is(pg_temp.problem('the therapist', 'display'), null, 'therapist passes');
select is(pg_temp.problem(U&'Jos\00E9 Mar\00EDa', 'display'), null, 'accented names pass');

select is(pg_temp.problem('Official Walkers', 'display'), null, 'staff words are allowed in display names');
select is(pg_temp.problem('Admin Club', 'group'), null, 'and in group names');
select is(pg_temp.problem('official_jo', 'username'), 'USERNAME_NOT_ALLOWED', 'but not in usernames');
select is(pg_temp.problem('4dmin_x', 'username'), 'USERNAME_NOT_ALLOWED', 'swaps apply to usernames');
select is(pg_temp.problem('big_sh1t', 'username'), 'USERNAME_NOT_ALLOWED', 'whole word between underscores');
select is(pg_temp.problem('h3lp', 'username'), 'USERNAME_NOT_ALLOWED', '"exact" reserved word, with a swap');
select is(pg_temp.problem('call_me_al', 'username'), null, '"exact" words only match the whole name');
select is(pg_temp.problem('therapist_jo', 'username'), null, 'therapist passes as a username');

-- ---------------------------------------------------------------------
-- Every route that saves a name
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('0000000a-0000-0000-0000-000000000000', 'a@test.dev'),
  ('0000000b-0000-0000-0000-000000000000', 'b@test.dev');

set local request.jwt.claim.sub = '0000000b-0000-0000-0000-000000000000';
set local role authenticated;

select throws_ok($$ select public.complete_signup('walker_b', 'Sh1t Head', '1990-01-01') $$,
                 'P0001', 'NAME_NOT_ALLOWED', 'sign-up: a bad word is refused');
select throws_ok($$ select public.complete_signup('walker_b', U&'Bea\000aLee', '1990-01-01') $$,
                 'P0001', 'BAD_DISPLAY_NAME', 'sign-up: a line break is refused');

set local request.jwt.claim.sub = '0000000a-0000-0000-0000-000000000000';
select is(public.complete_signup('walker_a', U&'\3000Ana\00A0Lee ', '1990-01-01'), 'OK',
          'sign-up: Unicode spaces are fine');
select is((select display_name from public.profiles where id = auth.uid()), 'Ana Lee',
          'sign-up: saved trimmed, with one ordinary space');

select throws_ok($$ update public.profiles set display_name = 'S.H.1.T' where id = auth.uid() $$,
                 'P0001', 'NAME_NOT_ALLOWED', 'Profile: a bad word is refused');
select throws_ok($$ update public.profiles set display_name = repeat('x', 31) where id = auth.uid() $$,
                 'P0001', 'BAD_DISPLAY_NAME', 'Profile: 31 characters is refused');
select throws_ok($$ update public.profiles set display_name = U&'\00A0' where id = auth.uid() $$,
                 'P0001', 'BAD_DISPLAY_NAME', 'Profile: a non-breaking space only is refused');
select throws_ok($$ update public.profiles set display_name = null where id = auth.uid() $$,
                 'P0001', 'BAD_DISPLAY_NAME', 'Profile: no name is refused');
update public.profiles set display_name = '  Ana  ' where id = auth.uid();
select is((select display_name from public.profiles where id = auth.uid()), 'Ana',
          'Profile: saved as the rules shape it');

select throws_ok($$ select public.change_username('h3lp') $$,
                 'P0001', 'USERNAME_NOT_ALLOWED', 'username change: a reserved word is refused');
select is(public.change_username('call_me_al'), 'call_me_al', 'username change: a normal name works');
select is(public.username_available('big_sh1t'), false, 'the live check agrees');

select throws_ok($$ insert into public.groups (name, owner_id) values (repeat('y', 16), auth.uid()) $$,
                 'P0001', 'BAD_GROUP_NAME', 'new group: 16 characters is refused');
select throws_ok($$ insert into public.groups (name, owner_id) values ('Fuck Club', auth.uid()) $$,
                 'P0001', 'NAME_NOT_ALLOWED', 'new group: a bad word is refused');
insert into public.groups (id, name, owner_id)
values ('00000000-0000-0000-0000-0000000000a1', ' Walkers ', auth.uid());
select is((select name from public.groups where id = '00000000-0000-0000-0000-0000000000a1'),
          'Walkers', 'new group: saved trimmed');
select throws_ok($$ update public.groups set name = 'N4zi' where id = '00000000-0000-0000-0000-0000000000a1' $$,
                 'P0001', 'NAME_NOT_ALLOWED', 'rename: a bad word is refused');
update public.groups set name = 'Nazira Walk' where id = '00000000-0000-0000-0000-0000000000a1';
select is((select name from public.groups where id = '00000000-0000-0000-0000-0000000000a1'),
          'Nazira Walk', 'rename: a normal name works');

-- The word list and the checks can't be used from the app
select is_empty($$ select * from public.reserved_usernames $$, 'the word list is not readable');
select throws_ok($$ select public.name_check('x', 'display') $$, '42501', null,
                 'name_check can''t be called from the app');
select throws_ok($$ select * from public.name_audit() $$, '42501', null,
                 'name_audit can''t be called from the app');

-- ---------------------------------------------------------------------
-- Names saved before the rules keep working
-- ---------------------------------------------------------------------
reset role;
set local session_replication_role = replica; -- skips the triggers, as before this migration
update public.profiles set display_name = 'Old Sh1t Name' where id = '0000000a-0000-0000-0000-000000000000';
update public.groups set name = 'A very long old group name'
where id = '00000000-0000-0000-0000-0000000000a1';
set local session_replication_role = origin;

set local role authenticated;
update public.profiles set sharing_consent_at = now() where id = auth.uid();
select is((select display_name from public.profiles where id = auth.uid()), 'Old Sh1t Name',
          'an old name is kept when something else changes');
update public.groups set invite_code = 'newcode1' where id = '00000000-0000-0000-0000-0000000000a1';
select is((select name from public.groups where id = '00000000-0000-0000-0000-0000000000a1'),
          'A very long old group name', 'an old group name is kept when something else changes');

reset role;
select results_eq(
  $$ select kind, name, problem from public.name_audit()
     where account = '0000000a-0000-0000-0000-000000000000' $$,
  $$ values ('display'::text, 'Old Sh1t Name'::text, 'NAME_NOT_ALLOWED'::text),
            ('group', 'A very long old group name', 'BAD_GROUP_NAME') $$,
  'the audit lists the old names with the rule they break');

select * from finish();
rollback;
