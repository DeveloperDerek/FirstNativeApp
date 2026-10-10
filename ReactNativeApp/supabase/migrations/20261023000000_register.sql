-- StepTracker: a better register page, Stage 1 (step-tracker-register.txt,
-- sections 5, 6 and 12 step 1). Database only; the app changes come later.
--
-- DEPLOY TOGETHER WITH THE APP. After this runs:
--   - profiles.username can no longer be updated directly, so the Profile
--     tab's rename (src/api/profile.ts) must call change_username() first;
--   - new accounts are not "active" until complete_signup(), so new users
--     on an app without the step 2 screen (Stage 2) can't use anything.
-- Existing accounts are marked onboarded below and keep working.
--
-- Terms: no legal_documents rows are added here (there is no domain for
-- the permanent URLs yet, section 8f). While the table is empty, nobody
-- needs to accept anything. Publishing the first versions decides 9F:
-- requires_reacceptance = true sends existing users to "Updated Terms"
-- once; false treats them as accepted (and records nothing for them).
--
-- Rollback: there is no automatic down migration. Rolling back means
-- restoring the old policies and function bodies from the earlier
-- migrations, then dropping the new tables and functions. Nothing here
-- deletes or rewrites existing steps, coins, friendships or groups; the
-- only change to existing rows is profiles.onboarded_at being filled in.

-- =====================================================================
-- SERVER SETTINGS (decision 9D: the minimum age is a setting, not code)
-- =====================================================================
create table public.app_settings (
  key   text primary key,
  value integer not null
);

-- No policies: read only by the functions below. Change it from the
-- Supabase dashboard / SQL Editor.
alter table public.app_settings enable row level security;

insert into public.app_settings (key, value) values ('minimum_age', 13);

create function public.minimum_age()
returns integer language plpgsql stable security definer set search_path = ''
as $$
declare age integer;
begin
  select s.value into age from public.app_settings s where s.key = 'minimum_age';
  -- Never fall back to a number written here
  if age is null then raise exception 'MINIMUM_AGE_NOT_SET'; end if;
  return age;
end;
$$;

create function public.is_under_minimum_age(p_birth date)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_birth > (current_date - make_interval(years => public.minimum_age()))::date
$$;

-- A birth date that can't be real: in the future or over 120 years ago
create function public.is_bad_birth_date(p_birth date)
returns boolean language sql stable set search_path = ''
as $$
  select p_birth is null
      or p_birth > current_date
      or p_birth < (current_date - interval '120 years')::date
$$;

-- =====================================================================
-- PROFILES: onboarded_at, and the private birthday (section 5)
-- =====================================================================
-- null until step 2 is finished
alter table public.profiles add column onboarded_at timestamptz;

-- Accounts made before this change never see step 2
update public.profiles set onboarded_at = created_at where onboarded_at is null;

-- NOT on profiles: every signed-in user can read that table.
create table public.profile_private (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  birth_date     date,
  age_blocked_at timestamptz,
  -- the birth date of a refused account is never stored (6f)
  check (age_blocked_at is null or birth_date is null)
);

alter table public.profile_private enable row level security;

-- Read your own row only. No write policies: the birthday is written only
-- by complete_signup() and correct_birth_date(), so it always passes the
-- age check.
create policy "private read own" on public.profile_private
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.profile_private from anon, authenticated;

create function public.is_age_blocked(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profile_private x
                 where x.user_id = p_user and x.age_blocked_at is not null)
$$;

-- =====================================================================
-- USERNAMES (6a, decision 9C)
-- =====================================================================
-- Names nobody can pick. 'exact' blocks the name itself; 'contains'
-- blocks any name with the word in it. No policies: never readable from
-- the app, so the list can't be browsed.
create table public.reserved_usernames (
  word  text primary key check (word ~ '^[a-z0-9_]+$'),
  match text not null default 'exact' check (match in ('exact', 'contains'))
);

alter table public.reserved_usernames enable row level security;

insert into public.reserved_usernames (word, match) values
  ('admin',         'contains'),
  ('administrator', 'exact'),
  ('support',       'contains'),
  ('steptracker',   'contains'),
  ('step_tracker',  'contains'),
  ('moderator',     'contains'),
  ('official',      'contains'),
  ('staff',         'exact'),
  ('team',          'exact'),
  ('help',          'exact'),
  ('helpdesk',      'exact'),
  ('security',      'exact'),
  ('system',        'exact'),
  ('root',          'exact'),
  ('null',          'exact'),
  ('undefined',     'exact'),
  ('me',            'exact'),
  ('everyone',      'exact'),
  -- Offensive words. A starting list only: extend it from the SQL Editor.
  ('fuck',          'contains'),
  ('shit',          'contains'),
  ('cunt',          'contains'),
  ('bitch',         'contains'),
  ('whore',         'contains'),
  ('slut',          'contains'),
  ('nazi',          'contains'),
  ('hitler',        'contains'),
  ('rapist',        'contains'),
  ('porn',          'contains');

-- A released name is held for 30 days; only its old owner can take it
-- back in that time. No policies: only the functions below use it.
create table public.username_holds (
  username   text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  held_until timestamptz not null
);

alter table public.username_holds enable row level security;

-- Rate limit for username_available(), so it can't list every username
create table public.username_checks (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null,
  checks       integer not null
);

alter table public.username_checks enable row level security;

