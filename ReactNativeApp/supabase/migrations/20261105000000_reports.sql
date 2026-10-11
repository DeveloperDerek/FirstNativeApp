-- StepTracker: reports and the admin side (step-tracker-safety.txt, Part B
-- "Report", section 5 "Report history", Part D "Acting on reports").
--
-- Report stays hidden until the review process works: the server setting
-- reports_enabled starts at 0, and the report functions refuse while it
-- is. Turn it on (update public.app_settings set value = 1 where key =
-- 'reports_enabled') only when the admin queries, actions and push alerts
-- have been tried end to end with a test report.

-- =====================================================================
-- THE SWITCH
-- =====================================================================
insert into public.app_settings (key, value) values ('reports_enabled', 0);

create function public.reports_enabled()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select s.value from public.app_settings s where s.key = 'reports_enabled'), 0) = 1 $$;

-- =====================================================================
-- PAUSED BY AN ADMIN, AND A USERNAME RESET
-- =====================================================================
-- Each restriction is its own field (under age, unfinished, Terms, and
-- now paused), and "active" means none applies. Unpausing clears only
-- hidden_at, so an account restricted for another reason stays inactive.
alter table public.profile_private
  add column hidden_at timestamptz,
  add column hidden_for_report uuid,
  -- Set by the admin rename of a username: pick a new one on next open
  add column username_reset_at timestamptz;

create function public.is_hidden(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profile_private x
                 where x.user_id = p_user and x.hidden_at is not null)
$$;

