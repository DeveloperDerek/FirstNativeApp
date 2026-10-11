-- StepTracker: when revoking Sign in with Apple fails at account deletion
-- (step-tracker-group-owners.txt, Part B, decision 5). The account is
-- deleted anyway; the delete-account Edge Function writes a row here so
-- you can see it happened. The account id and a reason only: no tokens,
-- no email. The person can still remove the app under their Apple ID >
-- Sign in with Apple.
--
-- Check with:
--   select * from public.apple_revocation_failures order by failed_at desc;
create table public.apple_revocation_failures (
  id        bigint generated always as identity primary key,
  user_id   uuid not null, -- the deleted account (no link: it's gone)
  error     text not null,
  failed_at timestamptz not null default now()
);

-- No policies: not readable or writable from the app (the Edge Function
-- uses the service role)
alter table public.apple_revocation_failures enable row level security;
revoke all on public.apple_revocation_failures from anon, authenticated;
