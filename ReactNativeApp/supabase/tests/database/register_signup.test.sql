-- step-tracker-register.txt, section 11: USERNAMES, PRIVATE BIRTHDAY,
-- SIGN-UP AND AGE. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

-- Who is signed in: `set local request.jwt.claim.sub`, read by auth.uid().
-- `set local role authenticated` makes the row rules and grants apply.

insert into auth.users (id, email) values
  ('0000000a-0000-0000-0000-000000000000', 'a@test.dev'),
  ('0000000b-0000-0000-0000-000000000000', 'b@test.dev'),
  ('0000000c-0000-0000-0000-000000000000', 'kid@test.dev'),
  ('0000000d-0000-0000-0000-000000000000', 'teen@test.dev'),
  ('0000000e-0000-0000-0000-000000000000', 'teen2@test.dev'),
  ('0000000f-0000-0000-0000-000000000000', 'typist@test.dev');

select is((select onboarded_at from public.profiles
           where id = '0000000a-0000-0000-0000-000000000000'),
          null::timestamptz, 'a new account is not onboarded');

-- ---------------------------------------------------------------------
-- complete_signup()
-- ---------------------------------------------------------------------
set local request.jwt.claim.sub = '0000000a-0000-0000-0000-000000000000';
set local role authenticated;

select is(public.complete_signup('DEREK ', ' Derek ', '1990-05-01'), 'OK',
          'valid answers are accepted');
select results_eq(
  $$ select username, display_name, onboarded_at is not null
     from public.profiles where id = auth.uid() $$,
  $$ values ('derek'::text, 'Derek'::text, true) $$,
  'username (cleaned), display name and onboarded_at are saved together');
select is((select birth_date from public.profile_private where user_id = auth.uid()),
          '1990-05-01'::date, 'the birthday is saved with them');

select is(public.complete_signup('someone_else', 'X', '1980-01-01'), 'ALREADY_ONBOARDED',
          'calling again after success says ALREADY_ONBOARDED');
select results_eq(
  $$ select p.username, x.birth_date from public.profiles p
     join public.profile_private x on x.user_id = p.id where p.id = auth.uid() $$,
  $$ values ('derek'::text, '1990-05-01'::date) $$,
  '...and changes nothing');

select is(public.username_available('derek'), true, 'your own name is available to you');

-- Someone else
set local request.jwt.claim.sub = '0000000b-0000-0000-0000-000000000000';

select is(public.username_available('DEREK'), false, 'a taken name is not available');
select throws_ok($$ select public.complete_signup('derek', 'B', '1990-01-01') $$,
                 'USERNAME_TAKEN', 'a taken name is refused');
select is((select onboarded_at from public.profiles where id = auth.uid()), null::timestamptz,
          'a refused save leaves onboarded_at null');
select is_empty($$ select 1 from public.profile_private where user_id = auth.uid() $$,
                'a refused save leaves no birthday row');

select throws_ok($$ select public.complete_signup('de rek', 'B', '1990-01-01') $$,
                 'BAD_USERNAME', 'a space is refused');
select throws_ok($$ select public.complete_signup('ab', 'B', '1990-01-01') $$,
                 'BAD_USERNAME', 'too short is refused');
select throws_ok($$ select public.complete_signup('a_name_that_is_far_too_long', 'B', '1990-01-01') $$,
                 'BAD_USERNAME', 'too long is refused');
select throws_ok($$ select public.complete_signup('admin', 'B', '1990-01-01') $$,
                 'USERNAME_NOT_ALLOWED', 'a reserved name is refused');
select throws_ok($$ select public.complete_signup('the_admin_99', 'B', '1990-01-01') $$,
                 'USERNAME_NOT_ALLOWED', 'a name containing a blocked word is refused');
select throws_ok($$ select public.complete_signup('user_1a2b3c4d', 'B', '1990-01-01') $$,
                 'USERNAME_NOT_ALLOWED', 'the placeholder shape is refused');
select is(public.username_available('admin'), false, 'a reserved name is not available');

select throws_ok($$ select public.complete_signup('bee', 'B', current_date + 1) $$,
                 'BAD_BIRTH_DATE', 'a birthday in the future is refused');
select throws_ok($$ select public.complete_signup('bee', 'B', '1890-01-01') $$,
                 'BAD_BIRTH_DATE', 'a birthday over 120 years ago is refused');
select throws_ok($$ select public.complete_signup('bee', 'B', null) $$,
                 'BAD_BIRTH_DATE', 'a missing birthday is refused');
select throws_ok($$ select public.complete_signup('bee', '   ', '1990-01-01') $$,
                 'BAD_DISPLAY_NAME', 'an empty display name is refused');
select throws_ok($$ select public.complete_signup('bee', repeat('x', 31), '1990-01-01') $$,
                 'BAD_DISPLAY_NAME', 'a display name over 30 characters is refused');

select is(public.complete_signup('bee', 'Bé 🐝', '1992-03-04'), 'OK',
          'accents and emoji are fine in a display name');

-- ---------------------------------------------------------------------
-- Under the minimum age (6f)
-- ---------------------------------------------------------------------
set local request.jwt.claim.sub = '0000000c-0000-0000-0000-000000000000';

select is(public.complete_signup('kiddo', 'Kid', (current_date - interval '10 years')::date),
          'UNDER_AGE', 'under 13 returns UNDER_AGE');
select results_eq(
  $$ select birth_date, age_blocked_at is not null
     from public.profile_private where user_id = auth.uid() $$,
  $$ values (null::date, true) $$,
  'the block is recorded and the birth date is not stored');
