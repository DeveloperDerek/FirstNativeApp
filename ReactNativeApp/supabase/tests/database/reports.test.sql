-- step-tracker-safety.txt, Parts B and D, sections 5 and 10: reports,
-- report history when accounts are deleted, admin actions, and paused
-- accounts. (Reports sent at the same moment: supabase/tests/concurrency.)
-- Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(90);

-- M admin; R, C, D reporters; B reported; E someone R can't see (they
-- blocked R); N in no group with anyone; X under age; P same id as a group.
insert into auth.users (id, email) values
  ('000000a0-4e90-0000-0000-000000000000', 'm@test.dev'),
  ('000000a1-4e90-0000-0000-000000000000', 'r@test.dev'),
  ('000000a2-4e90-0000-0000-000000000000', 'b@test.dev'),
  ('000000a3-4e90-0000-0000-000000000000', 'c@test.dev'),
  ('000000a4-4e90-0000-0000-000000000000', 'd@test.dev'),
  ('000000a5-4e90-0000-0000-000000000000', 'e@test.dev'),
  ('000000a6-4e90-0000-0000-000000000000', 'n@test.dev'),
  ('000000a7-4e90-0000-0000-000000000000', 'x@test.dev'),
  ('000000a8-4e90-0000-0000-000000000000', 'p@test.dev');
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(),
    username = 'rep_' || substr(id::text, 7, 2), display_name = 'Name ' || substr(id::text, 7, 2)
where id::text like '%-4e90-%';
insert into public.admins (user_id) values ('000000a0-4e90-0000-0000-000000000000');
insert into public.profile_private (user_id, age_blocked_at)
values ('000000a7-4e90-0000-0000-000000000000', now());

-- Group W (owner R): R, B, C, D, X. Group P2 has the same id as person P.
insert into public.groups (id, name, owner_id, invite_code) values
  ('000000b1-4e90-0000-0000-000000000000', 'Walkers', '000000a1-4e90-0000-0000-000000000000', 'repgrp01'),
  ('000000a8-4e90-0000-0000-000000000000', 'Same Id', '000000a1-4e90-0000-0000-000000000000', 'repgrp02');
insert into public.group_members (group_id, user_id) values
  ('000000b1-4e90-0000-0000-000000000000', '000000a2-4e90-0000-0000-000000000000'),
  ('000000b1-4e90-0000-0000-000000000000', '000000a3-4e90-0000-0000-000000000000'),
  ('000000b1-4e90-0000-0000-000000000000', '000000a4-4e90-0000-0000-000000000000'),
  ('000000b1-4e90-0000-0000-000000000000', '000000a7-4e90-0000-0000-000000000000');
insert into public.user_blocks (blocker_id, blocked_id)
values ('000000a5-4e90-0000-0000-000000000000', '000000a1-4e90-0000-0000-000000000000');
insert into public.daily_steps (user_id, day, steps)
values ('000000a2-4e90-0000-0000-000000000000', current_date, 5000);
insert into public.last_seen (user_id) values ('000000a2-4e90-0000-0000-000000000000');
-- The admin's phone, for the alert pushes
insert into public.push_devices (token, user_id, platform)
values ('ExponentPushToken[admin]', '000000a0-4e90-0000-0000-000000000000', 'ios');

create function pg_temp.reports_about(person uuid) returns int language sql as $$
  select count(*)::int from public.reports where person_id = person
$$;

-- ---------------------------------------------------------------------
-- Off until turned on
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '000000a1-4e90-0000-0000-000000000000';
select is((public.account_status()->>'reports_enabled')::boolean, false, 'reports start turned off');
select throws_ok($$ select public.report_user('000000a2-4e90-0000-0000-000000000000', 'spam') $$,
                 'REPORTS_OFF', 'reporting is refused while off, even called directly');
select throws_ok($$ select public.report_group('000000b1-4e90-0000-0000-000000000000', 'other') $$,
                 'REPORTS_OFF', '...for groups too');