-- As in 20261023000000_register.sql, plus "not paused"
create or replace function public.is_active_user(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_user is not null
     and exists (select 1 from public.profiles p
                 where p.id = p_user and p.onboarded_at is not null)
     and not public.is_age_blocked(p_user)
     and public.legal_terms_ok(p_user)
     and not public.is_hidden(p_user)
$$;

-- is_active_user(anyone) was callable from the app. Next to can_see()
-- that would tell a blocked person they're blocked ("active, but I can't
-- see them"). The two rules that used it no longer call it, and the app
-- can't any more (functions with extra rights still do).
alter policy "friendships read" on public.friendships
  using ((auth.uid() = requester_id or auth.uid() = addressee_id)
         and (select public.is_active_account())
         and public.can_see(case when requester_id = auth.uid()
                                 then addressee_id else requester_id end));

-- Group membership stays visible between blocked group mates (decision
-- 1); among other things the owner must be able to remove someone they
-- blocked, and a delete only reaches rows its user can read. This only
-- answers for active members of a group the caller is in, which the
-- group screens show anyway.
create function public.is_active_member(gid uuid, person uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_group_member(gid)
     and exists (select 1 from public.group_members m
                 where m.group_id = gid and m.user_id = person)
     and public.is_active_user(person)
$$;

alter policy "members read" on public.group_members
  using ((select public.is_active_account())
         and public.is_active_member(group_id, user_id));

-- =====================================================================
-- REPORTS
-- =====================================================================
-- What the reporter saw is kept in the snapshot (names change). When a
-- reported account or group is deleted, its id is emptied but the kind,
-- snapshot, reason and history stay for the year (section 5). Nobody can
-- read reports from the app, including the reporter.
create table public.reports (
  id                    uuid primary key default gen_random_uuid(),
  reporter_id           uuid references public.profiles(id) on delete set null,
  target_kind           text not null check (target_kind in ('person', 'group')),
  person_id             uuid references public.profiles(id) on delete set null,
  group_id              uuid references public.groups(id) on delete set null,
  reason                text not null
                        check (reason in ('offensive_name', 'impersonation', 'harassment',
                                          'spam', 'other')),
  note                  text check (char_length(note) <= 500),
  snapshot_username     text,
  snapshot_display_name text,
  snapshot_group_name   text,
  status                text not null default 'open' check (status in ('open', 'closed')),
  created_at            timestamptz not null default now(),
  closed_at             timestamptz,
  reminded_at           timestamptz, -- the 20-hour reminder push
  -- Kind and columns agree (an emptied id after a deletion is fine)
  check ((target_kind = 'person' and group_id is null)
      or (target_kind = 'group' and person_id is null)),
  -- A group is reported for its name only
  check (target_kind = 'person' or reason in ('offensive_name', 'other')),
  check ((status = 'open') = (closed_at is null))
);

-- One OPEN report per reporter per target, kept by the database itself.
-- Separate rules for people and groups, so the two can never be mixed up.
create unique index reports_open_person_idx on public.reports (reporter_id, person_id)
  where status = 'open' and target_kind = 'person';
create unique index reports_open_group_idx on public.reports (reporter_id, group_id)
  where status = 'open' and target_kind = 'group';
create index reports_person_idx on public.reports (person_id);
create index reports_group_idx on public.reports (group_id);
create index reports_reporter_time_idx on public.reports (reporter_id, created_at);

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

alter table public.profile_private
  add constraint profile_private_hidden_for_report_fkey
  foreign key (hidden_for_report) references public.reports(id) on delete set null;

-- =====================================================================
-- THE ACTION LOG (APPEND-ONLY)
-- =====================================================================
-- One row per action, by an admin or (auto_close) by the database when a
-- report's target is deleted. Nobody edits or deletes rows, admins
-- included, with exactly two automatic exceptions: ids emptied when an
-- account or group is deleted, and the one-year cleanup.
create table public.moderation_actions (
  id         bigint generated always as identity primary key,
  report_id  uuid references public.reports(id) on delete cascade,
  person_id  uuid references public.profiles(id) on delete set null,
  group_id   uuid references public.groups(id) on delete set null,
  admin_id   uuid references public.profiles(id) on delete set null,
  action     text not null
             check (action in ('dismiss', 'rename', 'hide', 'unhide', 'delete', 'auto_close')),
  reason     text,
  change     jsonb, -- e.g. {"field": "display_name", "old": "...", "new": "..."}
  created_at timestamptz not null default now()
);
create index moderation_actions_report_idx on public.moderation_actions (report_id);
create index moderation_actions_person_idx on public.moderation_actions (person_id);

alter table public.moderation_actions enable row level security;
revoke all on public.moderation_actions from anon, authenticated;

create function public.moderation_actions_append_only()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Only the one-year cleanup, which deletes a report's rows with it
    if current_setting('steptracker.report_cleanup', true) = 'on' then return old; end if;
    raise exception 'APPEND_ONLY';
  end if;
  -- UPDATE: only ids emptied after a deletion; nothing else may change
  if (new.id, new.report_id, new.action, new.reason, new.change, new.created_at)
       is not distinct from
     (old.id, old.report_id, old.action, old.reason, old.change, old.created_at)
     and (new.person_id is null or new.person_id = old.person_id)
     and (new.group_id is null or new.group_id = old.group_id)
     and (new.admin_id is null or new.admin_id = old.admin_id) then
    return new;
  end if;
  raise exception 'APPEND_ONLY';
end;
$$;

create trigger moderation_actions_append_only
  before update or delete on public.moderation_actions
  for each row execute function public.moderation_actions_append_only();

create function public.moderation_actions_no_truncate()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception 'APPEND_ONLY'; end; $$;

create trigger moderation_actions_no_truncate
  before truncate on public.moderation_actions
  for each statement execute function public.moderation_actions_no_truncate();

-- =====================================================================
-- OPEN REPORTS WHEN THEIR TARGET IS DELETED: closed automatically
-- =====================================================================
-- Who deleted it comes from a setting for this transaction:
-- admin_delete() sets 'admin:<id>', the under-age job sets 'age'; nothing
-- set means the person deleted their own account. Runs before the row
-- goes, so the log rows still say what was deleted (then the ids are
-- emptied like everywhere else).
create function public.close_reports_on_account_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  how   text := coalesce(current_setting('steptracker.deleted_by', true), '');
  admin uuid;
  why   text;
begin
  if how like 'admin:%' then
    admin := substr(how, 7)::uuid;
    why := 'account deleted by an admin';
  elsif how = 'age' then
    why := 'account deleted (under age)';
  else
    why := 'account deleted by its owner';
  end if;

  with closed as (
    update public.reports set status = 'closed', closed_at = now()
    where person_id = old.id and status = 'open'
    returning id
  )
  insert into public.moderation_actions (report_id, person_id, admin_id, action, reason)
  select c.id, old.id, admin, 'auto_close', why from closed c;
  return old;
end;
$$;

create trigger profiles_close_reports
  before delete on public.profiles
  for each row execute function public.close_reports_on_account_delete();

create function public.close_reports_on_group_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  how   text := coalesce(current_setting('steptracker.deleted_by', true), '');
  admin uuid := case when how like 'admin:%' then substr(how, 7)::uuid end;
begin
  with closed as (
    update public.reports set status = 'closed', closed_at = now()
    where group_id = old.id and status = 'open'
    returning id
  )
  insert into public.moderation_actions (report_id, group_id, admin_id, action, reason)
  select c.id, old.id, admin, 'auto_close', 'group deleted' from closed c;
  return old;
end;
$$;

create trigger groups_close_reports
  before delete on public.groups
  for each row execute function public.close_reports_on_group_delete();

-- =====================================================================
-- PUSH ALERTS TO ADMINS
-- =====================================================================
-- The same way friend request pushes go out. No names or details in the
-- push: open the SQL Editor to see the report.
create function public.push_admins(p_title text, p_body text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  tokens text[];
  req    bigint;
begin
  select array_agg(d.token order by d.token) into tokens
  from public.push_devices d
  join public.admins a on a.user_id = d.user_id
  where coalesce((select s.push_enabled from public.notification_settings s
                  where s.user_id = d.user_id), true);
  if tokens is null then return; end if;

  select net.http_post(
    url     := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
    body    := (select jsonb_agg(jsonb_build_object(
                  'to', t, 'title', p_title, 'body', p_body, 'sound', 'default') order by t)
                from unnest(tokens) t))
  into req;
  insert into public.push_sends (request_id, tokens) values (req, tokens);
end;
$$;

-- "New report (3 open)". A failed push never stops the report.
create function public.alert_admins_new_report()
returns void language plpgsql security definer set search_path = ''
as $$
declare open_count integer;
begin
  select count(*) into open_count from public.reports where status = 'open';
  perform public.push_admins('New report', open_count || ' open');
exception when others then
  raise warning 'Admin push failed: %', sqlerrm;
end;
$$;

-- Every hour: reports open more than 20 hours, pushed once each
create function public.remind_old_reports()
returns integer language plpgsql security definer set search_path = ''
as $$
declare due integer;
begin
  with marked as (
    update public.reports set reminded_at = now()
    where status = 'open' and reminded_at is null
      and created_at < now() - interval '20 hours'
    returning id
  )
  select count(*) into due from marked;
  if due > 0 then
    perform public.push_admins('Reports waiting',
      case when due = 1 then 'A report has been waiting 20 hours'
           else due || ' reports have been waiting 20 hours' end);
  end if;
  return due;
end;
$$;

select cron.schedule('remind-old-reports', '15 * * * *', $$ select public.remind_old_reports() $$);

-- Every day: reports closed more than a year ago go, with their log rows.
-- Open reports are never deleted.
create function public.delete_old_reports()
returns integer language plpgsql security definer set search_path = ''
as $$
declare gone integer;
begin
  perform set_config('steptracker.report_cleanup', 'on', true);
  delete from public.reports where status = 'closed' and closed_at < now() - interval '1 year';
  get diagnostics gone = row_count;
  perform set_config('steptracker.report_cleanup', '', true);
  return gone;
end;
$$;

select cron.schedule('delete-old-reports', '30 3 * * *', $$ select public.delete_old_reports() $$);

-- =====================================================================
-- REPORTING (the app)
-- =====================================================================
-- Each checks everything itself, the same whether the app calls it or not:
-- signed in, active, reports turned on, a target the caller may report,
-- a reason that fits, a note of 500 characters or fewer, and at most 10
-- reports in any 24 hours. The limit takes a per-person lock first, so it
-- can't be raced. A second open report on the same target adds nothing
-- (the unique index), and the app says "Thanks" either way.

create function public.report_user(
  person uuid, reason text, note text default null, also_block boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  clean text := nullif(btrim(note), '');
  saved uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.reports_enabled() then raise exception 'REPORTS_OFF'; end if;
  if reason is null
     or reason not in ('offensive_name', 'impersonation', 'harassment', 'spam', 'other') then
    raise exception 'BAD_REASON';
  end if;
  if char_length(clean) > 500 then raise exception 'NOTE_TOO_LONG'; end if;
  -- Someone you can see, a member of a group you share, or someone you
  -- blocked (from Profile > Blocked people). Never yourself.
  if person is null or person = uid
     or not (public.can_see(person)
             or (public.shares_group(person) and public.is_active_user(person))
             or exists (select 1 from public.user_blocks b
                        where b.blocker_id = uid and b.blocked_id = person)) then
    raise exception 'REPORT_NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report:' || uid::text, 0));
  if (select count(*) from public.reports r
      where r.reporter_id = uid and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'REPORT_LIMIT';
  end if;

  insert into public.reports (reporter_id, target_kind, person_id, reason, note,
                              snapshot_username, snapshot_display_name)
  select uid, 'person', p.id, reason, clean, p.username, p.display_name
  from public.profiles p where p.id = person
  on conflict (reporter_id, person_id) where status = 'open' and target_kind = 'person'
  do nothing
  returning id into saved;

  if also_block then perform public.block_user(person); end if;
  if saved is not null then perform public.alert_admins_new_report(); end if;
end;
$$;

create function public.report_group(gid uuid, reason text, note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  clean text := nullif(btrim(note), '');
  saved uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.reports_enabled() then raise exception 'REPORTS_OFF'; end if;
  -- A group is reported for its name; how people act is reported against them
  if reason is null or reason not in ('offensive_name', 'other') then
    raise exception 'BAD_REASON';
  end if;
  if char_length(clean) > 500 then raise exception 'NOTE_TOO_LONG'; end if;
  if gid is null or not public.is_group_member(gid) then
    raise exception 'REPORT_NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report:' || uid::text, 0));
  if (select count(*) from public.reports r
      where r.reporter_id = uid and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'REPORT_LIMIT';
  end if;

  insert into public.reports (reporter_id, target_kind, group_id, reason, note, snapshot_group_name)
  select uid, 'group', g.id, reason, clean, g.name
  from public.groups g where g.id = gid
  on conflict (reporter_id, group_id) where status = 'open' and target_kind = 'group'
  do nothing
  returning id into saved;

  if saved is not null then perform public.alert_admins_new_report(); end if;
end;
$$;

-- =====================================================================
-- ADMIN ACTIONS (SQL Editor only)
-- =====================================================================
-- Each takes the report, which admin (an id from public.admins) and a
-- short reason, and writes its action log row in the same step as the
-- change. supabase/admin/reports.sql shows how to use them.

create function public.require_admin(p_admin uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_admin is null or not exists (select 1 from public.admins a where a.user_id = p_admin) then
    raise exception 'NOT_AN_ADMIN';
  end if;
end;
$$;

-- The report, which must be open
create function public.open_report(p_report uuid)
returns public.reports language plpgsql security definer set search_path = ''
as $$
declare r public.reports%rowtype;
begin
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'NO_SUCH_REPORT'; end if;
  if r.status <> 'open' then raise exception 'REPORT_CLOSED'; end if;
  return r;
end;
$$;

create function public.close_report(p_report uuid)
returns void language sql security definer set search_path = ''
as $$ update public.reports set status = 'closed', closed_at = now() where id = p_report $$;

-- Nothing wrong: the report is closed
create function public.admin_dismiss(p_report uuid, p_admin uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.reports%rowtype;
begin
  perform public.require_admin(p_admin);
  r := public.open_report(p_report);
  insert into public.moderation_actions (report_id, person_id, group_id, admin_id, action, reason)
  values (r.id, r.person_id, r.group_id, p_admin, 'dismiss', p_reason);
  perform public.close_report(r.id);
end;
$$;

-- p_what for a person: 'display' (display name back to the username) or
-- 'username' (a placeholder now; they pick a new one on next open). For a
-- group: the name becomes "Group". Closes the report.
create function public.admin_rename(p_report uuid, p_admin uuid, p_reason text,
                                    p_what text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r       public.reports%rowtype;
  old_val text;
  new_val text;
  field   text;
begin
  perform public.require_admin(p_admin);
  r := public.open_report(p_report);

  if r.target_kind = 'group' then
    if r.group_id is null then raise exception 'TARGET_GONE'; end if;
    field := 'group_name';
    select g.name into old_val from public.groups g where g.id = r.group_id;
    new_val := 'Group';
    update public.groups set name = new_val where id = r.group_id;
  else
    if r.person_id is null then raise exception 'TARGET_GONE'; end if;
    if p_what = 'display' then
      field := 'display_name';
      select p.display_name, p.username into old_val, new_val
      from public.profiles p where p.id = r.person_id;
      update public.profiles set display_name = new_val where id = r.person_id;
    elsif p_what = 'username' then
      field := 'username';
      select p.username into old_val from public.profiles p where p.id = r.person_id;
      -- The sign-up placeholder: unique to this account, and nobody else
      -- can pick that shape
      new_val := 'user_' || substr(replace(r.person_id::text, '-', ''), 1, 8);
      update public.profiles set username = new_val where id = r.person_id;
      insert into public.profile_private (user_id, username_reset_at)
      values (r.person_id, now())
      on conflict (user_id) do update set username_reset_at = now();
    else
      raise exception 'SAY_DISPLAY_OR_USERNAME';
    end if;
  end if;

  insert into public.moderation_actions
    (report_id, person_id, group_id, admin_id, action, reason, change)
  values (r.id, r.person_id, r.group_id, p_admin, 'rename', p_reason,
          jsonb_build_object('field', field, 'old', old_val, 'new', new_val));
  perform public.close_report(r.id);
end;
$$;

-- For a serious report: nobody sees the account while you look into it,
-- and it sees the "paused" screen. The report stays open; every pause
-- ends in admin_unhide or admin_delete.
create function public.admin_hide(p_report uuid, p_admin uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.reports%rowtype;
begin
  perform public.require_admin(p_admin);
  r := public.open_report(p_report);
  if r.target_kind <> 'person' then raise exception 'ONLY_PEOPLE'; end if;
  if r.person_id is null then raise exception 'TARGET_GONE'; end if;

  insert into public.profile_private (user_id, hidden_at, hidden_for_report)
  values (r.person_id, now(), r.id)
  on conflict (user_id) do update set hidden_at = now(), hidden_for_report = r.id;
  insert into public.moderation_actions (report_id, person_id, admin_id, action, reason)
  values (r.id, r.person_id, p_admin, 'hide', p_reason);
end;
$$;

-- Ends a pause: clears only that, never another restriction. With a
-- report, closes it (nothing wrong found).
create function public.admin_unhide(p_person uuid, p_admin uuid, p_reason text,
                                    p_report uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.reports%rowtype;
begin
  perform public.require_admin(p_admin);
  if not public.is_hidden(p_person) then raise exception 'NOT_HIDDEN'; end if;
  if p_report is not null then r := public.open_report(p_report); end if;

  update public.profile_private set hidden_at = null, hidden_for_report = null
  where user_id = p_person;
  insert into public.moderation_actions (report_id, person_id, admin_id, action, reason)
  values (p_report, p_person, p_admin, 'unhide', p_reason);
  if p_report is not null then perform public.close_report(p_report); end if;
end;
$$;

-- The worst cases. A person: their account and everything it owns, the
-- same as "Delete account", except the report history. A group: the
-- group. This report gets "delete"; other open reports about the same
-- target are closed automatically ("account deleted by an admin").
create function public.admin_delete(p_report uuid, p_admin uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.reports%rowtype;
begin
  perform public.require_admin(p_admin);
  r := public.open_report(p_report);
  if coalesce(r.person_id, r.group_id) is null then raise exception 'TARGET_GONE'; end if;

  insert into public.moderation_actions (report_id, person_id, group_id, admin_id, action, reason)
  values (r.id, r.person_id, r.group_id, p_admin, 'delete', p_reason);
  perform public.close_report(r.id);

  perform set_config('steptracker.deleted_by', 'admin:' || p_admin::text, true);
  if r.target_kind = 'person' then
    delete from auth.users where id = r.person_id;
  else
    delete from public.groups where id = r.group_id;
  end if;
  perform set_config('steptracker.deleted_by', '', true);
end;
$$;

-- =====================================================================
-- ADMIN QUERIES (SQL Editor only; saved in supabase/admin/reports.sql)
-- =====================================================================

-- Open reports, oldest first, with what else is known about the target
create function public.open_reports()
returns table (report_id uuid, opened_at timestamptz, hours_open integer, over_20_hours boolean,
               kind text, person_id uuid, group_id uuid, username text, display_name text,
               group_name text, reason text, note text, other_reports bigint,
               people_reporting bigint, past_actions bigint, paused boolean)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.created_at,
         (extract(epoch from now() - r.created_at) / 3600)::int,
         r.created_at < now() - interval '20 hours',
         r.target_kind, r.person_id, r.group_id,
         r.snapshot_username, r.snapshot_display_name, r.snapshot_group_name,
         r.reason, r.note,
         (select count(*) from public.reports o
          where o.id <> r.id and (o.person_id = r.person_id or o.group_id = r.group_id)),
         (select count(distinct o.reporter_id) from public.reports o
          where o.person_id = r.person_id or o.group_id = r.group_id),
         (select count(*) from public.moderation_actions a
          where a.person_id = r.person_id or a.group_id = r.group_id),
         coalesce(public.is_hidden(r.person_id), false)
  from public.reports r
  where r.status = 'open'
  order by r.created_at
$$;

-- Accounts paused by an admin (only those), how long, and any other
-- restriction they also have
create function public.hidden_accounts()
returns table (person_id uuid, username text, hidden_at timestamptz, hours_hidden integer,
               report_id uuid, also_under_age boolean, also_unfinished boolean,
               also_terms_not_accepted boolean)
language sql stable security definer set search_path = ''
as $$
  select x.user_id, p.username, x.hidden_at,
         (extract(epoch from now() - x.hidden_at) / 3600)::int,
         x.hidden_for_report,
         x.age_blocked_at is not null,
         p.onboarded_at is null,
         not public.legal_terms_ok(x.user_id)
  from public.profile_private x
  join public.profiles p on p.id = x.user_id
  where x.hidden_at is not null
  order by x.hidden_at
$$;

-- Everything about one person or group, in order: every report and every
-- action
create function public.report_history(p_person uuid default null, p_group uuid default null)
returns table (at timestamptz, what text, report_id uuid, detail text, admin_id uuid)
language sql stable security definer set search_path = ''
as $$
  select r.created_at, 'report: ' || r.reason, r.id,
         concat_ws(' / ', r.snapshot_username, r.snapshot_display_name, r.snapshot_group_name,
                   r.note),
         null::uuid
  from public.reports r
  where (p_person is not null and r.person_id = p_person)
     or (p_group is not null and r.group_id = p_group)
  union all
  select a.created_at, a.action, a.report_id, concat_ws(' / ', a.reason, a.change::text), a.admin_id
  from public.moderation_actions a
  where (p_person is not null and a.person_id = p_person)
     or (p_group is not null and a.group_id = p_group)
  order by 1
$$;

-- =====================================================================
-- WHAT THE APP IS TOLD
-- =====================================================================
-- As in 20261023000000_register.sql, plus paused, pick_username and
-- reports_enabled
create or replace function public.account_status()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  return jsonb_build_object(
    'onboarded', exists (select 1 from public.profiles p
                         where p.id = uid and p.onboarded_at is not null),
    'blocked', public.is_age_blocked(uid),
    'paused', public.is_hidden(uid),
    'pick_username', exists (select 1 from public.profile_private x
                             where x.user_id = uid and x.username_reset_at is not null),
    'reports_enabled', public.reports_enabled(),
    'terms_ok', public.legal_terms_ok(uid),
    'minimum_age', public.minimum_age(),
    'terms_to_accept', coalesce((
      select jsonb_agg(jsonb_build_object('document', c.document, 'version', c.version,
                                          'url', d.url) order by c.document)
      from public.current_legal_versions() c
      join public.legal_documents d on d.document = c.document and d.version = c.version
      where not exists (select 1 from public.legal_acceptances a
                        where a.user_id = uid and a.document = c.document
                          and a.version = c.version)), '[]'::jsonb));
end;
$$;

-- The under-age cleanup job, as in 20261024000000_blocked_cleanup.sql,
-- plus saying who deleted (so open reports close with that reason)
create or replace function public.delete_blocked_accounts()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  uid     uuid;
  deleted integer := 0;
begin
  perform set_config('steptracker.deleted_by', 'age', true);
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
  perform set_config('steptracker.deleted_by', '', true);
  return deleted;
end;
$$;

-- Picking a new username clears an admin's reset. Body as in
-- 20261023000000_register.sql, plus the marked line.
create or replace function public.change_username(p_name text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  wanted   text := lower(btrim(p_name));
  previous text;
  problem  text;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  select p.username into previous from public.profiles p where p.id = uid for update;
  if wanted = previous then return wanted; end if;

  -- Lock both names, always in the same order so two renames can't
  -- deadlock. complete_signup() takes the same lock on the name it claims.
  perform pg_advisory_xact_lock(hashtext('username:' || least(previous, coalesce(wanted, ''))));
  perform pg_advisory_xact_lock(hashtext('username:' || greatest(previous, coalesce(wanted, ''))));

  problem := public.username_problem(wanted, uid);
  if problem is not null then raise exception '%', problem; end if;

  update public.profiles set username = wanted where id = uid;
  -- A new name picked after an admin reset (Part D, rename)
  update public.profile_private set username_reset_at = null where user_id = uid;
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
-- =====================================================================
-- PERMISSIONS
-- =====================================================================
-- The app: the two report functions, signed in only
revoke all on function public.report_user(uuid, text, text, boolean) from public, anon;
revoke all on function public.report_group(uuid, text, text) from public, anon;
grant execute on function public.report_user(uuid, text, text, boolean) to authenticated;
grant execute on function public.report_group(uuid, text, text) to authenticated;

-- is_active_user: no longer from the app (see above)
revoke all on function public.is_active_user(uuid) from public, anon, authenticated;
-- The group membership rule's helper: signed in only (it is used by a
-- row rule, so it must be callable)
revoke all on function public.is_active_member(uuid, uuid) from public, anon;
grant execute on function public.is_active_member(uuid, uuid) to authenticated;

-- Internal, admin and scheduled: nobody from the app
revoke all on function public.reports_enabled() from public, anon, authenticated;
revoke all on function public.is_hidden(uuid) from public, anon, authenticated;
revoke all on function public.moderation_actions_append_only() from public, anon, authenticated;
revoke all on function public.moderation_actions_no_truncate() from public, anon, authenticated;
revoke all on function public.close_reports_on_account_delete() from public, anon, authenticated;
revoke all on function public.close_reports_on_group_delete() from public, anon, authenticated;
revoke all on function public.push_admins(text, text) from public, anon, authenticated;
revoke all on function public.alert_admins_new_report() from public, anon, authenticated;
revoke all on function public.remind_old_reports() from public, anon, authenticated;
revoke all on function public.delete_old_reports() from public, anon, authenticated;
revoke all on function public.require_admin(uuid) from public, anon, authenticated;
revoke all on function public.open_report(uuid) from public, anon, authenticated;
revoke all on function public.close_report(uuid) from public, anon, authenticated;
revoke all on function public.admin_dismiss(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_rename(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_hide(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_unhide(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_delete(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.open_reports() from public, anon, authenticated;
revoke all on function public.hidden_accounts() from public, anon, authenticated;
revoke all on function public.report_history(uuid, uuid) from public, anon, authenticated;
