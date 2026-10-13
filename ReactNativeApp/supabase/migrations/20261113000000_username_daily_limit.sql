-- StepTracker: one username change a day (step-tracker-decisions.txt,
-- REG-C). A day is 24 hours from the last change. Picking a new name
-- after an admin reset is always allowed, and counts as that day's change.

alter table public.profile_private add column username_changed_at timestamptz;

-- As in 20261105000000_reports.sql, plus the marked lines
create or replace function public.change_username(p_name text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  wanted   text := lower(btrim(p_name));
  previous text;
  problem  text;
  was_reset boolean;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  select p.username into previous from public.profiles p where p.id = uid for update;
  if wanted = previous then return wanted; end if;

  -- One change a day, except straight after an admin reset (REG-C)
  select x.username_reset_at is not null into was_reset
  from public.profile_private x where x.user_id = uid;
  if not coalesce(was_reset, false)
     and exists (select 1 from public.profile_private x
                 where x.user_id = uid and x.username_changed_at > now() - interval '1 day') then
    raise exception 'USERNAME_CHANGE_LIMIT';
  end if;

  -- Lock both names, always in the same order so two renames can't
  -- deadlock. complete_signup() takes the same lock on the name it claims.
  perform pg_advisory_xact_lock(hashtext('username:' || least(previous, coalesce(wanted, ''))));
  perform pg_advisory_xact_lock(hashtext('username:' || greatest(previous, coalesce(wanted, ''))));

  problem := public.username_problem(wanted, uid);
  if problem is not null then raise exception '%', problem; end if;

  update public.profiles set username = wanted where id = uid;
  -- A new name picked after an admin reset (Part D, rename)
  update public.profile_private set username_reset_at = null where user_id = uid;
  -- When it changed, for the daily limit
  insert into public.profile_private (user_id, username_changed_at) values (uid, now())
  on conflict (user_id) do update set username_changed_at = now();
  delete from public.username_holds h where h.username = wanted and h.user_id = uid;

  -- Nobody can pick the placeholder shape, so there is nothing to hold
  if previous !~ '^user_[0-9a-f]{8}$' then
    insert into public.username_holds (username, user_id, held_until)
    values (previous, uid, now() + interval '30 days')
    on conflict (username)
    do update set user_id = excluded.user_id, held_until = excluded.held_until;
  end if;

  return wanted;
exception
  when unique_violation then raise exception 'USERNAME_TAKEN';
end;
$$;