reset role;
update public.app_settings set value = 1 where key = 'reports_enabled';
set local role authenticated;
select is((public.account_status()->>'reports_enabled')::boolean, true, 'turned on, the app is told');

-- ---------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------
select lives_ok($$ select public.report_user('000000a2-4e90-0000-0000-000000000000', 'offensive_name', '  rude name  ') $$,
                'R reports B');
select lives_ok($$ select public.report_user('000000a2-4e90-0000-0000-000000000000', 'harassment') $$,
                'a second report while the first is open says nothing...');
reset role;
select is(pg_temp.reports_about('000000a2-4e90-0000-0000-000000000000'), 1, '...and adds nothing');
select results_eq(
  $$ select reporter_id, reason, note, snapshot_username, snapshot_display_name, status
     from public.reports where person_id = '000000a2-4e90-0000-0000-000000000000' $$,
  $$ values ('000000a1-4e90-0000-0000-000000000000'::uuid, 'offensive_name'::text, 'rude name'::text,
             'rep_a2'::text, 'Name a2'::text, 'open'::text) $$,
  'the report keeps both names as they were, and the trimmed note');
select isnt_empty($$ select 1 from public.push_sends where 'ExponentPushToken[admin]' = any (tokens) $$,
                  'the admin got a push');
update public.profiles set display_name = 'Changed' where id = '000000a2-4e90-0000-0000-000000000000';
select is((select snapshot_display_name from public.reports
           where person_id = '000000a2-4e90-0000-0000-000000000000'), 'Name a2',
          'changing the name afterwards doesn''t change the report');
select is_empty($$ select 1 from public.user_blocks where blocker_id = '000000a1-4e90-0000-0000-000000000000' $$,
                'reporting without "also block" blocks nobody');

set local role authenticated;
select throws_ok($$ select public.report_user(auth.uid(), 'spam') $$, 'REPORT_NOT_ALLOWED', 'not yourself');
select throws_ok($$ select public.report_user('000000a5-4e90-0000-0000-000000000000', 'spam') $$,
                 'REPORT_NOT_ALLOWED', 'not someone hidden from you (E blocked R) outside a shared group');
select throws_ok($$ select public.report_user('000000a7-4e90-0000-0000-000000000000', 'spam') $$,
                 'REPORT_NOT_ALLOWED', 'not an inactive (under-age) member of your group');
select throws_ok($$ select public.report_user('000000a3-4e90-0000-0000-000000000000', 'rude') $$,
                 'BAD_REASON', 'a reason that isn''t on the list');
select throws_ok(format($$ select public.report_user('000000a3-4e90-0000-0000-000000000000', 'other', %L) $$,
                        repeat('x', 501)),
                 'NOTE_TOO_LONG', 'a note over 500 characters');
select throws_ok($$ select public.report_group('000000b1-4e90-0000-0000-000000000000', 'spam') $$,
                 'BAD_REASON', 'a group can''t be reported for spam');
set local request.jwt.claim.sub = '000000a6-4e90-0000-0000-000000000000';
select throws_ok($$ select public.report_group('000000b1-4e90-0000-0000-000000000000', 'other') $$,
                 'REPORT_NOT_ALLOWED', 'not a group you''re not in');

-- C reports group mate D with "also block"; the group name too
set local request.jwt.claim.sub = '000000a3-4e90-0000-0000-000000000000';
select lives_ok($$ select public.report_user('000000a4-4e90-0000-0000-000000000000', 'spam', null, true) $$,
                'C reports D and blocks them');
select isnt_empty($$ select 1 from public.user_blocks where blocked_id = '000000a4-4e90-0000-0000-000000000000' $$,
                  'with "also block", D is blocked');
select lives_ok($$ select public.report_group('000000b1-4e90-0000-0000-000000000000', 'offensive_name') $$,
                'C reports the group name');
