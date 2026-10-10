-- step-tracker-register.txt, sections 6f and 11: the cleanup job deletes a
-- blocked account; when it fails, the account stays blocked and the next
-- run deletes it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- K1 blocked two hours ago, K2 blocked just now, A an ordinary account
insert into auth.users (id, email) values
  ('00000ac1-0000-0000-0000-000000000000', 'k1@test.dev'),
  ('00000ac2-0000-0000-0000-000000000000', 'k2@test.dev'),
  ('00000aa1-0000-0000-0000-000000000000', 'a@test.dev');
insert into public.profile_private (user_id, age_blocked_at) values
  ('00000ac1-0000-0000-0000-000000000000', now() - interval '2 hours'),
  ('00000ac2-0000-0000-0000-000000000000', now());
-- K1 owns a group, with A in it
insert into public.groups (id, name, owner_id) values
  ('00000ae1-0000-0000-0000-000000000000', 'Kid group', '00000ac1-0000-0000-0000-000000000000');
insert into public.group_members (group_id, user_id) values
  ('00000ae1-0000-0000-0000-000000000000', '00000aa1-0000-0000-0000-000000000000');

-- A run that fails for K1 (anything that stops the delete)
create function public.test_refuse_delete() returns trigger language plpgsql as $$
begin
  raise exception 'simulated failure';
end;
$$;
create trigger test_refuse_delete before delete on auth.users
  for each row when (old.id = '00000ac1-0000-0000-0000-000000000000')
  execute function public.test_refuse_delete();

select is(public.delete_blocked_accounts(), 0, 'a failing delete deletes nothing');
select isnt_empty($$ select 1 from auth.users where id = '00000ac1-0000-0000-0000-000000000000' $$,
                  'the account is still there');
select is(public.is_active_user('00000ac1-0000-0000-0000-000000000000'), false,
          '...and still blocked meanwhile');
select results_eq(
  $$ select outcome, error from public.account_cleanup_log
     where user_id = '00000ac1-0000-0000-0000-000000000000' $$,
  $$ values ('failed'::text, 'simulated failure'::text) $$,
  'the failure is logged');

-- The next run works
drop trigger test_refuse_delete on auth.users;
select is(public.delete_blocked_accounts(), 1, 'the next run deletes it');
select is_empty($$ select 1 from auth.users where id = '00000ac1-0000-0000-0000-000000000000' $$,
                'the login account is gone');
select is_empty($$ select 1 from public.profiles where id = '00000ac1-0000-0000-0000-000000000000' $$,
                'its profile is gone');
select is_empty($$ select 1 from public.profile_private
                   where user_id = '00000ac1-0000-0000-0000-000000000000' $$,
                'its private row is gone');
select is_empty($$ select 1 from public.groups where id = '00000ae1-0000-0000-0000-000000000000' $$,
                'groups it owned are gone, as with "Delete account"');
select is((select outcome from public.account_cleanup_log
           where user_id = '00000ac1-0000-0000-0000-000000000000' order by id desc limit 1),
          'deleted', 'the deletion is logged');

select isnt_empty($$ select 1 from auth.users where id = '00000ac2-0000-0000-0000-000000000000' $$,
                  'an account blocked less than an hour ago is not deleted yet');
select isnt_empty($$ select 1 from auth.users where id = '00000aa1-0000-0000-0000-000000000000' $$,
                  'an ordinary account is never touched');

select results_eq(
  $$ select schedule, active from cron.job where jobname = 'delete-blocked-accounts' $$,
  $$ values ('0 * * * *'::text, true) $$,
  'the job runs every hour');

select * from finish();
rollback;
