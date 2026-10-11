-- step-tracker-register.txt, section 11: TERMS ACCEPTANCE (6h)
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into public.legal_documents (document, version, url, published_at, requires_reacceptance) values
  ('terms',   't1', 'https://example.test/terms/t1',   now() - interval '1 day', true),
  ('privacy', 'p1', 'https://example.test/privacy/p1', now() - interval '1 day', true);

-- Step 1 sends the versions shown on screen with the sign-up request
insert into auth.users (id, email, raw_user_meta_data) values
  ('000001a1-0000-0000-0000-000000000000', 'current@test.dev',
   '{"accepted_legal": {"terms": "t1", "privacy": "p1"}}'),
  ('000001a2-0000-0000-0000-000000000000', 'old@test.dev',
   '{"accepted_legal": {"terms": "t0", "privacy": "p1"}}'),
  ('000001a3-0000-0000-0000-000000000000', 'partial@test.dev',
   '{"accepted_legal": {"terms": "t1"}}'),
  ('000001a4-0000-0000-0000-000000000000', 'apple@test.dev', '{}'),
  ('000001a5-0000-0000-0000-000000000000', 'existing@test.dev', '{}');

select results_eq(
  $$ select document, version, source, accepted_at = now()
     from public.legal_acceptances
     where user_id = '000001a1-0000-0000-0000-000000000000' order by 1 $$,
  $$ values ('privacy'::text, 'p1'::text, 'signup'::text, true),
            ('terms', 't1', 'signup', true) $$,
  'sign-up with the current versions records them with the server''s time');
select is_empty(
  $$ select 1 from public.legal_acceptances
     where user_id = '000001a2-0000-0000-0000-000000000000' $$,
  'an old version records nothing');
select is_empty(
  $$ select 1 from public.legal_acceptances
     where user_id = '000001a3-0000-0000-0000-000000000000' $$,
  'only some of the current versions records nothing');

-- Step 2
set local role authenticated;
set local request.jwt.claim.sub = '000001a1-0000-0000-0000-000000000000';
select is(public.complete_signup('current_one', 'C', '1990-01-01'), 'OK',
          'accepted at step 1: step 2 needs nothing more');

set local request.jwt.claim.sub = '000001a4-0000-0000-0000-000000000000';
select is(public.account_status(),
          jsonb_build_object('onboarded', false, 'blocked', false, 'terms_ok', false,
            'paused', false, 'pick_username', false, 'reports_enabled', false,
            'minimum_age', 13, 'terms_to_accept', jsonb_build_array(
              jsonb_build_object('document', 'privacy', 'version', 'p1',
                                 'url', 'https://example.test/privacy/p1'),
              jsonb_build_object('document', 'terms', 'version', 't1',
                                 'url', 'https://example.test/terms/t1'))),
          'account_status: unfinished, with both documents to accept');
select throws_ok($$ select public.complete_signup('apple_one', 'A', '1990-01-01') $$,
                 'TERMS_NOT_ACCEPTED', 'no acceptance and no versions sent: refused');
select throws_ok($$ select public.complete_signup('apple_one', 'A', '1990-01-01',
                                                  '{"terms": "t1", "privacy": "made_up"}') $$,
                 'LEGAL_VERSION_NOT_CURRENT', 'a made-up version is refused');
select throws_ok($$ select public.complete_signup('apple_one', 'A', '1990-01-01',
                                                  '{"terms": "t1"}') $$,
                 'TERMS_NOT_ACCEPTED', 'only some of the current versions is refused');
select is(public.complete_signup('apple_one', 'A', '1990-01-01',
                                 '{"terms": "t1", "privacy": "p1"}'),
          'OK', 'with the current versions sent: onboarded');
select results_eq(
  $$ select document, source from public.legal_acceptances
     where user_id = auth.uid() order by 1 $$,
  $$ values ('privacy'::text, 'onboarding'::text), ('terms', 'onboarding') $$,
  '...and they are recorded');

-- Users can't write acceptances or documents
select throws_ok($$ insert into public.legal_acceptances (user_id, document, version, source)
                    values (auth.uid(), 'terms', 't1', 'signup') $$,
                 '42501', null, 'users cannot insert acceptances');
select throws_ok($$ delete from public.legal_acceptances where user_id = auth.uid() $$,
                 '42501', null, 'users cannot delete acceptances');
select throws_ok($$ update public.legal_acceptances set version = 't1' where user_id = auth.uid() $$,
                 '42501', null, 'users cannot edit acceptances');
select throws_ok($$ insert into public.legal_documents (document, version, url, requires_reacceptance)
                    values ('terms', 'mine', 'https://evil.test', false) $$,
                 '42501', null, 'users cannot publish documents');
update public.legal_documents set url = 'https://evil.test' where version = 't1';
reset role;
select is((select url from public.legal_documents where version = 't1'),
          'https://example.test/terms/t1', 'users cannot edit documents');
select throws_ok($$ update public.legal_documents set url = 'https://x.test' where version = 't1' $$,
                 'LEGAL_DOCUMENTS_ARE_PERMANENT: publish a new version instead',
                 'not even admins can edit a published version');

set local role anon;
select isnt_empty($$ select 1 from public.legal_documents $$,
                  'signed-out step 1 can read the current versions');
reset role;

-- An account from before this change, with no acceptance (decision 9F)
update public.profiles set onboarded_at = now()
where id = '000001a5-0000-0000-0000-000000000000';
select is(public.is_active_user('000001a5-0000-0000-0000-000000000000'), false,
          'an existing account must accept versions that require it');

-- A material change
insert into public.legal_documents (document, version, url, requires_reacceptance)
values ('terms', 't2', 'https://example.test/terms/t2', true);
select is(public.is_active_user('000001a4-0000-0000-0000-000000000000'), false,
          'a version that requires re-acceptance makes onboarded users non-active');

set local role authenticated;
set local request.jwt.claim.sub = '000001a4-0000-0000-0000-000000000000';
select results_eq(
  $$ select (s->>'onboarded')::boolean, (s->>'terms_ok')::boolean,
            jsonb_path_query_array(s->'terms_to_accept', '$[*].version')
     from public.account_status() s $$,
  $$ values (true, false, '["t2"]'::jsonb) $$,
  'account_status: onboarded, but the new Terms must be accepted');
select throws_ok($$ select public.accept_legal_documents('{"terms": "t1"}') $$,
                 'LEGAL_VERSION_NOT_CURRENT', 'accepting an old version is refused');
select lives_ok($$ select public.accept_legal_documents('{"terms": "t2"}') $$,
                'the current version can be accepted');
select is(public.is_active_account(), true, '...which makes the account active again');
select is(public.account_status()->'terms_to_accept', '[]'::jsonb,
          'account_status: nothing left to accept');

-- A minor change
reset role;
insert into public.legal_documents (document, version, url, requires_reacceptance)
values ('privacy', 'p2', 'https://example.test/privacy/p2', false);
select is(public.is_active_user('000001a4-0000-0000-0000-000000000000'), true,
          'a minor version does not make anyone non-active');

select * from finish();
rollback;