-- ...and can still report D after blocking (the Blocked people route)
reset role;
update public.reports set status = 'closed', closed_at = now()
where reporter_id = '000000a3-4e90-0000-0000-000000000000' and person_id = '000000a4-4e90-0000-0000-000000000000';
delete from public.group_members where user_id = '000000a4-4e90-0000-0000-000000000000';
set local role authenticated;
select lives_ok($$ select public.report_user('000000a4-4e90-0000-0000-000000000000', 'harassment') $$,
                'someone you blocked can be reported again, once the first report is closed');

-- A person and a group with the same id: both saved
set local request.jwt.claim.sub = '000000a1-4e90-0000-0000-000000000000';
reset role;
insert into public.friendships (requester_id, addressee_id, status)
values ('000000a1-4e90-0000-0000-000000000000', '000000a8-4e90-0000-0000-000000000000', 'accepted');
set local role authenticated;
select lives_ok($$ select public.report_user('000000a8-4e90-0000-0000-000000000000', 'other') $$, 'report person P');
select lives_ok($$ select public.report_group('000000a8-4e90-0000-0000-000000000000', 'other') $$, 'report group P');
reset role;
select is((select count(*)::int from public.reports where reporter_id = '000000a1-4e90-0000-0000-000000000000'
             and coalesce(person_id, group_id) = '000000a8-4e90-0000-0000-000000000000'),
          2, 'a person and a group with the same id are never mixed up');

-- The daily limit: 10 in any 24 hours. R has sent 3 (B, person P,
-- group P); 6 more make 9.
insert into public.reports (reporter_id, target_kind, person_id, reason, created_at)
select '000000a1-4e90-0000-0000-000000000000', 'person', null, 'spam', now() - interval '1 hour'
from generate_series(1, 6);
set local role authenticated;
select lives_ok($$ select public.report_user('000000a3-4e90-0000-0000-000000000000', 'other') $$,
                'the 10th report in 24 hours is accepted');
select throws_ok($$ select public.report_user('000000a6-4e90-0000-0000-000000000000', 'other') $$,
                 'REPORT_LIMIT', 'the 11th is refused');
reset role;
update public.reports set created_at = now() - interval '25 hours'
where reporter_id = '000000a1-4e90-0000-0000-000000000000' and person_id is null;
set local role authenticated;
select lives_ok($$ select public.report_group('000000b1-4e90-0000-0000-000000000000', 'other') $$,
                'once some are over 24 hours old, reporting works again');

-- Nobody reads reports or the log from the app, or calls admin functions
select throws_ok($$ select * from public.reports $$, '42501', null, 'reports can''t be read from the app');
select throws_ok($$ select * from public.moderation_actions $$, '42501', null, 'nor the action log');
select throws_ok($$ select * from public.open_reports() $$, '42501', null, 'nor the admin query');
select throws_ok($$ select public.admin_dismiss(gen_random_uuid(), '000000a0-4e90-0000-0000-000000000000', 'x') $$,
                 '42501', null, 'admin actions can''t be called from the app');
select throws_ok($$ select public.is_active_user('000000a2-4e90-0000-0000-000000000000') $$,
                 '42501', null, 'is_active_user can''t be called from the app any more');
reset role;
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('reports_enabled', 'is_hidden', 'push_admins', 'alert_admins_new_report',
                            'remind_old_reports', 'delete_old_reports', 'require_admin', 'open_report',
                            'close_report', 'admin_dismiss', 'admin_rename', 'admin_hide', 'admin_unhide',
                            'admin_delete', 'open_reports', 'hidden_accounts', 'report_history',
                            'is_active_user')
          and (has_function_privilege('anon', p.oid, 'execute')
               or has_function_privilege('authenticated', p.oid, 'execute'))
        order by 1),
  '{}'::text[], 'internal, admin and scheduled functions are closed to the app');

-- ---------------------------------------------------------------------
-- The admin side
-- ---------------------------------------------------------------------
create function pg_temp.report_of(reporter uuid, person uuid) returns uuid language sql as $$
  select id from public.reports where reporter_id = reporter and person_id = person and status = 'open'
$$;

