-- step-tracker-decisions.txt, REG-C: one username change a day, except
-- straight after an admin reset. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values ('000000a1-1d4c-0000-0000-000000000000', 'once@test.dev');
update public.profiles set onboarded_at = now(), sharing_consent_at = now(), username = 'daily_one'
where id = '000000a1-1d4c-0000-0000-000000000000';

set local role authenticated;
set local request.jwt.claim.sub = '000000a1-1d4c-0000-0000-000000000000';

select is(public.change_username('daily_two'), 'daily_two', 'the first change goes through');
select throws_ok($$ select public.change_username('daily_three') $$, 'USERNAME_CHANGE_LIMIT',
                 'a second change the same day is refused');
select is(public.change_username('daily_two'), 'daily_two', 'keeping the same name is never refused');

reset role;
update public.profile_private set username_changed_at = now() - interval '23 hours'
where user_id = '000000a1-1d4c-0000-0000-000000000000';
set local role authenticated;
select throws_ok($$ select public.change_username('daily_three') $$, 'USERNAME_CHANGE_LIMIT',
                 '23 hours later: still refused');

reset role;
update public.profile_private set username_changed_at = now() - interval '25 hours'
where user_id = '000000a1-1d4c-0000-0000-000000000000';
set local role authenticated;
select is(public.change_username('daily_three'), 'daily_three', 'a day later: allowed again');

-- An admin reset: a new name can be picked straight away
reset role;
update public.profile_private set username_reset_at = now()
where user_id = '000000a1-1d4c-0000-0000-000000000000';
set local role authenticated;
select is(public.change_username('daily_four'), 'daily_four', 'after an admin reset: allowed at once');
select throws_ok($$ select public.change_username('daily_five') $$, 'USERNAME_CHANGE_LIMIT',
                 '...which counts as the day''s change');

select * from finish();
rollback;
