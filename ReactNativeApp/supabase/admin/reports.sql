-- Reviewing reports (step-tracker-safety.txt, Part D). Run in Supabase >
-- SQL Editor. Check at least once a day, and straight away when an admin
-- push arrives. If nobody can review for a while, turn reports off (5).
--
-- Every action needs YOUR admin id (your row in public.admins) and a
-- short reason; each is written to the action log in the same step.

-- 1. OPEN REPORTS, oldest first. over_20_hours stands out; other_reports,
--    people_reporting and past_actions show what else is known about the
--    same person or group.
select * from public.open_reports();

-- 2. Everything about one person or group, in order
select * from public.report_history(p_person => '<person id>');
select * from public.report_history(p_group => '<group id>');

-- 3. ACT on a report (one of these):
--    Nothing wrong:
select public.admin_dismiss('<report id>', '<your admin id>', 'why');
--    A name: 'display' (back to their username) or 'username' (they pick
--    a new one on next open). For a group report, the name becomes "Group"
--    (leave the last argument out).
select public.admin_rename('<report id>', '<your admin id>', 'why', 'display');
--    Serious, and you need time: pause the account (report stays open)
select public.admin_hide('<report id>', '<your admin id>', 'why');
--    ...then end the pause, closing the report, if nothing was wrong:
select public.admin_unhide('<person id>', '<your admin id>', 'why', '<report id>');
--    The worst cases: delete the account (or the group). Other open
--    reports about them close automatically.
select public.admin_delete('<report id>', '<your admin id>', 'why');
--    If it involves a risk to someone's safety, the next step is outside
--    the app (the police); the report history is kept for a year.

-- 4. PAUSED ACCOUNTS, longest first. Every one must end in admin_unhide
--    or admin_delete.
select * from public.hidden_accounts();

-- 5. TURN REPORTS ON (only after a test report has gone end to end:
--    push received, seen in 1, acted on with 3) or OFF (when nobody can
--    review)
update public.app_settings set value = 1 where key = 'reports_enabled';
update public.app_settings set value = 0 where key = 'reports_enabled';

-- 6. Add another admin (they get every shop item too, and the pushes
--    once they turn push on in Profile)
insert into public.admins (user_id) values ('<their account id>');