select throws_ok($$ select public.admin_dismiss(pg_temp.report_of('000000a1-4e90-0000-0000-000000000000',
                    '000000a2-4e90-0000-0000-000000000000'), '000000a1-4e90-0000-0000-000000000000', 'x') $$,
                 'NOT_AN_ADMIN', 'only an admin can act');
select throws_ok($$ select public.admin_rename(pg_temp.report_of('000000a1-4e90-0000-0000-000000000000',
                    '000000a2-4e90-0000-0000-000000000000'), '000000a0-4e90-0000-0000-000000000000', 'x', 'nickname') $$,
                 'SAY_DISPLAY_OR_USERNAME', 'an action that fails...');
select is((select count(*)::int from public.moderation_actions), 0, '...leaves no log row');

-- hide -> unhide -> rename on one report: three rows, in order
select lives_ok($$ select public.admin_hide(pg_temp.report_of('000000a1-4e90-0000-0000-000000000000',
                   '000000a2-4e90-0000-0000-000000000000'), '000000a0-4e90-0000-0000-000000000000', 'looking into it') $$,
                'hide B');
select is((select status from public.reports where person_id = '000000a2-4e90-0000-0000-000000000000'),
          'open', 'hiding leaves the report open');

-- While B is paused
set local role authenticated;
set local request.jwt.claim.sub = '000000a2-4e90-0000-0000-000000000000';
select is((public.account_status()->>'paused')::boolean, true, 'B is told: paused');
select is_empty($$ select 1 from public.profiles where id <> auth.uid() $$, 'paused: B reads nobody else''s profile');
select throws_ok($$ select * from public.group_leaderboard('000000b1-4e90-0000-0000-000000000000', 'today', current_date) $$,
                 'ACCOUNT_NOT_ACTIVE', 'paused: group functions refuse B');
set local request.jwt.claim.sub = '000000a3-4e90-0000-0000-000000000000';
select is(public.can_see('000000a2-4e90-0000-0000-000000000000'), false, 'nobody sees B (can_see is false)');
select is_empty($$ select 1 from public.profiles where id = '000000a2-4e90-0000-0000-000000000000' $$,
                'B''s profile is hidden');
select is_empty($$ select 1 from public.daily_steps where user_id = '000000a2-4e90-0000-0000-000000000000' $$,
                'B''s steps are hidden');
select is_empty($$ select 1 from public.last_seen where user_id = '000000a2-4e90-0000-0000-000000000000' $$,
                'B''s last seen is hidden');
select is_empty($$ select 1 from public.group_leaderboard('000000b1-4e90-0000-0000-000000000000', 'today', current_date)
                   where user_id = '000000a2-4e90-0000-0000-000000000000' $$,
                'B is missing from the group leaderboard');
select is_empty($$ select 1 from jsonb_array_elements(public.group_quest('000000b1-4e90-0000-0000-000000000000')->'members') m
                   where m->>'user_id' = '000000a2-4e90-0000-0000-000000000000' $$,
                '...and from group_quest');
select throws_ok($$ select public.group_member_card('000000b1-4e90-0000-0000-000000000000',
                    '000000a2-4e90-0000-0000-000000000000', current_date) $$,
                 'NOT_A_MEMBER', '...and the member card');
reset role;
select results_eq($$ select person_id, also_under_age from public.hidden_accounts() $$,
                  $$ values ('000000a2-4e90-0000-0000-000000000000'::uuid, false) $$,
                  'the hidden-accounts query lists B');

select lives_ok($$ select public.admin_unhide('000000a2-4e90-0000-0000-000000000000',
                   '000000a0-4e90-0000-0000-000000000000', 'nothing found') $$, 'unhide B');
select lives_ok($$ select public.admin_rename(pg_temp.report_of('000000a1-4e90-0000-0000-000000000000',
                   '000000a2-4e90-0000-0000-000000000000'), '000000a0-4e90-0000-0000-000000000000',
                   'the name, though', 'display') $$, 'then rename B''s display name');
