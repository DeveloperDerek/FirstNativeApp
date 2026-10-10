-- step-tracker-register.txt, section 11: birthday corrections (6g) and
-- the cleanup list (6f)
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('000002a1-0000-0000-0000-000000000000', 'a@test.dev'),
  ('000002b1-0000-0000-0000-000000000000', 'b@test.dev'),
  ('000002c1-0000-0000-0000-000000000000', 'c@test.dev');

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub', '000002a1-0000-0000-0000-000000000000', true);
  perform public.complete_signup('anna', 'Anna', '1990-05-01');
  perform set_config('request.jwt.claim.sub', '000002b1-0000-0000-0000-000000000000', true);
  perform public.complete_signup('ben', 'Ben', '1985-05-01');
  perform set_config('request.jwt.claim.sub', '000002c1-0000-0000-0000-000000000000', true);
  perform public.complete_signup('cleo', 'Cleo', '2000-05-01');
end $$;

-- In the app: verified by the session
set local request.jwt.claim.sub = '000002a1-0000-0000-0000-000000000000';
create temp table req as
  select public.request_birthday_correction('1991-02-02', 'Typo') as id;
select throws_ok($$ select public.request_birthday_correction('1991-02-03', null) $$,
                 'REQUEST_ALREADY_OPEN', 'one open request at a time');
select results_eq(
  $$ select verified_via, verified_at is not null, status from public.birthday_correction_requests $$,
  $$ values ('in_app'::text, true, 'open'::text) $$,
  'the user can read their own request, verified in the app');
select throws_ok($$ insert into public.birthday_correction_requests (user_id, verified_via)
                    values (auth.uid(), 'in_app') $$,
                 '42501', null, 'nobody writes requests directly');
select throws_ok($$ select public.correct_birth_date((select id from req), 'x', 'me') $$,
                 '42501', null, 'the app cannot run correct_birth_date()');

set local request.jwt.claim.sub = '000002b1-0000-0000-0000-000000000000';
select is_empty($$ select 1 from public.birthday_correction_requests $$,
                'others cannot read someone''s request');

reset role;
set local role anon;
select throws_ok($$ select public.correct_birth_date('00000000-0000-0000-0000-000000000000', 'x', 'me') $$,
                 '42501', null, 'signed-out callers cannot run correct_birth_date()');
reset role;

-- Support (admin rights) applies it
select throws_ok($$ select public.correct_birth_date((select id from req), '', 'Sam') $$,
                 'REASON_REQUIRED', 'a reason is required');
select is(public.correct_birth_date((select id from req), 'Typo at sign-up', 'Sam'), 'corrected',
          'an adult date replaces the birthday');
select is((select birth_date from public.profile_private
           where user_id = '000002a1-0000-0000-0000-000000000000'),
          '1991-02-02'::date, '...with the date from the request');
select results_eq(
  $$ select status, requested_birth_date, handled_by from public.birthday_correction_requests
     where id = (select id from req) $$,
  $$ values ('corrected'::text, null::date, 'Sam'::text) $$,
  'the request is closed and its date deleted');
select results_eq(
  $$ select user_id, run_by, verified_via, reason, outcome from public.birthday_correction_audit $$,
  $$ values ('000002a1-0000-0000-0000-000000000000'::uuid, 'Sam'::text, 'in_app'::text,
             'Typo at sign-up'::text, 'corrected'::text) $$,
  'an audit row is written');
select is_empty(
  $$ select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'birthday_correction_audit'
       and data_type = 'date' $$,
  'the audit table holds no dates');
select throws_ok($$ select public.correct_birth_date((select id from req), 'Again', 'Sam') $$,
                 'REQUEST_NOT_VERIFIED', 'a handled request cannot be applied again');

-- Without the app: verified only by the link sent to the account's email
create temp table tok as
  select public.start_birthday_correction_by_email(
    '000002b1-0000-0000-0000-000000000000', '1986-06-06', 'Can''t sign in') as token;
create temp table req_b as
  select id from public.birthday_correction_requests
  where user_id = '000002b1-0000-0000-0000-000000000000';
select throws_ok($$ select public.correct_birth_date((select id from req_b), 'Asked by email', 'Sam') $$,
                 'REQUEST_NOT_VERIFIED', 'an email request is not verified until its link is used');
select is(public.confirm_birthday_correction('wrong'), false, 'a wrong token does nothing');

update public.birthday_correction_tokens set expires_at = now() - interval '1 second';
select is(public.confirm_birthday_correction((select token from tok)), false,
          'the link expires after 24 hours');
update public.birthday_correction_tokens set expires_at = now() + interval '1 hour';

select is(public.confirm_birthday_correction((select token from tok)), true, 'the link verifies it');
select is(public.confirm_birthday_correction((select token from tok)), false, 'the link works once');
select is(public.correct_birth_date((select id from req_b), 'Asked by email', 'Sam'), 'corrected',
          'a verified email request can be applied');
select is((select verified_via from public.birthday_correction_audit
           where request_id = (select id from req_b)),
          'email', 'the audit row says how it was verified');

-- A date under the minimum age blocks the account, even after onboarding
set local role authenticated;
set local request.jwt.claim.sub = '000002c1-0000-0000-0000-000000000000';
create temp table req_c as
  select public.request_birthday_correction((current_date - interval '11 years')::date, null) as id;
reset role;
select is(public.correct_birth_date((select id from req_c), 'Real age', 'Sam'), 'blocked',
          'an under-age date blocks the account');
select results_eq(
  $$ select birth_date, age_blocked_at is not null from public.profile_private
     where user_id = '000002c1-0000-0000-0000-000000000000' $$,
  $$ values (null::date, true) $$,
  '...and clears the birth date');
select is(public.is_active_user('000002c1-0000-0000-0000-000000000000'), false,
          '...and the account is no longer active');

-- The cleanup job's list: blocked for more than an hour
select is_empty($$ select * from public.blocked_accounts_to_delete() $$,
                'a block from just now is not deleted yet');
update public.profile_private set age_blocked_at = now() - interval '2 hours'
where user_id = '000002c1-0000-0000-0000-000000000000';
select results_eq($$ select * from public.blocked_accounts_to_delete() $$,
                  $$ values ('000002c1-0000-0000-0000-000000000000'::uuid) $$,
                  'after an hour it is on the list');

select * from finish();
rollback;