-- Why p_name can't be p_user's username, or null if it can. p_name must
-- already be lower-cased and trimmed.
create function public.username_problem(p_name text, p_user uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when p_name is null or p_name !~ '^[a-z0-9_]{3,20}$' then 'BAD_USERNAME'
    -- The sign-up trigger's placeholder shape. If someone took one, the
    -- account whose id it matches could never be created.
    when p_name ~ '^user_[0-9a-f]{8}$' then 'USERNAME_NOT_ALLOWED'
    when exists (select 1 from public.reserved_usernames r
                 where (r.match = 'exact' and p_name = r.word)
                    or (r.match = 'contains' and strpos(p_name, r.word) > 0))
      then 'USERNAME_NOT_ALLOWED'
    when exists (select 1 from public.username_holds h
                 where h.username = p_name and h.user_id <> p_user
                   and h.held_until > now())
      then 'USERNAME_TAKEN'
    when exists (select 1 from public.profiles p
                 where p.username = p_name and p.id <> p_user)
      then 'USERNAME_TAKEN'
  end
$$;

-- =====================================================================
-- TERMS AND PRIVACY POLICY (6h)
-- =====================================================================
-- One row per published version. Old versions are never edited or
-- deleted; a change is always a new row.
create table public.legal_documents (
  document              text not null check (document in ('terms', 'privacy')),
  version               text not null check (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  -- the permanent address of this exact version
  url                   text not null check (url ~ '^https://'),
  published_at          timestamptz not null default now(),
  -- true for material changes (decided by the owner, never the agent).
  -- No default on purpose: every version has to say.
  requires_reacceptance boolean not null,
  primary key (document, version)
);

alter table public.legal_documents enable row level security;

-- Readable signed out too: step 1 has no session yet, but has to show
-- the links and send the versions with the sign-up request.
create policy "legal documents read" on public.legal_documents
  for select to anon, authenticated using (true);

create function public.legal_documents_permanent()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'LEGAL_DOCUMENTS_ARE_PERMANENT: publish a new version instead';
end;
$$;

create trigger legal_documents_permanent
  before update or delete on public.legal_documents
  for each row execute function public.legal_documents_permanent();

create table public.legal_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  document    text not null,
  version     text not null,
  -- always the server's now(), never a time sent by the app
  accepted_at timestamptz not null default now(),
  source      text not null check (source in ('signup', 'onboarding', 'reacceptance')),
  foreign key (document, version) references public.legal_documents (document, version),
  unique (user_id, document, version)
);

alter table public.legal_acceptances enable row level security;

-- Read your own. No write policies: only the functions below record them.
create policy "legal acceptances read own" on public.legal_acceptances
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.legal_acceptances from anon, authenticated;

-- The newest published version of each document
create function public.current_legal_versions()
returns table (document text, version text)
language sql stable security definer set search_path = ''
as $$
  select distinct on (d.document) d.document, d.version
  from public.legal_documents d
  where d.published_at <= now()
  order by d.document, d.published_at desc
$$;

-- True when p_versions is an object like {"terms": "2026-11-01"} and
-- every entry in it is a current version
create function public.legal_versions_valid(p_versions jsonb)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_versions) = 'object', false)
     and not exists (
       select 1 from jsonb_each(p_versions) e
       where jsonb_typeof(e.value) <> 'string'
          or not exists (select 1 from public.current_legal_versions() c
                         where c.document = e.key and c.version = e.value #>> '{}'))
$$;

-- True unless a version that requires acceptance is newer than anything
-- this user has accepted for that document
create function public.legal_terms_ok(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1
    from (select d.document, max(d.published_at) as since
          from public.legal_documents d
          where d.requires_reacceptance and d.published_at <= now()
          group by d.document) req
    where not exists (
      select 1
      from public.legal_acceptances a
      join public.legal_documents ad on ad.document = a.document and ad.version = a.version
      where a.user_id = p_user and a.document = req.document
        and ad.published_at >= req.since))
$$;

-- =====================================================================
-- ACTIVE ACCOUNTS (6f)
-- =====================================================================
-- Active = finished step 2, not blocked for age, current required Terms
-- accepted. Everything except finishing sign-up needs it.
create function public.is_active_user(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_user is not null
     and exists (select 1 from public.profiles p
                 where p.id = p_user and p.onboarded_at is not null)
     and not public.is_age_blocked(p_user)
     and public.legal_terms_ok(p_user)
$$;

create function public.is_active_account()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.is_active_user(auth.uid()) $$;

-- What the app needs to pick a screen (section 7), for the caller only.
-- terms_to_accept: current versions they haven't accepted, for the
-- checkbox on step 2 and the "Updated Terms" screen.
create function public.account_status()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  return jsonb_build_object(
    'onboarded', exists (select 1 from public.profiles p
                         where p.id = uid and p.onboarded_at is not null),
    'blocked', public.is_age_blocked(uid),
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

-- =====================================================================
-- ROW LEVEL SECURITY: non-active accounts see and change nothing, and
-- nobody sees them (6f). (select ...) around is_active_account() lets
-- Postgres run it once per query instead of once per row.
-- =====================================================================

-- PROFILES: your own row always (the app needs it to pick the screen);
-- other people only when you and they are both active
alter policy "profiles read" on public.profiles
  using (id = auth.uid()
         or ((select public.is_active_account()) and public.is_active_user(id)));
alter policy "profiles update own" on public.profiles
  using (id = auth.uid() and (select public.is_active_account()))
  with check (id = auth.uid());

-- Only the columns the app edits directly. username and onboarded_at
-- change only through change_username() and complete_signup(). The
-- table-wide grant has to go first: a column grant limits nothing while
-- it is still there.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar, map_theme, sharing_consent_at)
  on public.profiles to authenticated;

-- DAILY STEPS
alter policy "steps read" on public.daily_steps
  using ((select public.is_active_account())
         and (user_id = auth.uid()
              or ((public.is_friend(user_id) or public.shares_group(user_id))
                  and public.is_active_user(user_id))));
alter policy "steps insert own" on public.daily_steps
  with check (user_id = auth.uid() and public.has_sharing_consent()
              and (select public.is_active_account()));
alter policy "steps update own" on public.daily_steps
  using (user_id = auth.uid() and (select public.is_active_account()))
  with check (user_id = auth.uid() and public.has_sharing_consent()
              and (select public.is_active_account()));
alter policy "steps delete own" on public.daily_steps
  using (user_id = auth.uid() and (select public.is_active_account()));

-- FRIENDSHIPS: a friend who stops being active drops out of your list
alter policy "friendships read" on public.friendships
  using (auth.uid() in (requester_id, addressee_id)
         and (select public.is_active_account())
         and public.is_active_user(case when requester_id = auth.uid()
                                        then addressee_id else requester_id end));
alter policy "friendships request" on public.friendships
  with check (requester_id = auth.uid() and status = 'pending'
              and (select public.is_active_account())
              and public.is_active_user(addressee_id));
alter policy "friendships accept" on public.friendships
  using (addressee_id = auth.uid() and (select public.is_active_account()))
  with check (addressee_id = auth.uid() and status = 'accepted');
alter policy "friendships remove" on public.friendships
  using (auth.uid() in (requester_id, addressee_id)
         and (select public.is_active_account()));

-- GROUPS
alter policy "groups read" on public.groups
  using ((select public.is_active_account())
         and (owner_id = auth.uid() or public.is_group_member(id)));
alter policy "groups create" on public.groups
  with check (owner_id = auth.uid() and (select public.is_active_account()));
alter policy "groups update" on public.groups
  using (owner_id = auth.uid() and (select public.is_active_account()))
  with check (owner_id = auth.uid());
alter policy "groups delete" on public.groups
  using (owner_id = auth.uid() and (select public.is_active_account()));

alter policy "members read" on public.group_members
  using ((select public.is_active_account())
         and public.is_group_member(group_id)
         and public.is_active_user(user_id));
alter policy "members leave or kick" on public.group_members
  using ((select public.is_active_account())
         and (user_id = auth.uid()
              or exists (select 1 from public.groups g
                         where g.id = group_id and g.owner_id = auth.uid())));

-- COINS AND SHOP
alter policy "wallet read own" on public.wallets
  using (user_id = auth.uid() and (select public.is_active_account()));
alter policy "transactions read own" on public.coin_transactions
  using (user_id = auth.uid() and (select public.is_active_account()));
alter policy "shop read" on public.shop_items
  using ((select public.is_active_account()));
alter policy "items read own" on public.user_items
  using (user_id = auth.uid() and (select public.is_active_account()));

-- LAST SEEN
alter policy "last seen read" on public.last_seen
  using ((select public.is_active_account())
         and (user_id = auth.uid()
              or ((public.is_friend(user_id) or public.shares_group(user_id))
                  and public.is_active_user(user_id))));

-- QUESTS
alter policy "quest types read" on public.quest_types
  using ((select public.is_active_account()));
alter policy "quests read" on public.quests
  using ((select public.is_active_account()) and public.is_group_member(group_id));
alter policy "quest votes read" on public.quest_votes
  using ((select public.is_active_account())
         and exists (select 1 from public.quests q
                     where q.id = quest_id and public.is_group_member(q.group_id)));
alter policy "quest party read" on public.quest_party
  using ((select public.is_active_account())
         and exists (select 1 from public.quests q
                     where q.id = quest_id and public.is_group_member(q.group_id)));
alter policy "quest hours read" on public.quest_hours
  using ((select public.is_active_account())
         and exists (select 1 from public.quests q
                     where q.id = quest_id and public.is_group_member(q.group_id)));

-- =====================================================================
-- SIGN-UP (6d)
-- =====================================================================
-- Step 2. Everything is saved together or not at all. Returns 'OK',
-- 'ALREADY_ONBOARDED' (a retry after a save that worked: the app treats
-- it as success) or 'UNDER_AGE' (the block is kept, section 6f).
-- Anything else is an error: AGE_BLOCKED, BAD_BIRTH_DATE,
-- BAD_DISPLAY_NAME, BAD_USERNAME, USERNAME_NOT_ALLOWED, USERNAME_TAKEN,
-- LEGAL_VERSION_NOT_CURRENT, TERMS_NOT_ACCEPTED.
-- p_terms: the versions ticked on screen, {"terms": "...", "privacy": "..."}.
create function public.complete_signup(
  p_username     text,
  p_display_name text,
  p_birth_date   date,
  p_terms        jsonb default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  wanted   text := lower(btrim(p_username));
  shown    text := btrim(p_display_name);
  finished timestamptz;
  problem  text;
begin
  if uid is null then raise exception 'Not signed in'; end if;

  -- One save at a time per account: a retry waits for the first one
  select p.onboarded_at into finished
  from public.profiles p where p.id = uid for update;
  if not found then raise exception 'Not signed in'; end if;

  -- Whatever birthday is sent next, a blocked account stays blocked
  if public.is_age_blocked(uid) then raise exception 'AGE_BLOCKED'; end if;
  if finished is not null then return 'ALREADY_ONBOARDED'; end if;

  if public.is_bad_birth_date(p_birth_date) then
    raise exception 'BAD_BIRTH_DATE';
  end if;

  -- A normal answer, not an error, so the block is kept. The birth date
  -- itself is not stored.
  if public.is_under_minimum_age(p_birth_date) then
    insert into public.profile_private (user_id, birth_date, age_blocked_at)
    values (uid, null, now())
    on conflict (user_id) do update set birth_date = null, age_blocked_at = now();
    return 'UNDER_AGE';
  end if;

  if shown is null or char_length(shown) not between 1 and 30 then
    raise exception 'BAD_DISPLAY_NAME';
  end if;

  -- The same lock change_username() takes on this name
  perform pg_advisory_xact_lock(hashtext('username:' || coalesce(wanted, '')));
  problem := public.username_problem(wanted, uid);
  if problem is not null then raise exception '%', problem; end if;

  if p_terms is not null and not public.legal_versions_valid(p_terms) then
    raise exception 'LEGAL_VERSION_NOT_CURRENT';
  end if;
  -- Nobody is onboarded without an acceptance of the current versions,
  -- either from step 1 (the sign-up trigger) or sent now
  if exists (
    select 1 from public.current_legal_versions() c
    where not exists (select 1 from public.legal_acceptances a
                      where a.user_id = uid and a.document = c.document
                        and a.version = c.version)
      and (p_terms ->> c.document) is distinct from c.version
  ) then
    raise exception 'TERMS_NOT_ACCEPTED';
  end if;

  insert into public.legal_acceptances (user_id, document, version, source)
  select uid, c.document, c.version, 'onboarding'
  from public.current_legal_versions() c
  where (p_terms ->> c.document) = c.version
  on conflict (user_id, document, version) do nothing;

  update public.profiles
  set username = wanted, display_name = shown, onboarded_at = now()
  where id = uid;

  -- Their own held name, taken back
  delete from public.username_holds h where h.username = wanted and h.user_id = uid;

  insert into public.profile_private (user_id, birth_date)
  values (uid, p_birth_date)
  on conflict (user_id) do update set birth_date = excluded.birth_date;

  return 'OK';
exception
  -- Two people claimed the same name at the same moment: the unique
  -- constraint lets one through. Everything above is undone.
  when unique_violation then raise exception 'USERNAME_TAKEN';
end;
$$;

-- Rename from the Profile tab. The old name is held for this user for 30
-- days. Returns the new (cleaned) name.
create function public.change_username(p_name text)
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

-- For the live tick while typing. Held, reserved and invalid names are
-- not available. At most 60 checks per 10 minutes per account.
create function public.username_available(p_name text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  uid    uuid := auth.uid();
  wanted text := lower(btrim(p_name));
  used   integer;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if public.is_age_blocked(uid) then raise exception 'AGE_BLOCKED'; end if;

  insert into public.username_checks as c (user_id, window_start, checks)
  values (uid, now(), 1)
  on conflict (user_id) do update set
    window_start = case when c.window_start < now() - interval '10 minutes'
                        then now() else c.window_start end,
    checks       = case when c.window_start < now() - interval '10 minutes'
                        then 1 else c.checks + 1 end
  returning c.checks into used;
  if used > 60 then raise exception 'RATE_LIMITED'; end if;

  -- Your own current name is yours
  if exists (select 1 from public.profiles p where p.id = uid and p.username = wanted) then
    return true;
  end if;
  return public.username_problem(wanted, uid) is null;
end;
$$;

-- Re-accepting after a material change (the "Updated Terms" screen)
create function public.accept_legal_documents(p_versions jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if public.is_age_blocked(uid) then raise exception 'AGE_BLOCKED'; end if;
  if not public.legal_versions_valid(p_versions) then
    raise exception 'LEGAL_VERSION_NOT_CURRENT';
  end if;

  insert into public.legal_acceptances (user_id, document, version, source)
  select uid, c.document, c.version, 'reacceptance'
  from public.current_legal_versions() c
  where (p_versions ->> c.document) = c.version
  on conflict (user_id, document, version) do nothing;
end;
$$;

-- The sign-up trigger: unchanged, except it now records Terms ticked on
-- step 1. Email sign-up has no session yet, so the app sends the versions
-- with the request (options.data.accepted_legal). They are recorded with
-- the server's clock, and only when they are exactly the current
-- versions; anything else records nothing and step 2 asks again.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  sent jsonb := new.raw_user_meta_data -> 'accepted_legal';
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    'user_' || substr(replace(new.id::text, '-', ''), 1, 8),
    coalesce(new.raw_user_meta_data->>'full_name',
             split_part(new.email, '@', 1))
  );

  if public.legal_versions_valid(sent)
     and exists (select 1 from public.current_legal_versions())
     and (select count(*) from jsonb_object_keys(sent))
         = (select count(*) from public.current_legal_versions()) then
    insert into public.legal_acceptances (user_id, document, version, source)
    select new.id, c.document, c.version, 'signup'
    from public.current_legal_versions() c;
  end if;

  return new;
end;
$$;

-- =====================================================================
-- BIRTHDAY CORRECTIONS (6g; support only)
-- =====================================================================
create table public.birthday_correction_requests (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles(id) on delete cascade,
  -- cleared once the request is handled
  requested_birth_date date,
  note                 text check (char_length(note) <= 500),
  verified_via         text not null check (verified_via in ('in_app', 'email')),
  -- null until the owner of the account is confirmed
  verified_at          timestamptz,
  status               text not null default 'open'
                       check (status in ('open', 'corrected', 'blocked', 'rejected')),
  handled_by           text,
  handled_at           timestamptz,
  created_at           timestamptz not null default now()
);

-- One open request per account
create unique index birthday_correction_one_open
  on public.birthday_correction_requests (user_id) where status = 'open';

alter table public.birthday_correction_requests enable row level security;

-- Read your own. Nobody writes them directly.
create policy "birthday requests read own" on public.birthday_correction_requests
  for select to authenticated
  using (user_id = auth.uid() and (select public.is_active_account()));
revoke insert, update, delete on public.birthday_correction_requests from anon, authenticated;

-- The one-time link for requests made without the app. Only a hash is
-- kept. Separate from the requests so the owner's read access never
-- shows it. No policies.
create table public.birthday_correction_tokens (
  request_id uuid primary key
             references public.birthday_correction_requests(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz
);

alter table public.birthday_correction_tokens enable row level security;

-- Every correction, kept even after the account is deleted (so no
-- foreign keys). The old and new dates are never copied here.
create table public.birthday_correction_audit (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null,
  user_id      uuid not null,
  run_by       text not null,
  run_at       timestamptz not null default now(),
  verified_via text not null,
  reason       text not null,
  outcome      text not null check (outcome in ('corrected', 'blocked', 'rejected'))
);

alter table public.birthday_correction_audit enable row level security;

-- Profile > "Wrong date?". Verified by the session itself.
create function public.request_birthday_correction(p_birth_date date, p_note text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rid uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if public.is_bad_birth_date(p_birth_date) then raise exception 'BAD_BIRTH_DATE'; end if;
  if char_length(coalesce(p_note, '')) > 500 then raise exception 'NOTE_TOO_LONG'; end if;

  insert into public.birthday_correction_requests
    (user_id, requested_birth_date, note, verified_via, verified_at)
  values (uid, p_birth_date, nullif(btrim(p_note), ''), 'in_app', now())
  returning id into rid;
  return rid;
exception
  when unique_violation then raise exception 'REQUEST_ALREADY_OPEN';
end;
$$;

-- ADMIN ONLY. Support starts a request for someone who can't sign in.
-- Returns the one-time token, which must be sent ONLY to the account's
-- verified email address (by an Edge Function; not built yet, it needs
-- the domain and email sender from section 8f). Valid for 24 hours.
create function public.start_birthday_correction_by_email(
  p_user uuid, p_birth_date date, p_note text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  rid   uuid;
  token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'NO_SUCH_ACCOUNT';
  end if;
  if public.is_bad_birth_date(p_birth_date) then raise exception 'BAD_BIRTH_DATE'; end if;

  insert into public.birthday_correction_requests
    (user_id, requested_birth_date, note, verified_via)
  values (p_user, p_birth_date, nullif(btrim(p_note), ''), 'email')
  returning id into rid;

  insert into public.birthday_correction_tokens (request_id, token_hash, expires_at)
  values (rid, encode(extensions.digest(token, 'sha256'), 'hex'), now() + interval '24 hours');
  return token;
exception
  when unique_violation then raise exception 'REQUEST_ALREADY_OPEN';
end;
$$;

-- ADMIN ONLY. The link from that email was opened: the request is now
-- verified. False if the token is wrong, used or expired.
create function public.confirm_birthday_correction(p_token text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare rid uuid;
begin
  update public.birthday_correction_tokens t
  set used_at = now()
  where t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and t.used_at is null and t.expires_at > now()
  returning t.request_id into rid;
  if rid is null then return false; end if;

  update public.birthday_correction_requests r
  set verified_at = now()
  where r.id = rid and r.status = 'open';
  return found;
end;
$$;

-- ADMIN ONLY. Applies a verified, open request, using the date in the
-- request. p_run_by is the support person's name, for the audit row.
-- Returns 'corrected', or 'blocked' when the date is under the minimum
-- age (the 6f process then applies, even long after onboarding).
create function public.correct_birth_date(p_request_id uuid, p_reason text, p_run_by text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r       public.birthday_correction_requests%rowtype;
  outcome text;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  if coalesce(btrim(p_run_by), '') = '' then raise exception 'RUN_BY_REQUIRED'; end if;

  select * into r from public.birthday_correction_requests
  where id = p_request_id for update;
  if not found or r.status <> 'open' or r.verified_at is null then
    raise exception 'REQUEST_NOT_VERIFIED';
  end if;
  -- A blocked account stays blocked (6f); this function can't undo that
  if public.is_age_blocked(r.user_id) then raise exception 'AGE_BLOCKED'; end if;
  if public.is_bad_birth_date(r.requested_birth_date) then
    raise exception 'BAD_BIRTH_DATE';
  end if;

  if public.is_under_minimum_age(r.requested_birth_date) then
    insert into public.profile_private (user_id, birth_date, age_blocked_at)
    values (r.user_id, null, now())
    on conflict (user_id) do update set birth_date = null, age_blocked_at = now();
    outcome := 'blocked';
  else
    insert into public.profile_private (user_id, birth_date)
    values (r.user_id, r.requested_birth_date)
    on conflict (user_id) do update set birth_date = excluded.birth_date;
    outcome := 'corrected';
  end if;

  update public.birthday_correction_requests
  set status = outcome, requested_birth_date = null,
      handled_by = p_run_by, handled_at = now()
  where id = r.id;

  insert into public.birthday_correction_audit
    (request_id, user_id, run_by, verified_via, reason, outcome)
  values (r.id, r.user_id, p_run_by, r.verified_via, p_reason, outcome);
  return outcome;
end;
$$;

-- ADMIN ONLY. Closes a request without changing anything.
create function public.reject_birthday_correction(p_request_id uuid, p_reason text, p_run_by text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.birthday_correction_requests%rowtype;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  if coalesce(btrim(p_run_by), '') = '' then raise exception 'RUN_BY_REQUIRED'; end if;

  select * into r from public.birthday_correction_requests
  where id = p_request_id and status = 'open' for update;
  if not found then raise exception 'REQUEST_NOT_OPEN'; end if;

  update public.birthday_correction_requests
  set status = 'rejected', requested_birth_date = null,
      handled_by = p_run_by, handled_at = now()
  where id = r.id;

  insert into public.birthday_correction_audit
    (request_id, user_id, run_by, verified_via, reason, outcome)
  values (r.id, r.user_id, p_run_by, r.verified_via, p_reason, 'rejected');
end;
$$;

-- ADMIN ONLY. For the hourly cleanup job (Stage 7b): blocked accounts
-- more than an hour old, whose login accounts it deletes.
create function public.blocked_accounts_to_delete()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select x.user_id from public.profile_private x
  where x.age_blocked_at < now() - interval '1 hour'
$$;

-- =====================================================================
-- EXISTING DATA FUNCTIONS: refuse non-active accounts (6f). These run
-- with extra rights and skip the row rules, so each checks at the top.
-- Bodies are the latest versions, with only that check added unless a
-- comment says otherwise.
-- =====================================================================

create or replace function public.join_group(code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  select id into gid from public.groups where invite_code = lower(trim(code));
  if gid is null then raise exception 'Invalid invite code'; end if;
  insert into public.group_members (group_id, user_id)
  values (gid, auth.uid())
  on conflict do nothing;
  return gid;
end;
$$;

-- Leaderboards run as the caller, so the row rules above already leave
-- out non-active people; the check here keeps them out for non-active
-- callers too.
create or replace function public.group_leaderboard(gid uuid, from_day date, to_day date)
returns table (user_id uuid, display_name text, avatar jsonb, total_steps bigint)
language sql stable
as $$
  select p.id, p.display_name, p.avatar, coalesce(sum(s.steps), 0)::bigint
  from public.group_members m
  join public.profiles p on p.id = m.user_id
  left join public.daily_steps s
    on s.user_id = m.user_id and s.day between from_day and to_day
  where m.group_id = gid and (select public.is_active_account())
  group by p.id, p.display_name, p.avatar
  order by 4 desc;
$$;

create or replace function public.friends_leaderboard(from_day date, to_day date)
returns table (user_id uuid, display_name text, avatar jsonb, total_steps bigint)
language sql stable
as $$
  select p.id, p.display_name, p.avatar, coalesce(sum(s.steps), 0)::bigint
  from public.profiles p
  left join public.daily_steps s
    on s.user_id = p.id and s.day between from_day and to_day
  where (p.id = auth.uid() or public.is_friend(p.id))
    and (select public.is_active_account())
  group by p.id, p.display_name, p.avatar
  order by 4 desc;
$$;

create or replace function public.claim_daily_rewards()
returns integer                    -- coins granted by this call
language plpgsql security definer set search_path = ''
as $$
declare
  uid         uuid := auth.uid();
  goal        constant integer := 10000;   -- steps needed
  reward      constant integer := 100;     -- coins per day
  window_days constant integer := 7;       -- how far back to pay
  granted     integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  with paid as (
    insert into public.coin_transactions (user_id, amount, reason, ref)
    select uid, reward, 'daily_goal', s.day::text
    from public.daily_steps s
    where s.user_id = uid
      and s.steps >= goal
      and s.day >= current_date - window_days
      and s.day <= current_date + 1        -- no future days
    on conflict (user_id, reason, ref) do nothing
    returning amount
  )
  select coalesce(sum(amount), 0) into granted from paid;

  if granted > 0 then
    insert into public.wallets (user_id, balance)
    values (uid, granted)
    on conflict (user_id)
    do update set balance = public.wallets.balance + excluded.balance;
  end if;

  return granted;
end;
$$;

create or replace function public.daily_shop()
returns table (id text, price integer, refreshes_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid       uuid := auth.uid();
  today     date := public.shop_day();
  -- Items per day. With about 80 paid items, 6 a day still takes two
  -- weeks to show everything once.
  shop_size constant integer := 6;
  picked    integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  -- If the app calls this twice at once, make the second call wait so
  -- the user cannot end up with two different shops.
  perform pg_advisory_xact_lock(hashtext(uid::text));

  select count(*) into picked
  from public.user_daily_shop d
  where d.user_id = uid and d.shop_day = today and d.replaced_at is null;

  -- Pick (or top up) this user's items for today and remember them
  if picked < shop_size then
    insert into public.user_daily_shop (user_id, shop_day, item_id)
    select uid, today, s.id
    from public.shop_items s
    left join lateral (
      select max(h.shop_day) as last_shown
      from public.user_daily_shop h
      where h.user_id = uid and h.item_id = s.id
    ) seen on true
    where s.active
      -- never offer something the user already owns
      and not exists (select 1 from public.user_items u
                      where u.user_id = uid and u.item_id = s.id)
      -- or something already in (or refreshed out of) today's shop
      and not exists (select 1 from public.user_daily_shop t
                      where t.user_id = uid and t.shop_day = today and t.item_id = s.id)
    -- Never-shown items first, then the ones shown longest ago.
    -- random() breaks ties, which makes each user's shop different.
    order by seen.last_shown asc nulls first, random()
    limit shop_size - picked;
  end if;

  return query
    select
      s.id,
      s.price,
      ((today + 1)::timestamp at time zone 'America/Los_Angeles')
    from public.user_daily_shop d
    join public.shop_items s on s.id = d.item_id
    where d.user_id = uid and d.shop_day = today and d.replaced_at is null and s.active;
end;
$$;

create or replace function public.purchase_item(p_item text)
returns integer                    -- new balance
language plpgsql security definer set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  cost integer;
  bal  integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  select s.price into cost
  from public.shop_items s where s.id = p_item and s.active;
  if cost is null then
    raise exception 'ITEM_NOT_FOR_SALE';
  end if;

  -- Must be in today's rotation. Without this, someone could buy any
  -- item on any day by calling this function directly.
  if not exists (select 1 from public.daily_shop() d where d.id = p_item) then
    raise exception 'NOT_IN_TODAYS_SHOP';
  end if;

  -- Make sure a wallet row exists, then lock it so two purchases at the
  -- same moment cannot both spend the same coins.
  insert into public.wallets (user_id) values (uid)
  on conflict (user_id) do nothing;
  select w.balance into bal
  from public.wallets w where w.user_id = uid for update;

  if exists (select 1 from public.user_items u
             where u.user_id = uid and u.item_id = p_item) then
    raise exception 'ALREADY_OWNED';
  end if;

  if bal < cost then
    raise exception 'NOT_ENOUGH_COINS';
  end if;

  update public.wallets set balance = balance - cost where user_id = uid;
  insert into public.user_items (user_id, item_id) values (uid, p_item);
  insert into public.coin_transactions (user_id, amount, reason, ref)
  values (uid, -cost, 'purchase', p_item);

  return bal - cost;
end;
$$;

create or replace function public.claim_checkin()
returns table (granted integer, next_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  bonus    constant integer  := 10;                 -- coins per check-in
  cooldown constant interval := interval '6 hours';
  last_at  timestamptz;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  -- Same rule as step rewards: sharing is required to earn coins
  if not public.has_sharing_consent() then
    return query select 0, null::timestamptz;
    return;
  end if;

  -- Lock the wallet so two taps at once cannot both collect
  insert into public.wallets (user_id) values (uid)
  on conflict (user_id) do nothing;
  select w.last_checkin_at into last_at
  from public.wallets w where w.user_id = uid for update;

  -- Too soon: grant nothing, say when the next one is ready.
  -- now() is the server's clock, so changing the phone's time does nothing.
  if last_at is not null and now() < last_at + cooldown then
    return query select 0, last_at + cooldown;
    return;
  end if;

  update public.wallets w
  set balance = w.balance + bonus, last_checkin_at = now()
  where w.user_id = uid;

  insert into public.coin_transactions (user_id, amount, reason, ref)
  values (uid, bonus, 'checkin',
          to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS'));

  return query select bonus, now() + cooldown;
end;
$$;

create or replace function public.refresh_shop()
returns table (refreshed boolean, granted integer, next_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  bonus    constant integer  := 25;                 -- coins per refresh
  cooldown constant interval := interval '12 hours';
  last_at  timestamptz;
  paid     integer := 0;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  -- The same lock daily_shop() takes, so a purchase or a shop load
  -- can't run in the middle of the swap
  perform pg_advisory_xact_lock(hashtext(uid::text));

  -- Lock the wallet so two taps at once cannot both refresh
  insert into public.wallets (user_id) values (uid)
  on conflict (user_id) do nothing;
  select w.last_shop_refresh_at into last_at
  from public.wallets w where w.user_id = uid for update;

  -- now() is the server's clock, so changing the phone's time does nothing
  if last_at is not null and now() < last_at + cooldown then
    return query select false, 0, last_at + cooldown;
    return;
  end if;

  -- Everything in today's shop goes, bought items included, so the
  -- refresh always brings a full set. daily_shop() below picks it.
  update public.user_daily_shop d
  set replaced_at = now()
  where d.user_id = uid and d.shop_day = public.shop_day() and d.replaced_at is null;

  perform 1 from public.daily_shop();

  -- Same rule as step rewards: sharing is required to earn coins
  if public.has_sharing_consent() then
    paid := bonus;
    insert into public.coin_transactions (user_id, amount, reason, ref)
    values (uid, bonus, 'shop_refresh',
            to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS'));
  end if;

  update public.wallets w
  set balance = w.balance + paid, last_shop_refresh_at = now()
  where w.user_id = uid;

  return query select true, paid, now() + cooldown;
end;
$$;

create or replace function public.mark_seen()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then return; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.has_sharing_consent() then return; end if;
  insert into public.last_seen (user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = now();
end;
$$;

-- Changed beyond the check: voting and the party count only active
-- members. A member who can't vote (vote_quest() refuses them) would
-- otherwise hold every quest in the group until its deadline.
create or replace function public.quest_advance(qid uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  q          public.quests%rowtype;
  t          public.quest_types%rowtype;
  everyone   boolean;
  daily_cap  constant integer := 600;
  member     record;
  earned     integer;
  pay        integer;
  today_from timestamptz;
begin
  select * into q from public.quests where id = qid for update;
  if not found then return; end if;
  select * into t from public.quest_types where id = q.type_id;

  -- VOTING: locked in once every current active group member has
  -- accepted. Anyone who joined during voting has to accept too.
  if q.status = 'voting' then
    select bool_and(coalesce(v.accepted, false)) into everyone
    from public.group_members m
    left join public.quest_votes v on v.quest_id = q.id and v.user_id = m.user_id
    where m.group_id = q.group_id and public.is_active_user(m.user_id);

    if coalesce(everyone, false)
       and (select count(*) from public.group_members m
            where m.group_id = q.group_id and public.is_active_user(m.user_id)) >= 2
       and now() < q.vote_deadline then
      q.starts_at  := case when q.start_asap then now() else q.starts_at end;
      q.ends_at    := q.starts_at + make_interval(hours => t.hours);
      q.status     := 'active';
      q.party_size := (select count(*) from public.group_members m
                       where m.group_id = q.group_id and public.is_active_user(m.user_id));

      insert into public.quest_party (quest_id, user_id)
      select q.id, m.user_id from public.group_members m
      where m.group_id = q.group_id and public.is_active_user(m.user_id);

      update public.quests
      set status = q.status, starts_at = q.starts_at, ends_at = q.ends_at,
          party_size = q.party_size
      where id = q.id;
    elsif now() >= q.vote_deadline then
      -- Not everyone answered in time: cancelled quietly
      update public.quests set status = 'cancelled', cancelled_at = q.vote_deadline
      where id = q.id;
      return;
    else
      return;
    end if;
  end if;

  -- ACTIVE: failed only once the grace period is over. (Completed is
  -- set by upload_quest_steps() the moment the goal is reached.)
  if q.status = 'active' and now() >= q.ends_at + public.quest_grace() then
    q.status := 'failed';
    update public.quests set status = 'failed' where id = q.id;
  end if;

  -- PAID: after the window and grace period, once
  if q.status in ('completed', 'failed') and q.settled_at is null
     and now() >= q.ends_at + public.quest_grace() then
    if q.status = 'completed' then
      q.step_coins := public.quest_step_coins(q.total_steps, q.goal);
      q.multiplier := public.quest_multiplier(q.party_size);
      q.coins_each := public.quest_coins_each(q.total_steps, q.goal, q.party_size);
    end if;

    update public.quests
    set settled_at = now(), step_coins = q.step_coins,
        multiplier = q.multiplier, coins_each = q.coins_each
    where id = q.id;

    if q.status = 'completed' then
      -- The daily cap is counted per shop day, like the daily shop
      today_from := (public.shop_day()::timestamp at time zone 'America/Los_Angeles');

      -- Only party members who are still in the group and still share
      -- their steps are paid (section 8)
      for member in
        select p.user_id
        from public.quest_party p
        join public.group_members m on m.group_id = q.group_id and m.user_id = p.user_id
        join public.profiles pr on pr.id = p.user_id and pr.sharing_consent_at is not null
        where p.quest_id = q.id
      loop
        -- Lock the wallet: two quests paying at once must both see the cap
        insert into public.wallets (user_id) values (member.user_id)
        on conflict (user_id) do nothing;
        perform 1 from public.wallets w where w.user_id = member.user_id for update;

        select coalesce(sum(c.amount), 0) into earned
        from public.coin_transactions c
        where c.user_id = member.user_id and c.reason = 'quest'
          and c.created_at >= today_from;

        pay := least(q.coins_each, greatest(0, daily_cap - earned));

        insert into public.coin_transactions (user_id, amount, reason, ref)
        values (member.user_id, pay, 'quest', q.id::text)
        on conflict (user_id, reason, ref) do nothing;
        if found then
          update public.wallets set balance = balance + pay where user_id = member.user_id;
          update public.quest_party set coins_paid = pay
          where quest_id = q.id and user_id = member.user_id;
        end if;
      end loop;
    end if;
  end if;
end;
$$;

-- Changed beyond the check: GROUP_TOO_SMALL counts active members, the
-- same as quest_advance()
create or replace function public.propose_quest(gid uuid, p_type text, p_starts_at timestamptz)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  t        public.quest_types%rowtype;
  last_end timestamptz;
  qid      uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.is_group_member(gid) then raise exception 'NOT_A_MEMBER'; end if;
  if not public.has_sharing_consent() then raise exception 'SHARING_REQUIRED'; end if;

  select * into t from public.quest_types where id = p_type and active;
  if not found then raise exception 'UNKNOWN_QUEST'; end if;

  -- Two proposals at the same moment: the second waits, then sees the first
  perform pg_advisory_xact_lock(hashtext('quest:' || gid::text));
  perform public.quest_advance_group(gid);

  if (select count(*) from public.group_members m
      where m.group_id = gid and public.is_active_user(m.user_id)) < 2 then
    raise exception 'GROUP_TOO_SMALL';
  end if;

  -- Only one quest in voting or under way at a time. A quest still in
  -- its window or grace period counts as under way.
  if exists (select 1 from public.quests
             where group_id = gid
               and (status in ('voting', 'active')
                    or (status = 'completed' and settled_at is null))) then
    raise exception 'QUEST_IN_PROGRESS';
  end if;

  -- 1 hour of rest after the last quest ended or was cancelled
  select max(coalesce(cancelled_at, ends_at)) into last_end
  from public.quests where group_id = gid;
  if last_end is not null and now() < last_end + public.quest_cooldown() then
    raise exception 'QUEST_COOLDOWN';
  end if;

  if p_starts_at is not null
     and (p_starts_at < now() + interval '5 minutes'
          or p_starts_at > now() + interval '24 hours') then
    raise exception 'BAD_START_TIME';
  end if;

  insert into public.quests (group_id, type_id, proposer_id, start_asap,
                             vote_deadline, starts_at, goal)
  values (gid, t.id, uid, p_starts_at is null,
          coalesce(p_starts_at, now() + interval '24 hours'), p_starts_at, t.goal)
  returning id into qid;

  -- The proposer counts as having accepted
  insert into public.quest_votes (quest_id, user_id, accepted) values (qid, uid, true);
  return qid;
end;
$$;

create or replace function public.vote_quest(qid uuid, p_accept boolean)
returns text                              -- the quest's status afterwards
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q   public.quests%rowtype;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  select * into q from public.quests where id = qid;
  if not found or not public.is_group_member(q.group_id) then
    raise exception 'NOT_A_MEMBER';
  end if;

  perform pg_advisory_xact_lock(hashtext('quest:' || q.group_id::text));
  perform public.quest_advance(qid);
  select * into q from public.quests where id = qid;
  if q.status <> 'voting' then raise exception 'VOTING_CLOSED'; end if;

  -- Sharing is needed to take part, like the daily reward
  if p_accept and not public.has_sharing_consent() then
    raise exception 'SHARING_REQUIRED';
  end if;

  insert into public.quest_votes (quest_id, user_id, accepted) values (qid, uid, p_accept)
  on conflict (quest_id, user_id)
  do update set accepted = excluded.accepted, voted_at = now();

  if not p_accept then
    -- Anyone declines: cancelled at once, and the group sees who
    update public.quests
    set status = 'cancelled', cancelled_at = now(), declined_by = uid
    where id = qid;
    return 'cancelled';
  end if;

  perform public.quest_advance(qid);
  return (select status from public.quests where id = qid);
end;
$$;

create or replace function public.upload_quest_steps(qid uuid, p_hours jsonb)
returns integer                           -- the group's total afterwards
language plpgsql security definer set search_path = ''
as $$
declare
  uid        uuid := auth.uid();
  q          public.quests%rowtype;
  pieces     integer;
  hour_sum   integer;
  daily_sum  integer;
  counted    integer;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.has_sharing_consent() then raise exception 'SHARING_REQUIRED'; end if;

  select * into q from public.quests where id = qid;
  if not found then raise exception 'NOT_IN_PARTY'; end if;
  perform pg_advisory_xact_lock(hashtext('quest:' || q.group_id::text));
  perform public.quest_advance(qid);
  select * into q from public.quests where id = qid;

  if not exists (select 1 from public.quest_party
                 where quest_id = qid and user_id = uid) then
    raise exception 'NOT_IN_PARTY';
  end if;
  -- Left the group: steps so far still count, new ones do not
  if not public.is_group_member(q.group_id) then raise exception 'NOT_A_MEMBER'; end if;

  -- The server's clock decides the window and the grace period
  if q.status not in ('active', 'completed')
     or now() < q.starts_at
     or now() >= q.ends_at + public.quest_grace() then
    raise exception 'QUEST_NOT_OPEN';
  end if;

  pieces := ceil(extract(epoch from q.ends_at - q.starts_at) / 3600)::integer;

  if jsonb_typeof(p_hours) <> 'array' then raise exception 'BAD_STEPS'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_hours) e
    where coalesce(jsonb_typeof(e->'hour'), '') <> 'number'
       or coalesce(jsonb_typeof(e->'steps'), '') <> 'number'
       or (e->>'hour')::integer < 0 or (e->>'hour')::integer >= pieces
       or (e->>'steps')::integer < 0
       -- no steps for an hour that has not started yet
       or q.starts_at + make_interval(hours => (e->>'hour')::integer) > now()
  ) then
    raise exception 'BAD_STEPS';
  end if;
  -- More than 15,000 in an hour is impossible: refuse the whole upload
  if exists (select 1 from jsonb_array_elements(p_hours) e
             where (e->>'steps')::integer > 15000) then
    raise exception 'TOO_MANY_STEPS';
  end if;

  delete from public.quest_hours where quest_id = qid and user_id = uid;
  insert into public.quest_hours (quest_id, user_id, hour_index, steps)
  select qid, uid, (e->>'hour')::integer, max((e->>'steps')::integer)
  from jsonb_array_elements(p_hours) e
  group by (e->>'hour')::integer;

  select coalesce(sum(steps), 0) into hour_sum
  from public.quest_hours where quest_id = qid and user_id = uid;

  -- Never more than their step total for those days. Daily rows are
  -- local days, so look a day either side of the window.
  select coalesce(sum(steps), 0) into daily_sum
  from public.daily_steps
  where user_id = uid
    and day between (q.starts_at at time zone 'utc')::date - 1
                and (q.ends_at at time zone 'utc')::date + 1;
  counted := least(hour_sum, daily_sum);

  update public.quest_party set steps = counted, uploaded_at = now()
  where quest_id = qid and user_id = uid;

  -- Everyone's steps count, including people who have since left
  update public.quests
  set total_steps = (select coalesce(sum(steps), 0) from public.quest_party where quest_id = qid)
  where id = qid
  returning * into q;

  -- Goal reached: completed straight away, even in the grace period
  if q.status = 'active' and q.total_steps >= q.goal then
    update public.quests set status = 'completed', completed_at = now() where id = qid;
  end if;

  return q.total_steps;
end;
$$;

-- Changed beyond the check: non-active people are left out of members
create or replace function public.group_quest(gid uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  q       public.quests%rowtype;
  members jsonb;
  ready   timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.is_group_member(gid) then raise exception 'NOT_A_MEMBER'; end if;

  perform pg_advisory_xact_lock(hashtext('quest:' || gid::text));
  perform public.quest_advance_group(gid);

  select max(coalesce(cancelled_at, ends_at)) + public.quest_cooldown() into ready
  from public.quests where group_id = gid;

  select * into q from public.quests
  where group_id = gid
    and (status <> 'cancelled' or now() < cancelled_at + public.quest_cooldown())
    and (settled_at is null or now() < settled_at + interval '24 hours')
  order by created_at desc limit 1;

  -- Everyone involved: current group members (they vote) plus anyone in
  -- the party who has since left (their steps still count). With no
  -- quest, q.id is null and this is just the group, for the proposal.
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.steps desc, r.display_name), '[]')
  into members
  from (
    select
      pr.id as user_id,
      pr.display_name,
      pr.avatar,
      (pr.sharing_consent_at is not null) as sharing,
      v.accepted,
      (p.user_id is not null) as in_party,
      (m.user_id is not null) as in_group,
      coalesce(p.steps, 0) as steps,
      p.uploaded_at,
      p.coins_paid,
      -- only for people still in the group, like the player card
      case when m.user_id is not null then ls.seen_at end as last_seen
    from public.profiles pr
    left join public.group_members m on m.group_id = gid and m.user_id = pr.id
    left join public.quest_party p on p.quest_id = q.id and p.user_id = pr.id
    left join public.quest_votes v on v.quest_id = q.id and v.user_id = pr.id
    left join public.last_seen ls on ls.user_id = pr.id
    where (m.user_id is not null or p.user_id is not null)
      and public.is_active_user(pr.id)
  ) r;

  return jsonb_build_object(
    'quest', case when q.id is null then null else jsonb_build_object(
      'id', q.id,
      'type_id', q.type_id,
      'proposer_id', q.proposer_id,
      'status', q.status,
      'start_asap', q.start_asap,
      'vote_deadline', q.vote_deadline,
      'starts_at', q.starts_at,
      'ends_at', q.ends_at,
      'grace_ends_at', q.ends_at + public.quest_grace(),
      'goal', q.goal,
      'party_size', q.party_size,
      'total_steps', q.total_steps,
      'completed_at', q.completed_at,
      'cancelled_at', q.cancelled_at,
      'declined_by', q.declined_by,
      'settled_at', q.settled_at,
      'step_coins', q.step_coins,
      'multiplier', q.multiplier,
      'coins_each', q.coins_each) end,
    'members', members,
    'next_quest_at', ready,
    'server_now', now());
end;
$$;

-- Changed beyond the check: non-active people are left out of
-- waiting_for and proposer_name
create or replace function public.my_quests()
returns table (
  quest_id      uuid,
  group_id      uuid,
  group_name    text,
  type_id       text,
  status        text,
  proposer_name text,
  my_vote       boolean,
  in_party      boolean,
  waiting_for   text[],
  vote_deadline timestamptz,
  starts_at     timestamptz,
  ends_at       timestamptz,
  goal          integer,
  total_steps   integer,
  settled_at    timestamptz,
  coins_paid    integer,
  result_seen   boolean
)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  for gid in select m.group_id from public.group_members m where m.user_id = uid loop
    perform pg_advisory_xact_lock(hashtext('quest:' || gid::text));
    perform public.quest_advance_group(gid);
  end loop;

  return query
    select
      q.id, q.group_id, g.name, q.type_id, q.status,
      pp.display_name,
      v.accepted,
      (p.user_id is not null),
      case when q.status = 'voting' then
        array(select coalesce(pr.display_name, 'Someone')
              from public.group_members m
              join public.profiles pr on pr.id = m.user_id
              left join public.quest_votes v2 on v2.quest_id = q.id and v2.user_id = m.user_id
              where m.group_id = q.group_id and v2.user_id is null
                and public.is_active_user(m.user_id)
              order by pr.display_name)
      end,
      q.vote_deadline, q.starts_at, q.ends_at, q.goal, q.total_steps,
      q.settled_at, p.coins_paid, coalesce(p.result_seen, false)
    from public.quests q
    join public.groups g on g.id = q.group_id
    join public.group_members me on me.group_id = q.group_id and me.user_id = uid
    left join public.profiles pp on pp.id = q.proposer_id and public.is_active_user(pp.id)
    left join public.quest_votes v on v.quest_id = q.id and v.user_id = uid
    left join public.quest_party p on p.quest_id = q.id and p.user_id = uid
    where q.status = 'voting'
       or (q.status in ('active', 'completed') and q.settled_at is null)
       -- a finished quest I took part in and have not seen the result of
       or (q.status in ('completed', 'failed') and q.settled_at is not null
           and p.user_id is not null and not p.result_seen
           and q.settled_at > now() - interval '7 days')
    order by q.created_at desc;
end;
$$;

-- Was plain SQL; plpgsql now so it can refuse
create or replace function public.mark_quest_seen(qid uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  update public.quest_party set result_seen = true
  where quest_id = qid and user_id = auth.uid()
    and exists (select 1 from public.quests q where q.id = qid and q.settled_at is not null);
end;
$$;

-- =====================================================================
-- WHO CAN RUN WHAT (6e)
-- =====================================================================
-- Taken from everyone first (Supabase grants new functions to anon and
-- authenticated by default), then given back where needed.
revoke all on function public.minimum_age() from public, anon, authenticated;
revoke all on function public.is_under_minimum_age(date) from public, anon, authenticated;
revoke all on function public.is_bad_birth_date(date) from public, anon, authenticated;
revoke all on function public.is_age_blocked(uuid) from public, anon, authenticated;
revoke all on function public.username_problem(text, uuid) from public, anon, authenticated;
revoke all on function public.legal_documents_permanent() from public, anon, authenticated;
revoke all on function public.current_legal_versions() from public, anon, authenticated;
revoke all on function public.legal_versions_valid(jsonb) from public, anon, authenticated;
revoke all on function public.legal_terms_ok(uuid) from public, anon, authenticated;
revoke all on function public.is_active_user(uuid) from public, anon, authenticated;
revoke all on function public.is_active_account() from public, anon, authenticated;
revoke all on function public.account_status() from public, anon, authenticated;
revoke all on function public.complete_signup(text, text, date, jsonb) from public, anon, authenticated;
revoke all on function public.change_username(text) from public, anon, authenticated;
revoke all on function public.username_available(text) from public, anon, authenticated;
revoke all on function public.accept_legal_documents(jsonb) from public, anon, authenticated;
revoke all on function public.request_birthday_correction(date, text) from public, anon, authenticated;
-- Admin only (service role / SQL Editor), like grant_all_items()
revoke all on function public.start_birthday_correction_by_email(uuid, date, text) from public, anon, authenticated;
revoke all on function public.confirm_birthday_correction(text) from public, anon, authenticated;
revoke all on function public.correct_birth_date(uuid, text, text) from public, anon, authenticated;
revoke all on function public.reject_birthday_correction(uuid, text, text) from public, anon, authenticated;
revoke all on function public.blocked_accounts_to_delete() from public, anon, authenticated;

-- Used inside row rules, which run as the caller. is_active_user() tells
-- a caller only what the profiles rule already shows: whether someone is
-- visible.
grant execute on function public.is_active_account() to authenticated;
grant execute on function public.is_active_user(uuid) to authenticated;

-- Every signed-in account, so the app knows which screen to show
grant execute on function public.account_status() to authenticated;
grant execute on function public.complete_signup(text, text, date, jsonb) to authenticated;
grant execute on function public.change_username(text) to authenticated;
grant execute on function public.username_available(text) to authenticated;
grant execute on function public.accept_legal_documents(jsonb) to authenticated;
grant execute on function public.request_birthday_correction(date, text) to authenticated;