select results_eq(
  $$ select action from public.moderation_actions where person_id = '000000a2-4e90-0000-0000-000000000000' order by id $$,
  $$ values ('hide'::text), ('unhide'), ('rename') $$,
  'hide, unhide, rename: three log rows in order');
select is((select display_name from public.profiles where id = '000000a2-4e90-0000-0000-000000000000'),
          'rep_a2', 'the display name is back to the username');
select is((select change->>'old' from public.moderation_actions where action = 'rename'), 'Changed',
          'the log keeps the old name');
select is((select status from public.reports where person_id = '000000a2-4e90-0000-0000-000000000000'),
          'closed', 'the rename closed the report');
select throws_ok($$ select public.admin_dismiss((select id from public.reports
                    where person_id = '000000a2-4e90-0000-0000-000000000000'), '000000a0-4e90-0000-0000-000000000000', 'x') $$,
                 'REPORT_CLOSED', 'a closed report can''t be acted on again');

-- A username reset
set local role authenticated;
set local request.jwt.claim.sub = '000000a4-4e90-0000-0000-000000000000';
select lives_ok($$ select public.report_user('000000a2-4e90-0000-0000-000000000000', 'offensive_name') $$,
                'D reports B''s username');
reset role;
select lives_ok($$ select public.admin_rename(pg_temp.report_of('000000a4-4e90-0000-0000-000000000000',
                   '000000a2-4e90-0000-0000-000000000000'), '000000a0-4e90-0000-0000-000000000000', 'username', 'username') $$,
                'reset B''s username');
set local role authenticated;
set local request.jwt.claim.sub = '000000a2-4e90-0000-0000-000000000000';
select is((select username from public.profiles where id = auth.uid()), 'user_000000a2',
          'B has the placeholder for now');
select is((public.account_status()->>'pick_username')::boolean, true, 'B is asked to pick a new one');
select is(public.change_username('better_name'), 'better_name', 'B picks one');
select is((public.account_status()->>'pick_username')::boolean, false, 'and isn''t asked again');

-- Hidden AND under age: unhide lifts only the pause
reset role;
update public.app_settings set value = 1 where key = 'reports_enabled';
insert into public.reports (reporter_id, target_kind, person_id, reason)
values ('000000a3-4e90-0000-0000-000000000000', 'person', '000000a7-4e90-0000-0000-000000000000', 'spam');
select lives_ok($$ select public.admin_hide((select id from public.reports where person_id = '000000a7-4e90-0000-0000-000000000000'),
                   '000000a0-4e90-0000-0000-000000000000', 'serious') $$, 'hide X');
insert into public.profile_private (user_id, age_blocked_at) values ('000000a7-4e90-0000-0000-000000000000', now())
on conflict (user_id) do update set age_blocked_at = now();
select is((select also_under_age from public.hidden_accounts() where person_id = '000000a7-4e90-0000-0000-000000000000'),
          true, 'the hidden-accounts query shows the other restriction');
select lives_ok($$ select public.admin_unhide('000000a7-4e90-0000-0000-000000000000',
                   '000000a0-4e90-0000-0000-000000000000', 'x') $$, 'unhide X');
select is(public.is_active_user('000000a7-4e90-0000-0000-000000000000'), false, 'X stays inactive (under age)');
select is((select age_blocked_at is not null from public.profile_private
           where user_id = '000000a7-4e90-0000-0000-000000000000'), true, 'the age block is untouched');

-- The log is append-only, for admins too
select throws_ok($$ update public.moderation_actions set reason = 'edited' where action = 'hide' $$,
                 'APPEND_ONLY', 'a log row can''t be edited');
select throws_ok($$ delete from public.moderation_actions where action = 'hide' $$,
                 'APPEND_ONLY', 'or deleted');

