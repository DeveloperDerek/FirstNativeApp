-- StepTracker: delete accounts blocked for being under the minimum age
-- (step-tracker-register.txt, 6f; Stage 7b). Deleting is NOT what keeps a
-- child out (the block from 20261023000000_register.sql is); this removes
-- the account and everything it owns about an hour later.
--
-- The blueprint describes an Edge Function run every hour. This is the
-- same job inside the database (pg_cron): no service-role key or secret
-- has to be stored for a scheduler to call it, a failed run is simply
-- tried again the next hour, and it is covered by `supabase test db`.

create extension if not exists pg_cron with schema pg_catalog;

-- Every attempt, so failures get noticed. Only ids: nothing personal.
-- Check with:
--   select * from public.account_cleanup_log where outcome = 'failed' order by run_at desc;
create table public.account_cleanup_log (
  id      bigint generated always as identity primary key,
  run_at  timestamptz not null default now(),
  user_id uuid not null,
  outcome text not null check (outcome in ('deleted', 'failed')),
  error   text
);

-- No policies: not readable from the app
alter table public.account_cleanup_log enable row level security;

-- ADMIN ONLY (the hourly job). Deletes each blocked login account more
-- than an hour old; everything else of theirs goes with it (every table
-- cascades from auth.users, as for "Delete account"). One failure doesn't
-- stop the others: it is logged, and the account stays blocked until a
-- later run deletes it. Returns how many were deleted.
create function public.delete_blocked_accounts()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  uid     uuid;
  deleted integer := 0;
begin
  for uid in select * from public.blocked_accounts_to_delete() loop
    begin
      delete from auth.users where id = uid;
      insert into public.account_cleanup_log (user_id, outcome) values (uid, 'deleted');
      deleted := deleted + 1;
    exception when others then
      insert into public.account_cleanup_log (user_id, outcome, error)
      values (uid, 'failed', sqlerrm);
      raise warning 'Could not delete blocked account %: %', uid, sqlerrm;
    end;
  end loop;
  return deleted;
end;
$$;

revoke all on function public.delete_blocked_accounts() from public, anon, authenticated;

-- Every hour, on the hour. Its runs (and any failure of the job itself)
-- show in cron.job_run_details.
select cron.schedule(
  'delete-blocked-accounts',
  '0 * * * *',
  $$ select public.delete_blocked_accounts() $$
);
