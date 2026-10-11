-- step-tracker-register.txt, sections 6b, 6e and 11: grants. Fails when a
-- new function the app can call forgets is_active_account().
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select is(
  array(select p.proname::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prorettype <> 'trigger'::regtype
          and has_function_privilege('authenticated', p.oid, 'execute')
          and p.prosrc not like '%is_active_account()%'
          and p.proname not in (
            -- the check itself, and helpers the row rules use
            'is_active_account', 'is_active_user', 'is_friend', 'is_group_member',
            'is_active_member',
            'shares_group', 'has_sharing_consent',
            -- no user data
            'shop_day', 'quest_grace', 'quest_cooldown', 'quest_multiplier',
            'quest_step_coins', 'quest_coins_each',
            -- date arithmetic only (step-tracker-safety.txt, section 2)
            'step_period',
            -- the caller's own status, needed to pick the screen
            'account_status',
            -- for unfinished accounts; they refuse blocked ones (checked below)
            'complete_signup', 'username_available', 'accept_legal_documents',
            -- sign-out removes only the caller's own push addresses, and
            -- must work on the blocked and Updated Terms screens too
            'unregister_push_device', 'unregister_other_push_devices')
        order by 1),
  '{}'::text[],
  'every function the app can call checks is_active_account()');

select is(
  array(select p.proname::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('complete_signup', 'username_available', 'accept_legal_documents')
          and p.prosrc not like '%is_age_blocked(uid)%'
        order by 1),
  '{}'::text[],
  'the sign-up functions refuse blocked accounts');

select is(
  array(select p.proname::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (has_function_privilege('anon', p.oid, 'execute')
               or has_function_privilege('authenticated', p.oid, 'execute'))
          and p.proname in ('correct_birth_date', 'start_birthday_correction_by_email',
                            'confirm_birthday_correction', 'reject_birthday_correction',
                            'blocked_accounts_to_delete', 'delete_blocked_accounts',
                            'grant_all_items', 'minimum_age')
        order by 1),
  '{}'::text[],
  'admin-only functions cannot be run from the app');

select is(
  array(select p.proname::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and has_function_privilege('anon', p.oid, 'execute')
          and p.proname in ('complete_signup', 'change_username', 'username_available',
                            'accept_legal_documents', 'request_birthday_correction')
        order by 1),
  '{}'::text[],
  'signed-out visitors cannot run the sign-up functions');

-- 6b: a column grant limits nothing while a table-wide UPDATE is in place
select is(has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), false,
          'no table-wide UPDATE on profiles');
select is(
  array(select distinct c.column_name::text from information_schema.column_privileges c
        where c.table_schema = 'public' and c.table_name = 'profiles'
          and c.grantee = 'authenticated' and c.privilege_type = 'UPDATE'
        order by 1),
  array['avatar', 'display_name', 'map_theme', 'sharing_consent_at'],
  'only the columns the app edits can be updated');
select is(has_table_privilege('anon', 'public.profiles', 'UPDATE'), false,
          'signed-out visitors cannot update profiles');
select policies_are('public', 'profiles', array['profiles read', 'profiles update own'],
                    'the "profiles update own" row rule is kept');

select * from finish();
rollback;