-- ---------------------------------------------------------------------
-- Deleted accounts and groups (section 5)
-- ---------------------------------------------------------------------
-- R, C and D all report N; the admin deletes N from one of them
update public.reports set status = 'closed', closed_at = now() where status = 'open';
insert into public.reports (reporter_id, target_kind, person_id, reason, snapshot_username) values
  ('000000a1-4e90-0000-0000-000000000000', 'person', '000000a6-4e90-0000-0000-000000000000', 'spam', 'rep_a6'),
  ('000000a3-4e90-0000-0000-000000000000', 'person', '000000a6-4e90-0000-0000-000000000000', 'spam', 'rep_a6'),
  ('000000a4-4e90-0000-0000-000000000000', 'person', '000000a6-4e90-0000-0000-000000000000', 'harassment', 'rep_a6');
select lives_ok($$ select public.admin_delete(pg_temp.report_of('000000a1-4e90-0000-0000-000000000000',
                   '000000a6-4e90-0000-0000-000000000000'), '000000a0-4e90-0000-0000-000000000000', 'abuse') $$,
                'the admin deletes N from R''s report');
select is_empty($$ select 1 from auth.users where id = '000000a6-4e90-0000-0000-000000000000' $$, 'N is gone');
select results_eq(
  $$ select r.snapshot_username, r.status, a.action, a.reason, a.admin_id
     from public.reports r join public.moderation_actions a on a.report_id = r.id
     where r.snapshot_username = 'rep_a6' order by a.action, r.reporter_id $$,
  $$ values ('rep_a6'::text, 'closed'::text, 'auto_close'::text, 'account deleted by an admin'::text,
             '000000a0-4e90-0000-0000-000000000000'::uuid),
            ('rep_a6', 'closed', 'auto_close', 'account deleted by an admin', '000000a0-4e90-0000-0000-000000000000'),
            ('rep_a6', 'closed', 'delete', 'abuse', '000000a0-4e90-0000-0000-000000000000') $$,
  'all three reports closed, each with its own log row, the snapshot kept');
select is((select count(*)::int from public.reports where snapshot_username = 'rep_a6' and person_id is null), 3,
          'the reports stay, with the deleted account''s id emptied');

-- E deletes their own account while hidden, with a report open
insert into public.reports (reporter_id, target_kind, person_id, reason, snapshot_username) values
  ('000000a3-4e90-0000-0000-000000000000', 'person', '000000a5-4e90-0000-0000-000000000000', 'spam', 'rep_a5');
select public.admin_hide((select id from public.reports where snapshot_username = 'rep_a5'),
                         '000000a0-4e90-0000-0000-000000000000', 'serious');
delete from auth.users where id = '000000a5-4e90-0000-0000-000000000000';
select results_eq(
  $$ select r.status, a.reason from public.reports r
     join public.moderation_actions a on a.report_id = r.id and a.action = 'auto_close'
     where r.snapshot_username = 'rep_a5' $$,
  $$ values ('closed'::text, 'account deleted by its owner'::text) $$,
  'a paused account deleting itself: its reports close "by its owner"');
select is_empty($$ select 1 from public.hidden_accounts() where username = 'rep_a5' $$,
                'and it''s no longer in the hidden-accounts query');

-- The under-age job deletes X with a report open
insert into public.reports (reporter_id, target_kind, person_id, reason, snapshot_username) values
  ('000000a3-4e90-0000-0000-000000000000', 'person', '000000a7-4e90-0000-0000-000000000000', 'other', 'rep_a7');
update public.profile_private set age_blocked_at = now() - interval '2 hours'
where user_id = '000000a7-4e90-0000-0000-000000000000';
select ok(public.delete_blocked_accounts() >= 1, 'the under-age job runs');
select is((select a.reason from public.reports r join public.moderation_actions a on a.report_id = r.id
           where r.snapshot_username = 'rep_a7' and a.action = 'auto_close'),
          'account deleted (under age)', 'its open report closes "under age"');

-- A group deleted with an open report
select is((select a.reason from public.moderation_actions a
           where a.action = 'auto_close' and a.reason = 'group deleted'), null, 'no group closures yet');
