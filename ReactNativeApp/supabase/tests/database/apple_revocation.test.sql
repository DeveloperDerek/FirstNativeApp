-- step-tracker-group-owners.txt, Part B: the Apple revocation failure log
-- is closed to the app. (The revoking itself: supabase/functions/
-- delete-account/apple.test.ts, run by `npm test`.) Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into public.apple_revocation_failures (user_id, error)
values ('00000000-0000-0000-0000-0000000000a1', 'test');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select throws_ok($$ select * from public.apple_revocation_failures $$, '42501', null,
                 'signed in: the log can''t be read');
select throws_ok($$ insert into public.apple_revocation_failures (user_id, error)
                    values (auth.uid(), 'x') $$, '42501', null, 'or written');
set local role anon;
select throws_ok($$ select * from public.apple_revocation_failures $$, '42501', null,
                 'signed out: the same');

select * from finish();
rollback;