select is((select onboarded_at from public.profiles where id = auth.uid()), null::timestamptz,
          'a blocked account is not onboarded');
select throws_ok($$ select public.complete_signup('kiddo', 'Kid', '1980-01-01') $$,
                 'AGE_BLOCKED', 'an older date afterwards is refused');
select throws_ok($$ select public.username_available('kiddo') $$,
                 'AGE_BLOCKED', 'a blocked account cannot check usernames');

-- The minimum age comes from the server setting
reset role;
update public.app_settings set value = 18 where key = 'minimum_age';
set local request.jwt.claim.sub = '0000000d-0000-0000-0000-000000000000';
set local role authenticated;
select is(public.complete_signup('teen_one', 'Teen', (current_date - interval '15 years')::date),
          'UNDER_AGE', 'with the setting at 18, a 15-year-old is under age');

reset role;
update public.app_settings set value = 13 where key = 'minimum_age';
set local request.jwt.claim.sub = '0000000e-0000-0000-0000-000000000000';
set local role authenticated;
select is(public.complete_signup('teen_two', 'Teen', (current_date - interval '13 years')::date),
          'OK', 'with the setting at 13, someone turning 13 today is old enough');

-- ---------------------------------------------------------------------
-- Private birthday (section 5)
-- ---------------------------------------------------------------------
set local request.jwt.claim.sub = '0000000a-0000-0000-0000-000000000000';
select is((select count(*)::int from public.profile_private
           where user_id = '0000000a-0000-0000-0000-000000000000'),
          1, 'A can read their own private row');
select throws_ok($$ update public.profile_private set birth_date = '2000-01-01'
                    where user_id = auth.uid() $$,
                 '42501', null, 'A cannot change their own birthday directly');
select throws_ok($$ insert into public.profile_private (user_id, birth_date)
                    values ('0000000f-0000-0000-0000-000000000000', '2000-01-01') $$,
                 '42501', null, 'nobody can insert private rows');
select throws_ok($$ delete from public.profile_private where user_id = auth.uid() $$,
                 '42501', null, 'nobody can delete private rows');

set local request.jwt.claim.sub = '0000000b-0000-0000-0000-000000000000';
select is_empty($$ select 1 from public.profile_private
                   where user_id = '0000000a-0000-0000-0000-000000000000' $$,
                'B cannot read A''s private row');
select is_empty($$ select 1 from public.profile_private
                   where user_id = '0000000c-0000-0000-0000-000000000000' $$,
                'B cannot see that C is blocked');

reset role;
set local role anon;
select is_empty($$ select 1 from public.profile_private $$,
                'a signed-out caller reads nothing');
select throws_ok($$ select public.complete_signup('anon_name', 'X', '1990-01-01') $$,
                 '42501', null, 'signed-out callers cannot run complete_signup()');
select throws_ok($$ select public.change_username('anon_name') $$,
                 '42501', null, 'signed-out callers cannot run change_username()');
select throws_ok($$ select public.username_available('anon_name') $$,
                 '42501', null, 'signed-out callers cannot run username_available()');

-- ---------------------------------------------------------------------
-- Direct profile updates (6b)
-- ---------------------------------------------------------------------
reset role;
set local request.jwt.claim.sub = '0000000a-0000-0000-0000-000000000000';
set local role authenticated;
select throws_ok($$ update public.profiles set username = 'sneaky' where id = auth.uid() $$,
                 '42501', null, 'username cannot be updated directly');
select throws_ok($$ update public.profiles set onboarded_at = null where id = auth.uid() $$,
                 '42501', null, 'onboarded_at cannot be updated directly');
update public.profiles set display_name = 'Derek H' where id = auth.uid();
select is((select display_name from public.profiles where id = auth.uid()), 'Derek H',
          'display_name can still be updated directly');

-- ---------------------------------------------------------------------
-- Renames and the 30-day hold (9C)
-- ---------------------------------------------------------------------
select is(public.change_username('derek_walks'), 'derek_walks', 'A renames');

set local request.jwt.claim.sub = '0000000b-0000-0000-0000-000000000000';
select is(public.username_available('derek'), false, 'a released name is not available to others');
select throws_ok($$ select public.change_username('derek') $$,
                 'USERNAME_TAKEN', 'a released name is refused for others');

reset role;
select ok((select held_until between now() + interval '29 days' and now() + interval '31 days'
           from public.username_holds where username = 'derek'),
          'the hold lasts 30 days');

set local request.jwt.claim.sub = '0000000a-0000-0000-0000-000000000000';
set local role authenticated;
select is(public.change_username('derek'), 'derek', 'the old owner can take it back');

-- ---------------------------------------------------------------------
-- Rate limit on username_available()
-- ---------------------------------------------------------------------
set local request.jwt.claim.sub = '0000000f-0000-0000-0000-000000000000';
select is((select count(x.ok)::int from generate_series(1, 60) g
           cross join lateral (select public.username_available('free_name_' || g) as ok) x),
          60, '60 checks are allowed');
select throws_ok($$ select public.username_available('free_name_61') $$,
                 'RATE_LIMITED', 'the 61st within 10 minutes is refused');

-- ---------------------------------------------------------------------
-- No way to change your own birthday (6g)
-- ---------------------------------------------------------------------
reset role;
select is(
  array(select p.proname::text from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname ~ 'birth'
          and has_function_privilege('authenticated', p.oid, 'execute')
        order by 1),
  array['request_birthday_correction'],
  'the only birthday function the app can run is the correction request');

select * from finish();
rollback;