insert into public.reports (reporter_id, target_kind, group_id, reason, snapshot_group_name) values
  ('000000a3-4e90-0000-0000-000000000000', 'group', '000000b1-4e90-0000-0000-000000000000', 'other', 'Walkers');
delete from public.groups where id = '000000b1-4e90-0000-0000-000000000000';
select results_eq(
  $$ select r.status, r.group_id, a.reason from public.reports r
     join public.moderation_actions a on a.report_id = r.id and a.action = 'auto_close'
     where r.snapshot_group_name = 'Walkers' and r.reason = 'other' and a.reason = 'group deleted' $$,
  $$ values ('closed'::text, null::uuid, 'group deleted'::text) $$,
  'a deleted group''s open report closes "group deleted", the name kept');

-- The reporter and the admin delete their accounts
delete from auth.users where id = '000000a4-4e90-0000-0000-000000000000';
select is((select count(*)::int from public.reports where snapshot_username = 'rep_a6' and reporter_id is null), 1,
          'a reporter''s deleted account: their report stays, anonymous');
delete from auth.users where id = '000000a0-4e90-0000-0000-000000000000';
select is((select count(*)::int from public.moderation_actions where admin_id is not null), 0,
          'an admin''s deleted account: only their id is emptied from the log');
select is((select count(*)::int from public.moderation_actions where action = 'delete' and reason = 'abuse'), 1,
          '...and the action is still there');

-- After a year, closed reports go with their log rows; open ones never
update public.reports set closed_at = now() - interval '13 months' where snapshot_username = 'rep_a6';
insert into public.reports (reporter_id, target_kind, reason, created_at)
values (null, 'person', 'spam', now() - interval '2 years');
select is(public.delete_old_reports(), 3, 'the cleanup deletes the three year-old closed reports');
select is((select count(*)::int from public.moderation_actions m where not exists
           (select 1 from public.reports r where r.id = m.report_id) and m.report_id is not null), 0,
          'their log rows went with them');
select is((select count(*)::int from public.reports where status = 'open' and created_at < now() - interval '1 year'), 1,
          'an open report is never deleted, however old');

-- ---------------------------------------------------------------------
-- The 20-hour reminder
-- ---------------------------------------------------------------------
insert into public.admins (user_id) values ('000000a3-4e90-0000-0000-000000000000');
insert into public.push_devices (token, user_id, platform)
values ('ExponentPushToken[admin2]', '000000a3-4e90-0000-0000-000000000000', 'ios');
select is(public.remind_old_reports(), 1, 'the open 2-year-old report gets its reminder');
select isnt_empty($$ select 1 from public.push_sends where 'ExponentPushToken[admin2]' = any (tokens) $$,
                  'pushed to the admin');
select is(public.remind_old_reports(), 0, 'once only');

-- ---------------------------------------------------------------------
-- A group owner who blocked a member can still remove them
-- ---------------------------------------------------------------------
insert into public.groups (id, name, owner_id, invite_code) values
  ('000000b2-4e90-0000-0000-000000000000', 'Owners', '000000a1-4e90-0000-0000-000000000000', 'repgrp03');
insert into public.group_members (group_id, user_id)
values ('000000b2-4e90-0000-0000-000000000000', '000000a8-4e90-0000-0000-000000000000');
insert into public.user_blocks (blocker_id, blocked_id)
values ('000000a1-4e90-0000-0000-000000000000', '000000a8-4e90-0000-0000-000000000000');
set local role authenticated;
set local request.jwt.claim.sub = '000000a1-4e90-0000-0000-000000000000';
delete from public.group_members
where group_id = '000000b2-4e90-0000-0000-000000000000' and user_id = '000000a8-4e90-0000-0000-000000000000';
reset role;
select is_empty($$ select 1 from public.group_members where group_id = '000000b2-4e90-0000-0000-000000000000'
                   and user_id = '000000a8-4e90-0000-0000-000000000000' $$,
                'the owner removed the member they blocked');

select * from finish();
rollback;
