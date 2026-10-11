-- Names that break the rules (step-tracker-safety.txt, section 6).
-- Run in Supabase > SQL Editor before deploying the name limits, and
-- again after any change to the word list (public.reserved_usernames).
--
-- Lists every existing username, display name and group name that would
-- be refused now, or saved differently, with the rule it breaks. Nothing
-- is changed automatically: decide each one. Names nobody fixes keep
-- working and are only refused when next changed.
select * from public.name_audit();
